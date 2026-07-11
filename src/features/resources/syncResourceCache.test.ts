import { describe, expect, it, vi } from "vitest";
import type { CacheLockManager } from "./opfsCacheCoordinator";
import { type SyncAccessHandleLike, WorkerSyncResourceCache } from "./syncResourceCache";

class FakeLocks implements CacheLockManager {
  readonly requested: string[] = [];
  readonly #tails = new Map<string, Promise<void>>();

  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const prior = this.#tails.get(name) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(name, current);
    await prior;
    try {
      return await callback();
    } finally {
      release?.();
      if (this.#tails.get(name) === current) this.#tails.delete(name);
    }
  }
}

class FakeDirectory {
  readonly files = new Map<string, Uint8Array>();
  readonly createSyncAccessHandle = vi.fn();

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
      createSyncAccessHandle: async () => {
        this.createSyncAccessHandle(name);
        const access: SyncAccessHandleLike = {
          getSize: () => this.files.get(name)?.byteLength ?? 0,
          read: (target) => {
            const source = this.files.get(name) ?? new Uint8Array();
            new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(source);
            return source.byteLength;
          },
          write: (source) => {
            const copy = new Uint8Array(source.byteLength);
            copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
            this.files.set(name, copy);
            return copy.byteLength;
          },
          truncate: (size) => this.files.set(name, new Uint8Array(size)),
          flush: () => undefined,
          close: () => undefined,
        };
        return access;
      },
    };
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name)) throw new DOMException("missing", "NotFoundError");
  }
}

describe("WorkerSyncResourceCache", () => {
  it("persists LRU state and coordinates independent worker instances", async () => {
    const directory = new FakeDirectory();
    const locks = new FakeLocks();
    const first = new WorkerSyncResourceCache(
      directory as unknown as FileSystemDirectoryHandle,
      5,
      "bundle",
      locks,
    );
    const second = new WorkerSyncResourceCache(
      directory as unknown as FileSystemDirectoryHandle,
      5,
      "bundle",
      locks,
    );
    first.pin("manifest");
    second.pin("manifest");
    await first.put("manifest", new Uint8Array([1, 2]).buffer);
    await first.put("old", new Uint8Array([3, 4]).buffer);
    await second.put("new", new Uint8Array([5, 6, 7]).buffer);

    expect(directory.createSyncAccessHandle).toHaveBeenCalled();
    expect(await first.has("manifest")).toBe(true);
    expect(await first.has("old")).toBe(false);
    expect([...new Uint8Array((await second.get("new")) ?? new ArrayBuffer())]).toEqual([5, 6, 7]);
    expect(await first.stats()).toEqual({ entries: 2, totalBytes: 5, maxBytes: 5 });
    expect(locks.requested).toContain("umber-cache-meta-bundle");
    expect(locks.requested).toContain("umber-cache-bundle-new");

    const afterReload = new WorkerSyncResourceCache(
      directory as unknown as FileSystemDirectoryHandle,
      5,
      "bundle",
      locks,
    );
    expect(await afterReload.stats()).toEqual({ entries: 2, totalBytes: 5, maxBytes: 5 });
  });
});
