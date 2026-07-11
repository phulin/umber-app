import type { ProjectStore } from "./projectStore";

export class ProjectAutosave {
  readonly #store: ProjectStore;
  readonly #projectId: string;
  readonly #delayMs: number;
  readonly #pending = new Map<string, Uint8Array>();
  #timer: number | undefined;
  #flushPromise?: Promise<void>;

  constructor(store: ProjectStore, projectId: string, delayMs = 500) {
    this.#store = store;
    this.#projectId = projectId;
    this.#delayMs = delayMs;
  }

  schedule(path: string, bytes: Uint8Array): void {
    this.#pending.set(path, bytes.slice());
    if (this.#timer !== undefined) window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, this.#delayMs);
  }

  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      window.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#flushPromise) await this.#flushPromise;
    if (this.#pending.size === 0) return;
    const batch = new Map(this.#pending);
    this.#pending.clear();
    this.#flushPromise = this.#store
      .writeFiles(this.#projectId, batch)
      .then(() => undefined)
      .catch((error: unknown) => {
        for (const [path, bytes] of batch) {
          if (!this.#pending.has(path)) this.#pending.set(path, bytes);
        }
        throw error;
      })
      .finally(() => {
        this.#flushPromise = undefined;
      });
    await this.#flushPromise;
  }

  attachLifecycle(documentTarget: Document = document, windowTarget: Window = window): () => void {
    const flushWhenHidden = () => {
      if (documentTarget.visibilityState === "hidden") void this.flush();
    };
    const flushOnPageHide = () => void this.flush();
    documentTarget.addEventListener("visibilitychange", flushWhenHidden);
    windowTarget.addEventListener("pagehide", flushOnPageHide);
    return () => {
      documentTarget.removeEventListener("visibilitychange", flushWhenHidden);
      windowTarget.removeEventListener("pagehide", flushOnPageHide);
    };
  }

  async dispose(): Promise<void> {
    await this.flush();
  }
}
