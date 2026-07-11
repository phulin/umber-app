import type { LatencySummary } from "../performance/performanceMonitor";

const preferenceKey = "umber:telemetry-enabled";

export type AggregateTelemetry = {
  type: "performance";
  samples: number;
  p50EditToPatchMs?: number;
  p95EditToPatchMs?: number;
  latestPatchApplicationMs?: number;
};

type BeaconSender = (url: string, body: Blob) => boolean;

export class TelemetryClient {
  readonly #endpoint?: string;
  readonly #storage?: Storage;
  readonly #sender?: BeaconSender;
  #enabled: boolean;

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
  }

  sendPerformance(summary: LatencySummary): boolean {
    if (!this.#enabled || !this.#endpoint || !this.#sender) return false;
    const payload: AggregateTelemetry = {
      type: "performance",
      samples: summary.samples,
      p50EditToPatchMs: summary.p50EditToPatchMs,
      p95EditToPatchMs: summary.p95EditToPatchMs,
      latestPatchApplicationMs: summary.latestPatchApplicationMs,
    };
    return this.#sender(
      this.#endpoint,
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
    );
  }
}
