import type { ResourceCache } from "./resourceCache";

export type ManifestEntry = {
  hash: string;
  size: number;
  flags?: string[];
};

export type BundleManifest = Record<string, ManifestEntry>;

export type BundleResolverOptions = {
  bundleDigest: string;
  baseUrl: string;
  cache: ResourceCache;
  fetcher?: typeof fetch;
};

const hexHash = /^[a-f0-9]{64}$/;

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

function decodeManifest(value: unknown): BundleManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bundle manifest must be an object");
  }
  const manifest: BundleManifest = {};
  for (const [name, entry] of Object.entries(value)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("hash" in entry) ||
      typeof entry.hash !== "string" ||
      !hexHash.test(entry.hash) ||
      !("size" in entry) ||
      typeof entry.size !== "number" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    ) {
      throw new Error(`Invalid manifest entry: ${name}`);
    }
    manifest[name] = entry as ManifestEntry;
  }
  return manifest;
}

export class BundleResolver {
  readonly #bundleDigest: string;
  readonly #baseUrl: string;
  readonly #cache: ResourceCache;
  readonly #fetcher: typeof fetch;
  readonly #inflight = new Map<string, Promise<ArrayBuffer>>();
  #manifest?: BundleManifest;
  #manifestRequest?: Promise<BundleManifest>;

  constructor(options: BundleResolverOptions) {
    this.#bundleDigest = options.bundleDigest;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#cache = options.cache;
    this.#fetcher = options.fetcher ?? fetch;
    this.#cache.pin(this.#manifestKey());
  }

  async init(): Promise<BundleManifest> {
    if (this.#manifest) return this.#manifest;
    if (this.#manifestRequest) return this.#manifestRequest;
    this.#manifestRequest = this.#fetchManifest().finally(() => {
      this.#manifestRequest = undefined;
    });
    this.#manifest = await this.#manifestRequest;
    return this.#manifest;
  }

  async resolve(name: string): Promise<string | null> {
    const manifest = await this.init();
    return manifest[name]?.hash ?? null;
  }

  async getFile(hash: string): Promise<ArrayBuffer> {
    if (!hexHash.test(hash)) throw new Error(`Invalid resource hash: ${hash}`);
    const cached = await this.#cache.get(hash);
    if (cached) return cached;

    const current = this.#inflight.get(hash);
    if (current) return (await current).slice(0);

    const request = this.#fetchAndCache(hash).finally(() => this.#inflight.delete(hash));
    this.#inflight.set(hash, request);
    return (await request).slice(0);
  }

  async prefetch(names: readonly string[]): Promise<void> {
    const hashes = await Promise.all(names.map((name) => this.resolve(name)));
    await Promise.allSettled(
      hashes.filter((hash): hash is string => hash !== null).map((hash) => this.getFile(hash)),
    );
  }

  async #fetchAndCache(hash: string): Promise<ArrayBuffer> {
    const response = await this.#fetcher(`${this.#baseUrl}/f/${hash}`);
    if (!response.ok) throw new Error(`Bundle resource request failed: ${response.status}`);
    const bytes = await response.arrayBuffer();
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== hash) {
      throw new Error(
        `Bundle resource integrity failure: expected ${hash}, received ${actualHash}`,
      );
    }
    await this.#cache.put(hash, bytes);
    return bytes;
  }

  async #fetchManifest(): Promise<BundleManifest> {
    const cached = await this.#cache.get(this.#manifestKey());
    if (cached) {
      try {
        return decodeManifest(JSON.parse(new TextDecoder().decode(cached)));
      } catch {
        // A corrupt cached manifest is replaced by the authoritative digest-named CDN object.
      }
    }
    const response = await this.#fetcher(
      `${this.#baseUrl}/manifest-${encodeURIComponent(this.#bundleDigest)}.json`,
    );
    if (!response.ok) throw new Error(`Bundle manifest request failed: ${response.status}`);
    const manifest = decodeManifest(await response.json());
    await this.#cache.put(
      this.#manifestKey(),
      new TextEncoder().encode(JSON.stringify(manifest)).buffer,
    );
    return manifest;
  }

  #manifestKey(): string {
    return `manifest-${this.#bundleDigest}.json`;
  }
}
