import type { CacheStats, ResourceCache } from "./resourceCache";

export interface SyncAccessHandleLike {
  getSize(): number;
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandleLike>;
};

const validSegment = /^[a-zA-Z0-9._-]+$/;
const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError";

/** OPFS worker adapter that performs file I/O through synchronous access handles. */
export class WorkerSyncResourceCache implements ResourceCache {
  readonly #directory: FileSystemDirectoryHandle;
  readonly #maxBytes: number;
  readonly #pinned = new Set<string>();
  readonly #sizes = new Map<string, number>();
  readonly #accessOrder = new Map<string, number>();
  #clock = 0;

  constructor(directory: FileSystemDirectoryHandle, maxBytes = 1024 ** 3) {
    this.#directory = directory;
    this.#maxBytes = maxBytes;
  }

  static async create(
    bundleDigest: string,
    options: { maxBytes?: number; root?: FileSystemDirectoryHandle } = {},
  ): Promise<WorkerSyncResourceCache> {
    if (!validSegment.test(bundleDigest)) throw new Error("Invalid bundle digest");
    const root = options.root ?? (await navigator.storage.getDirectory());
    const cacheRoot = await root.getDirectoryHandle("cache", { create: true });
    const directory = await cacheRoot.getDirectoryHandle(bundleDigest, { create: true });
    return new WorkerSyncResourceCache(directory, options.maxBytes);
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    this.#assertKey(key);
    try {
      const file = (await this.#directory.getFileHandle(key)) as SyncFileHandle;
      const access = await file.createSyncAccessHandle();
      try {
        const result = new Uint8Array(access.getSize());
        access.read(result);
        this.#sizes.set(key, result.byteLength);
        this.#accessOrder.set(key, ++this.#clock);
        return result.buffer;
      } finally {
        access.close();
      }
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    this.#assertKey(key);
    const file = (await this.#directory.getFileHandle(key, { create: true })) as SyncFileHandle;
    const access = await file.createSyncAccessHandle();
    try {
      access.truncate(0);
      access.write(new Uint8Array(bytes));
      access.flush();
    } finally {
      access.close();
    }
    this.#sizes.set(key, bytes.byteLength);
    this.#accessOrder.set(key, ++this.#clock);
    await this.#evict();
  }

  async has(key: string): Promise<boolean> {
    this.#assertKey(key);
    try {
      await this.#directory.getFileHandle(key);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  pin(key: string): void {
    this.#assertKey(key);
    this.#pinned.add(key);
  }

  async stats(): Promise<CacheStats> {
    return {
      entries: this.#sizes.size,
      totalBytes: [...this.#sizes.values()].reduce((total, size) => total + size, 0),
      maxBytes: this.#maxBytes,
    };
  }

  async #evict(): Promise<void> {
    const total = () => [...this.#sizes.values()].reduce((sum, size) => sum + size, 0);
    while (total() > this.#maxBytes) {
      const candidate = [...this.#accessOrder.entries()]
        .filter(([key]) => !this.#pinned.has(key))
        .sort((left, right) => left[1] - right[1])[0];
      if (!candidate) return;
      await this.#directory.removeEntry(candidate[0]);
      this.#sizes.delete(candidate[0]);
      this.#accessOrder.delete(candidate[0]);
    }
  }

  #assertKey(key: string): void {
    if (!validSegment.test(key)) throw new Error(`Invalid cache key: ${key}`);
  }
}
