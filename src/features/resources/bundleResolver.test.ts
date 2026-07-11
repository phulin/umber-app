import { describe, expect, it, vi } from "vitest";
import { BundleResolver, sha256Hex } from "./bundleResolver";
import { MemoryResourceCache } from "./resourceCache";

const bytes = (value: string) => new TextEncoder().encode(value).buffer;

describe("BundleResolver", () => {
  it("resolves names, deduplicates concurrent misses, and serves later cache hits", async () => {
    const resource = bytes("hello bundle");
    const hash = await sha256Hex(resource);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("manifest-")) {
        return new Response(JSON.stringify({ "article.cls": { hash, size: resource.byteLength } }));
      }
      return new Response(resource);
    }) as typeof fetch;
    const cache = new MemoryResourceCache();
    const onMetric = vi.fn();
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example/",
      cache,
      fetcher,
      onMetric,
    });

    expect(await resolver.resolve("article.cls")).toBe(hash);
    expect(await resolver.resolve("missing.sty")).toBeNull();
    const [first, second] = await Promise.all([resolver.getFile(hash), resolver.getFile(hash)]);
    const third = await resolver.getFile(hash);

    expect(new TextDecoder().decode(first)).toBe("hello bundle");
    expect(new TextDecoder().decode(second)).toBe("hello bundle");
    expect(new TextDecoder().decode(third)).toBe("hello bundle");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onMetric.mock.calls.map(([metric]) => metric)).toEqual([
      "cache-miss",
      "cache-miss",
      "cache-hit",
    ]);
  });

  it("rejects integrity failures without populating the cache", async () => {
    const expectedHash = await sha256Hex(bytes("expected"));
    const cache = new MemoryResourceCache();
    const onMetric = vi.fn();
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example",
      cache,
      fetcher: vi.fn(async () => new Response(bytes("tampered"))) as typeof fetch,
      onMetric,
    });

    await expect(resolver.getFile(expectedHash)).rejects.toThrow("integrity failure");
    expect(await cache.has(expectedHash)).toBe(false);
    expect(onMetric.mock.calls.map(([metric]) => metric)).toEqual([
      "cache-miss",
      "bundle-fetch-failure",
    ]);
  });

  it("counts manifest request failures as bundle fetch failures", async () => {
    const onMetric = vi.fn();
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example",
      cache: new MemoryResourceCache(),
      fetcher: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
      onMetric,
    });

    await expect(resolver.resolve("article.cls")).rejects.toThrow("503");
    expect(onMetric).toHaveBeenCalledWith("bundle-fetch-failure");
  });

  it("prefetches every resolvable source dependency", async () => {
    const resource = bytes("package");
    const hash = await sha256Hex(resource);
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("manifest-")
        ? new Response(JSON.stringify({ "x.sty": { hash, size: resource.byteLength } }))
        : new Response(resource),
    ) as typeof fetch;
    const cache = new MemoryResourceCache();
    const resolver = new BundleResolver({
      bundleDigest: "digest",
      baseUrl: "https://bundle.example",
      cache,
      fetcher,
    });

    await resolver.prefetch(["x.sty", "missing.sty"]);

    expect(await cache.has(hash)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
