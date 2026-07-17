import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectAutosave } from "./autosave";
import { MemoryProjectStore } from "./projectStore";

afterEach(() => vi.useRealTimers());

describe("ProjectAutosave", () => {
  it("coalesces writes within the debounce window", async () => {
    vi.useFakeTimers();
    const store = new MemoryProjectStore();
    await store.createProject({
      id: "demo",
      name: "Demo",
      entry: "main.tex",
      compileMode: "plain",
      files: { "main.tex": new TextEncoder().encode("initial") },
    });
    const writeFiles = vi.spyOn(store, "writeFiles");
    const autosave = new ProjectAutosave(store, "demo", 500);

    autosave.schedule("main.tex", new TextEncoder().encode("one"));
    autosave.schedule("main.tex", new TextEncoder().encode("two"));
    await vi.advanceTimersByTimeAsync(499);
    expect(writeFiles).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(writeFiles).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(await store.readFile("demo", "main.tex"))).toBe("two");
  });

  it("flushes immediately when the page is hidden", async () => {
    const store = new MemoryProjectStore();
    await store.createProject({
      id: "demo",
      name: "Demo",
      entry: "main.tex",
      compileMode: "plain",
      files: { "main.tex": new TextEncoder().encode("initial") },
    });
    const autosave = new ProjectAutosave(store, "demo", 10_000);
    const fakeDocument = new EventTarget() as Document;
    Object.defineProperty(fakeDocument, "visibilityState", { value: "hidden" });
    const detach = autosave.attachLifecycle(fakeDocument, window);
    autosave.schedule("main.tex", new TextEncoder().encode("saved"));

    fakeDocument.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await autosave.flush();

    expect(new TextDecoder().decode(await store.readFile("demo", "main.tex"))).toBe("saved");
    detach();
  });
});
