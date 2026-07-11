import { describe, expect, it, vi } from "vitest";
import { BundleResolver } from "../resources/bundleResolver";
import { MemoryResourceCache } from "../resources/resourceCache";
import { type EngineHost, loadWasmEngine } from "./wasmEngineAdapter";

describe("loadWasmEngine", () => {
  it("injects the shared resolver into the external engine module", async () => {
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example",
      cache: new MemoryResourceCache(),
      fetcher: vi.fn() as typeof fetch,
    });
    const engine = { handle: vi.fn(), dispose: vi.fn() };
    const factory = vi.fn((_host: EngineHost) => engine);

    const loaded = await loadWasmEngine("/engine.js", resolver, vi.fn(), async () => ({
      createIncrementalTexEngine: factory,
    }));

    expect(loaded).toBe(engine);
    const host = factory.mock.calls[0]?.[0];
    expect(host?.resolve).toBeTypeOf("function");
    expect(host?.getFile).toBeTypeOf("function");
    expect(host?.emit).toBeTypeOf("function");
  });

  it("rejects engine packages that do not implement the adapter export", async () => {
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example",
      cache: new MemoryResourceCache(),
      fetcher: vi.fn() as typeof fetch,
    });

    await expect(loadWasmEngine("/bad.js", resolver, vi.fn(), async () => ({}))).rejects.toThrow(
      "createIncrementalTexEngine",
    );
  });
});
