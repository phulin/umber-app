import { describe, expect, it } from "vitest";
import type { CacheLockManager } from "./opfsCacheCoordinator";
import { createResourceCache, MemoryResourceCache, OpfsResourceCache } from "./resourceCache";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

class ImmediateLocks implements CacheLockManager {
  readonly names: string[] = [];

  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.names.push(name);
    return callback();
  }
}

class AsyncDirectory {
  readonly directories = new Map<string, AsyncDirectory>();
  readonly files = new Map<string, Uint8Array>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let directory = this.directories.get(name);
    if (!directory && options?.create) {
      directory = new AsyncDirectory();
      this.directories.set(name, directory);
    }
    if (!directory) throw new DOMException("missing", "NotFoundError");
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException("missing", "NotFoundError");
    }
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());

    return {
      getFile: async () => ({
        arrayBuffer: async () => (this.files.get(name) ?? new Uint8Array()).slice().buffer,
        text: async () => new TextDecoder().decode(this.files.get(name)),
      }),
      createWritable: async () => ({
        write: async (value: string | ArrayBuffer) => {
          this.files.set(
            name,
            typeof value === "string"
              ? new TextEncoder().encode(value)
              : new Uint8Array(value.slice(0)),
          );
        },
        close: async () => undefined,
      }),
    };
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
}

describe("MemoryResourceCache", () => {
  it("evicts least-recently-used entries while preserving pinned content", async () => {
    const cache = new MemoryResourceCache(6);
    await cache.put("manifest", bytes(1, 2, 3));
    cache.pin("manifest");
    await cache.put("old", bytes(4, 5));
    await cache.put("new", bytes(6, 7, 8));

    expect(await cache.has("manifest")).toBe(true);
    expect(await cache.has("old")).toBe(false);
    expect(await cache.has("new")).toBe(true);
    expect(await cache.stats()).toEqual({ entries: 2, totalBytes: 6, maxBytes: 6 });
  });

  it("returns copies so transferring a consumer buffer cannot detach the cache", async () => {
    const cache = new MemoryResourceCache();
    await cache.put("font", bytes(1, 2, 3));

    const first = await cache.get("font");
    const second = await cache.get("font");

    expect(first).not.toBe(second);
    expect([...new Uint8Array(first ?? new ArrayBuffer())]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(second ?? new ArrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("falls back to memory when OPFS initialization fails", async () => {
    const root = {
      getDirectoryHandle: async () => {
        throw new Error("OPFS disabled");
      },
    } as unknown as FileSystemDirectoryHandle;

    const cache = await createResourceCache("bundle", { root, maxBytes: 20 });
    expect(cache).toBeInstanceOf(MemoryResourceCache);
    expect((await cache.stats()).maxBytes).toBe(20);
  });
});

describe("OpfsResourceCache", () => {
  it("shares fresh persisted metadata across independent main-thread instances", async () => {
    const root = new AsyncDirectory();
    const locks = new ImmediateLocks();
    const options = {
      root: root as unknown as FileSystemDirectoryHandle,
      locks,
      maxBytes: 5,
    };
    const first = await OpfsResourceCache.create("bundle", options);
    const second = await OpfsResourceCache.create("bundle", options);
    first.pin("manifest");
    second.pin("manifest");

    await first.put("manifest", bytes(1, 2));
    await first.put("old", bytes(3, 4));
    await second.put("new", bytes(5, 6, 7));

    expect(await first.has("old")).toBe(false);
    expect(await first.stats()).toEqual({ entries: 2, totalBytes: 5, maxBytes: 5 });
    const afterReload = await OpfsResourceCache.create("bundle", options);
    expect(await afterReload.stats()).toEqual({ entries: 2, totalBytes: 5, maxBytes: 5 });
    expect(locks.names).toContain("umber-cache-meta-bundle");
    expect(locks.names).toContain("umber-cache-bundle-new");
  });
});
