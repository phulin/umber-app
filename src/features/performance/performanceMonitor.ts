export type LatencySample = {
  epoch: number;
  editToPatchMs?: number;
  patchApplicationMs: number;
};

export type LatencySummary = {
  samples: number;
  p50EditToPatchMs?: number;
  p95EditToPatchMs?: number;
  latestPatchApplicationMs?: number;
};

const percentile = (values: number[], fraction: number): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

export class PerformanceMonitor {
  readonly #samples: LatencySample[] = [];
  readonly #now: () => number;
  #lastEditStart?: number;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
  }

  beginEdit(): void {
    this.#lastEditStart = this.#now();
    performance.mark?.("umber-edit-start");
  }

  patchApplied(epoch: number, patchApplicationMs: number): LatencySample {
    const editToPatchMs =
      this.#lastEditStart === undefined ? undefined : this.#now() - this.#lastEditStart;
    const sample = { epoch, editToPatchMs, patchApplicationMs };
    this.#samples.push(sample);
    this.#lastEditStart = undefined;
    performance.mark?.("umber-patch-applied");
    if (editToPatchMs !== undefined) {
      performance.measure?.("umber-edit-to-patch", "umber-edit-start", "umber-patch-applied");
    }
    return sample;
  }

  summary(): LatencySummary {
    const editDurations = this.#samples.flatMap(({ editToPatchMs }) =>
      editToPatchMs === undefined ? [] : [editToPatchMs],
    );
    return {
      samples: this.#samples.length,
      p50EditToPatchMs: percentile(editDurations, 0.5),
      p95EditToPatchMs: percentile(editDurations, 0.95),
      latestPatchApplicationMs: this.#samples.at(-1)?.patchApplicationMs,
    };
  }
}
