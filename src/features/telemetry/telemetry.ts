import type { LatencySummary } from "../performance/performanceMonitor";

const preferenceKey = "umber:telemetry-enabled";

export type AggregateTelemetry = {
  type: "performance";
  samples: number;
  p50EditToPatchMs?: number;
  p95EditToPatchMs?: number;
  latestPatchApplicationMs?: number;
  cacheHits: number;
  cacheMisses: number;
  workerCrashes: number;
  bundleFetchFailures: number;
};

export type HealthMetric = "cache-hit" | "cache-miss" | "worker-crash" | "bundle-fetch-failure";

type BeaconSender = (url: string, body: Blob) => boolean;

export class TelemetryClient {
  readonly #endpoint?: string;
  readonly #storage?: Storage;
  readonly #sender?: BeaconSender;
  #enabled: boolean;
  readonly #health = {
    cacheHits: 0,
    cacheMisses: 0,
    workerCrashes: 0,
    bundleFetchFailures: 0,
  };

  constructor(
    endpoint = import.meta.env.VITE_TELEMETRY_ENDPOINT as string | undefined,
    options: { storage?: Storage; sender?: BeaconSender } = {},
  ) {
    this.#endpoint = endpoint || undefined;
    let candidateStorage = options.storage;
    if (!candidateStorage) {
      try {
        candidateStorage = globalThis.localStorage;
      } catch {
        candidateStorage = undefined;
      }
    }
    this.#storage =
      candidateStorage &&
      typeof candidateStorage.getItem === "function" &&
      typeof candidateStorage.setItem === "function"
        ? candidateStorage
        : undefined;
    this.#sender = options.sender ?? globalThis.navigator?.sendBeacon?.bind(globalThis.navigator);
    this.#enabled = this.#storage?.getItem(preferenceKey) === "true";
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
    this.#storage?.setItem(preferenceKey, String(enabled));
    if (!enabled) this.#resetHealth();
  }

  recordHealth(metric: HealthMetric): void {
    if (!this.#enabled) return;
    if (metric === "cache-hit") this.#health.cacheHits += 1;
    if (metric === "cache-miss") this.#health.cacheMisses += 1;
    if (metric === "worker-crash") this.#health.workerCrashes += 1;
    if (metric === "bundle-fetch-failure") this.#health.bundleFetchFailures += 1;
  }

  sendPerformance(summary: LatencySummary): boolean {
    if (!this.#enabled || !this.#endpoint || !this.#sender) return false;
    const payload: AggregateTelemetry = {
      type: "performance",
      samples: summary.samples,
      p50EditToPatchMs: summary.p50EditToPatchMs,
      p95EditToPatchMs: summary.p95EditToPatchMs,
      latestPatchApplicationMs: summary.latestPatchApplicationMs,
      ...this.#health,
    };
    const sent = this.#sender(
      this.#endpoint,
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );
    if (sent) this.#resetHealth();
    return sent;
  }

  #resetHealth(): void {
    this.#health.cacheHits = 0;
    this.#health.cacheMisses = 0;
    this.#health.workerCrashes = 0;
    this.#health.bundleFetchFailures = 0;
  }
}
