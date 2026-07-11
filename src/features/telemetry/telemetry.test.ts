import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./telemetry";

describe("TelemetryClient", () => {
  it("is disabled by default and sends only aggregate allowlisted fields after opt-in", async () => {
    const storage = new Map<string, string>();
    const storageLike: Storage = {
      length: 0,
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: () => null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const sender = vi.fn((_url: string, _body: Blob) => true);
    const client = new TelemetryClient("https://telemetry.example/beacon", {
      storage: storageLike,
      sender,
    });
    const summary = {
      samples: 4,
      p50EditToPatchMs: 40,
      p95EditToPatchMs: 120,
      latestPatchApplicationMs: 4,
    };

    expect(client.enabled).toBe(false);
    expect(client.sendPerformance(summary)).toBe(false);
    client.setEnabled(true);
    client.recordHealth("cache-hit");
    client.recordHealth("cache-miss");
    client.recordHealth("worker-crash");
    client.recordHealth("bundle-fetch-failure");
    expect(client.sendPerformance(summary)).toBe(true);

    const blob = sender.mock.calls[0]?.[1];
    expect(JSON.parse((await blob?.text()) ?? "{}")).toEqual({
      type: "performance",
      ...summary,
      cacheHits: 1,
      cacheMisses: 1,
      workerCrashes: 1,
      bundleFetchFailures: 1,
    });
    expect(storage.get("umber:telemetry-enabled")).toBe("true");
  });
});
