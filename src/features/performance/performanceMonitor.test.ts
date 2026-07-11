import { describe, expect, it } from "vitest";
import { PerformanceMonitor } from "./performanceMonitor";

describe("PerformanceMonitor", () => {
  it("reports edit-to-patch percentiles and latest DOM application time", () => {
    let now = 0;
    const monitor = new PerformanceMonitor(() => now);
    for (const duration of [20, 40, 100, 160]) {
      monitor.beginEdit();
      now += duration;
      monitor.patchApplied(duration, 5);
    }

    expect(monitor.summary()).toEqual({
      samples: 4,
      p50EditToPatchMs: 40,
      p95EditToPatchMs: 160,
      latestPatchApplicationMs: 5,
    });
  });
});
