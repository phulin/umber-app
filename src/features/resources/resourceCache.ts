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

type CacheEntry = {
  bytes: ArrayBuffer;
  lastAccess: number;
};

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
    let total = 0;
    for (const { bytes } of this.#entries.values()) total += bytes.byteLength;
    return total;
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

type StoredMeta = {
  entries: Record<string, { size: number; lastAccess: number }>;
  clock: number;
};

type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

const validSegment = /^[a-zA-Z0-9._-]+$/;

export class OpfsResourceCache implements ResourceCache {
  readonly #directory: FileSystemDirectoryHandle;
  readonly #maxBytes: number;
  readonly #locks?: LockManagerLike;
  readonly #pinned = new Set<string>();
  #meta?: StoredMeta;

  private constructor(
    directory: FileSystemDirectoryHandle,
    maxBytes: number,
    locks?: LockManagerLike,
  ) {
    this.#directory = directory;
    this.#maxBytes = maxBytes;
    this.#locks = locks;
  }

  static async create(
    bundleDigest: string,
    options: { maxBytes?: number; root?: FileSystemDirectoryHandle; locks?: LockManagerLike } = {},
  ): Promise<OpfsResourceCache> {
    if (!validSegment.test(bundleDigest)) throw new Error("Invalid bundle digest");
    const root = options.root ?? (await navigator.storage.getDirectory());
    const cacheRoot = await root.getDirectoryHandle("cache", { create: true });
    const directory = await cacheRoot.getDirectoryHandle(bundleDigest, { create: true });
    const locks = options.locks ?? (navigator.locks as unknown as LockManagerLike | undefined);
    return new OpfsResourceCache(directory, options.maxBytes ?? 1024 ** 3, locks);
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    this.#assertKey(key);
    try {
      const handle = await this.#directory.getFileHandle(key);
      const bytes = await (await handle.getFile()).arrayBuffer();
      const meta = await this.#metadata();
      const entry = meta.entries[key];
      if (entry) entry.lastAccess = ++meta.clock;
      await this.#writeMetadata();
      return bytes;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw error;
    }
  }

  async put(key: string, bytes: ArrayBuffer): Promise<void> {
    this.#assertKey(key);
    await this.#withLock(key, async () => {
      const handle = await this.#directory.getFileHandle(key, { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      const meta = await this.#metadata();
      meta.entries[key] = { size: bytes.byteLength, lastAccess: ++meta.clock };
      await this.#evict();
      await this.#writeMetadata();
    });
  }

  async has(key: string): Promise<boolean> {
    this.#assertKey(key);
    try {
      await this.#directory.getFileHandle(key);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return false;
      throw error;
    }
  }

  pin(key: string): void {
    this.#assertKey(key);
    this.#pinned.add(key);
  }

  async stats(): Promise<CacheStats> {
    const meta = await this.#metadata();
    return {
      entries: Object.keys(meta.entries).length,
      totalBytes: Object.values(meta.entries).reduce((total, entry) => total + entry.size, 0),
      maxBytes: this.#maxBytes,
    };
  }

  async #metadata(): Promise<StoredMeta> {
    if (this.#meta) return this.#meta;
    try {
      const handle = await this.#directory.getFileHandle("meta.json");
      const parsed = JSON.parse(await (await handle.getFile()).text()) as StoredMeta;
      this.#meta = parsed;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotFoundError") throw error;
      this.#meta = { entries: {}, clock: 0 };
    }
    return this.#meta;
  }

  async #writeMetadata(): Promise<void> {
    if (!this.#meta) return;
    const handle = await this.#directory.getFileHandle("meta.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(this.#meta));
    await writable.close();
  }

  async #evict(): Promise<void> {
    const meta = await this.#metadata();
    const total = () => Object.values(meta.entries).reduce((sum, entry) => sum + entry.size, 0);
    while (total() > this.#maxBytes) {
      const candidate = Object.entries(meta.entries)
        .filter(([key]) => !this.#pinned.has(key))
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!candidate) return;
      await this.#directory.removeEntry(candidate[0]);
      delete meta.entries[candidate[0]];
    }
  }

  async #withLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    if (!this.#locks) return callback();
    return this.#locks.request(`umber-cache-${key}`, callback);
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
    if (!options.root && !storage.getDirectory) {
      return new MemoryResourceCache(options.maxBytes);
    }
    return await OpfsResourceCache.create(bundleDigest, options);
  } catch (error) {
    console.warn("OPFS cache unavailable; using memory cache for this session.", error);
    return new MemoryResourceCache(options.maxBytes);
  }
}
