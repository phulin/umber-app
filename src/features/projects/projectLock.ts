type LockLike = object;

export type LockManagerLike = {
  request<T>(
    name: string,
    options: { ifAvailable: true },
    callback: (lock: LockLike | null) => Promise<T>,
  ): Promise<T>;
};

export class ProjectLockLease {
  readonly writable: boolean;
  readonly #releaseLock?: () => void;
  readonly #request?: Promise<unknown>;

  private constructor(writable: boolean, releaseLock?: () => void, request?: Promise<unknown>) {
    this.writable = writable;
    this.#releaseLock = releaseLock;
    this.#request = request;
  }

  static async acquire(
    projectId: string,
    manager: LockManagerLike | undefined = navigator.locks as unknown as
      | LockManagerLike
      | undefined,
  ): Promise<ProjectLockLease> {
    if (!manager) return new ProjectLockLease(true);
    let releaseLock: (() => void) | undefined;
    let reportReady: ((writable: boolean) => void) | undefined;
    const ready = new Promise<boolean>((resolve) => {
      reportReady = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const request = manager.request(
      `umber-project-${projectId}`,
      { ifAvailable: true },
      async (lock) => {
        reportReady?.(lock !== null);
        if (lock) await held;
      },
    );
    const writable = await ready;
    return new ProjectLockLease(writable, writable ? releaseLock : undefined, request);
  }

  async release(): Promise<void> {
    this.#releaseLock?.();
    await this.#request;
  }
}
