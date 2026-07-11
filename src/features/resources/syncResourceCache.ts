import { type CacheLockManager, isNotFound, OpfsCacheCoordinator } from "./opfsCacheCoordinator";
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

/** OPFS worker adapter that performs content I/O through synchronous access handles. */
export class WorkerSyncResourceCache implements ResourceCache {
  readonly #directory: FileSystemDirectoryHandle;
  readonly #maxBytes: number;
  readonly #pinned = new Set<string>();
  readonly #coordinator: OpfsCacheCoordinator;

  constructor(
    directory: FileSystemDirectoryHandle,
    maxBytes = 1024 ** 3,
    namespace = "worker",
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
  ): Promise<WorkerSyncResourceCache> {
    if (!validSegment.test(bundleDigest)) throw new Error("Invalid bundle digest");
    const root = options.root ?? (await navigator.storage.getDirectory());
    const cacheRoot = await root.getDirectoryHandle("cache", { create: true });
    const directory = await cacheRoot.getDirectoryHandle(bundleDigest, { create: true });
    const locks = options.locks ?? (navigator.locks as unknown as CacheLockManager | undefined);
    return new WorkerSyncResourceCache(directory, options.maxBytes, bundleDigest, locks);
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    this.#assertKey(key);
    return this.#coordinator.mutateMetadata((metadata) =>
      this.#coordinator.withKeyLock(key, async () => {
        try {
          const file = (await this.#directory.getFileHandle(key)) as SyncFileHandle;
          const access = await file.createSyncAccessHandle();
          try {
            const result = new Uint8Array(access.getSize());
            access.read(result);
            metadata.entries[key] = {
              size: result.byteLength,
              lastAccess: ++metadata.clock,
            };
            return result.buffer;
          } finally {
            access.close();
          }
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
        const file = (await this.#directory.getFileHandle(key, {
          create: true,
        })) as SyncFileHandle;
        const access = await file.createSyncAccessHandle();
        try {
          access.truncate(0);
          access.write(new Uint8Array(bytes));
          access.flush();
        } finally {
          access.close();
        }
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
