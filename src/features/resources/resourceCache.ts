import { type CacheLockManager, isNotFound, OpfsCacheCoordinator } from "./opfsCacheCoordinator";

export type CacheStats = {
  entries: number;
  totalBytes: number;
  maxBytes: number;
};

export interface ResourceCache {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, bytes: ArrayBuffer): Promise<void>;
  has(key: string): Promise<boolean>;
  pin(key: string): void;
  stats(): Promise<CacheStats>;
}

type CacheEntry = { bytes: ArrayBuffer; lastAccess: number };
const validSegment = /^[a-zA-Z0-9._-]+$/;

export class MemoryResourceCache implements ResourceCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #pinned = new Set<string>();
  readonly #maxBytes: number;
  #clock = 0;

  constructor(maxBytes = 1024 ** 3) {
    this.#maxBytes = maxBytes;
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    entry.lastAccess = ++this.#clock;
    return entry.bytes.slice(0);
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    this.#entries.set(key, { bytes: bytes.slice(0), lastAccess: ++this.#clock });
    this.#evict();
  }

  async has(key: string): Promise<boolean> {
    return this.#entries.has(key);
  }

  pin(key: string): void {
    this.#pinned.add(key);
  }

  async stats(): Promise<CacheStats> {
    return {
      entries: this.#entries.size,
      totalBytes: this.#totalBytes(),
      maxBytes: this.#maxBytes,
    };
  }

  #totalBytes(): number {
    return [...this.#entries.values()].reduce((total, entry) => total + entry.bytes.byteLength, 0);
  }

  #evict(): void {
    while (this.#totalBytes() > this.#maxBytes) {
      const candidate = [...this.#entries.entries()]
        .filter(([key]) => !this.#pinned.has(key))
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!candidate) return;
      this.#entries.delete(candidate[0]);
    }
  }
}

export class OpfsResourceCache implements ResourceCache {
  readonly #directory: FileSystemDirectoryHandle;
  readonly #maxBytes: number;
  readonly #pinned = new Set<string>();
  readonly #coordinator: OpfsCacheCoordinator;

  private constructor(
    directory: FileSystemDirectoryHandle,
    namespace: string,
    maxBytes: number,
    locks?: CacheLockManager,
  ) {
    this.#directory = directory;
    this.#maxBytes = maxBytes;
    this.#coordinator = new OpfsCacheCoordinator(directory, namespace, locks);
  }

  static async create(
    bundleDigest: string,
    options: {
      maxBytes?: number;
      root?: FileSystemDirectoryHandle;
      locks?: CacheLockManager;
    } = {},
  ): Promise<OpfsResourceCache> {
    if (!validSegment.test(bundleDigest)) throw new Error("Invalid bundle digest");
    const root = options.root ?? (await navigator.storage.getDirectory());
    const cacheRoot = await root.getDirectoryHandle("cache", { create: true });
    const directory = await cacheRoot.getDirectoryHandle(bundleDigest, { create: true });
    const locks = options.locks ?? (navigator.locks as unknown as CacheLockManager | undefined);
    return new OpfsResourceCache(directory, bundleDigest, options.maxBytes ?? 1024 ** 3, locks);
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    this.#assertKey(key);
    return this.#coordinator.mutateMetadata((metadata) =>
      this.#coordinator.withKeyLock(key, async () => {
        try {
          const handle = await this.#directory.getFileHandle(key);
          const bytes = await (await handle.getFile()).arrayBuffer();
          metadata.entries[key] = {
            size: bytes.byteLength,
            lastAccess: ++metadata.clock,
          };
          return bytes;
        } catch (error) {
          if (isNotFound(error)) {
            delete metadata.entries[key];
            return null;
          }
          throw error;
        }
      }),
    );
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    this.#assertKey(key);
    await this.#coordinator.mutateMetadata(async (metadata) => {
      await this.#coordinator.withKeyLock(key, async () => {
        const handle = await this.#directory.getFileHandle(key, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
      });
      metadata.entries[key] = { size: bytes.byteLength, lastAccess: ++metadata.clock };
      await this.#coordinator.evictToLimit(metadata, this.#maxBytes, this.#pinned);
    });
  }

  async has(key: string): Promise<boolean> {
    this.#assertKey(key);
    return this.#coordinator.withKeyLock(key, async () => {
      try {
        await this.#directory.getFileHandle(key);
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    });
  }

  pin(key: string): void {
    this.#assertKey(key);
    this.#pinned.add(key);
  }

  async stats(): Promise<CacheStats> {
    const metadata = await this.#coordinator.readMetadata();
    return {
      entries: Object.keys(metadata.entries).length,
      totalBytes: Object.values(metadata.entries).reduce((total, entry) => total + entry.size, 0),
      maxBytes: this.#maxBytes,
    };
  }

  #assertKey(key: string): void {
    if (!validSegment.test(key) || key === "meta.json")
      throw new Error(`Invalid cache key: ${key}`);
  }
}

export async function createResourceCache(
  bundleDigest: string,
  options: { maxBytes?: number; root?: FileSystemDirectoryHandle } = {},
): Promise<ResourceCache> {
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (!options.root && !storage.getDirectory) return new MemoryResourceCache(options.maxBytes);
    return await OpfsResourceCache.create(bundleDigest, options);
  } catch (error) {
    console.warn("OPFS cache unavailable; using memory cache for this session.", error);
    return new MemoryResourceCache(options.maxBytes);
  }
}
