import type { ResourceRequest, ResourceResponse } from "@umber/umber-wasm/low-level";
import type { ResolvedDownload } from "@umber/umber-wasm/manifest-resolver";
import type { FontResourceRouter } from "./fontResourceResolvers";

export type DistributionResolver = {
  resolve(
    requests: readonly ResourceRequest[],
    options: {
      signal?: AbortSignal;
      prefetchHints?: readonly ResourceRequest[];
    },
  ): Promise<readonly (ResolvedDownload | ResourceResponse)[]>;
};

export async function resolveResourceBatch(
  local: FontResourceRouter,
  distribution: DistributionResolver,
  required: readonly ResourceRequest[],
  prefetchHints: readonly ResourceRequest[],
  signal: AbortSignal,
): Promise<ResourceResponse[]> {
  const { responses, missing } = local.resolve(required);
  if (missing.length === 0) return responses;
  const downloaded = await distribution.resolve(missing, { signal, prefetchHints });
  return [...responses, ...downloaded.map(normalizeDownload)];
}

function normalizeDownload(download: ResolvedDownload | ResourceResponse): ResourceResponse {
  if ("type" in download) return download;
  return {
    type: "file",
    domain: "tex",
    kind: download.request.kind,
    name: download.request.name,
    virtualPath: download.virtualPath,
    bytes: download.bytes,
  };
}

export class CompileAbortCoordinator {
  #active?: { epoch: number; controller: AbortController };

  begin(epoch: number): AbortSignal {
    this.#active?.controller.abort();
    const controller = new AbortController();
    this.#active = { epoch, controller };
    return controller.signal;
  }

  cancelBefore(epoch: number): void {
    if (this.#active && this.#active.epoch < epoch) this.#active.controller.abort();
  }

  finish(signal: AbortSignal): void {
    if (this.#active?.controller.signal === signal) this.#active = undefined;
  }

  dispose(): void {
    this.#active?.controller.abort();
    this.#active = undefined;
  }
}
