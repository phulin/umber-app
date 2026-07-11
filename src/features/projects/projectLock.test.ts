import { describe, expect, it } from "vitest";
import { type LockManagerLike, ProjectLockLease } from "./projectLock";

class FakeLocks implements LockManagerLike {
  readonly held = new Set<string>();

  async request<T>(
    name: string,
    _options: { ifAvailable: true },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T> {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({});
    } finally {
      this.held.delete(name);
    }
  }
}

describe("ProjectLockLease", () => {
  it("makes a second tab read-only until the first lease is released", async () => {
    const locks = new FakeLocks();
    const first = await ProjectLockLease.acquire("project", locks);
    const second = await ProjectLockLease.acquire("project", locks);

    expect(first.writable).toBe(true);
    expect(second.writable).toBe(false);
    await second.release();
    await first.release();
    const third = await ProjectLockLease.acquire("project", locks);
    expect(third.writable).toBe(true);
    await third.release();
  });
});
