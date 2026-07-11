import { describe, expect, it, vi } from "vitest";
import { type SyncAccessHandleLike, WorkerSyncResourceCache } from "./syncResourceCache";

class FakeDirectory {
  readonly files = new Map<string, Uint8Array>();
  readonly createSyncAccessHandle = vi.fn();

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create)
      throw new DOMException("missing", "NotFoundError");
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    return {
      createSyncAccessHandle: async () => {
        this.createSyncAccessHandle(name);
        const directory = this;
        const access: SyncAccessHandleLike = {
          getSize: () => directory.files.get(name)?.byteLength ?? 0,
          read: (target) => {
            const source = directory.files.get(name) ?? new Uint8Array();
            new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(source);
            return source.byteLength;
          },
          write: (source) => {
            const copy = new Uint8Array(source.byteLength);
            copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
            directory.files.set(name, copy);
            return copy.byteLength;
          },
          truncate: (size) => directory.files.set(name, new Uint8Array(size)),
          flush: () => undefined,
          close: () => undefined,
        };
        return access;
      },
    };
  }

  async removeEntry(name: string) {
    this.files.delete(name);
  }
}

describe("WorkerSyncResourceCache", () => {
  it("uses sync access handles and applies the same LRU/pinning policy", async () => {
    const directory = new FakeDirectory();
    const cache = new WorkerSyncResourceCache(directory as unknown as FileSystemDirectoryHandle, 5);
    cache.pin("manifest");
    await cache.put("manifest", new Uint8Array([1, 2]).buffer);
    await cache.put("old", new Uint8Array([3, 4]).buffer);
    await cache.put("new", new Uint8Array([5, 6, 7]).buffer);

    expect(directory.createSyncAccessHandle).toHaveBeenCalled();
    expect(await cache.has("manifest")).toBe(true);
    expect(await cache.has("old")).toBe(false);
    expect([...new Uint8Array((await cache.get("new")) ?? new ArrayBuffer())]).toEqual([5, 6, 7]);
    expect(await cache.stats()).toEqual({ entries: 2, totalBytes: 5, maxBytes: 5 });
  });
});
