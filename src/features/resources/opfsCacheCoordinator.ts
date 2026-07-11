export type StoredCacheMetadata = {
  entries: Record<string, { size: number; lastAccess: number }>;
  clock: number;
};

export type CacheLockManager = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError";

export class OpfsCacheCoordinator {
  readonly #directory: FileSystemDirectoryHandle;
  readonly #namespace: string;
  readonly #locks?: CacheLockManager;

  constructor(directory: FileSystemDirectoryHandle, namespace: string, locks?: CacheLockManager) {
    this.#directory = directory;
    this.#namespace = namespace;
    this.#locks = locks;
  }

  async mutateMetadata<T>(callback: (metadata: StoredCacheMetadata) => Promise<T> | T): Promise<T> {
    return this.#withLock(`umber-cache-meta-${this.#namespace}`, async () => {
      const metadata = await this.#readMetadata();
      const result = await callback(metadata);
      await this.#writeMetadata(metadata);
      return result;
    });
  }

  async readMetadata(): Promise<StoredCacheMetadata> {
    return this.#withLock(`umber-cache-meta-${this.#namespace}`, () => this.#readMetadata());
  }

  async withKeyLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    return this.#withLock(`umber-cache-${this.#namespace}-${key}`, callback);
  }

  async evictToLimit(
    metadata: StoredCacheMetadata,
    maxBytes: number,
    pinned: ReadonlySet<string>,
  ): Promise<void> {
    const total = () => Object.values(metadata.entries).reduce((sum, entry) => sum + entry.size, 0);
    while (total() > maxBytes) {
      const candidate = Object.entries(metadata.entries)
        .filter(([key]) => !pinned.has(key))
        .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
      if (!candidate) return;
      await this.withKeyLock(candidate[0], async () => {
        try {
          await this.#directory.removeEntry(candidate[0]);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      });
      delete metadata.entries[candidate[0]];
    }
  }

  async #readMetadata(): Promise<StoredCacheMetadata> {
    try {
      const handle = await this.#directory.getFileHandle("meta.json");
      const parsed = JSON.parse(await (await handle.getFile()).text()) as StoredCacheMetadata;
      if (
        typeof parsed.clock !== "number" ||
        typeof parsed.entries !== "object" ||
        parsed.entries === null
      ) {
        throw new Error("Invalid cache metadata");
      }
      return parsed;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return { entries: {}, clock: 0 };
    }
  }

  async #writeMetadata(metadata: StoredCacheMetadata): Promise<void> {
    const handle = await this.#directory.getFileHandle("meta.json", { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(metadata));
    await writable.close();
  }

  async #withLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
    if (!this.#locks) return callback();
    return this.#locks.request(name, callback);
  }
}
