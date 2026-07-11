import { describe, expect, it } from "vitest";
import { createResourceCache, MemoryResourceCache } from "./resourceCache";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

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
