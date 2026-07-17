import type { ResourceRequest, ResourceResponse } from "@umber/umber-wasm/low-level";
import { describe, expect, it, vi } from "vitest";
import {
  FontResourceRouter,
  TfmResourceResolver,
  Woff2OpenTypeResolver,
} from "./fontResourceResolvers";
import {
  CompileAbortCoordinator,
  type DistributionResolver,
  resolveResourceBatch,
} from "./resourceResolution";

const localTfm: ResourceRequest = {
  type: "file",
  domain: "tex",
  kind: "tfm",
  name: "cmr10.tfm",
  originalName: "cmr10.tfm",
};

const packageFile: ResourceRequest = {
  type: "file",
  domain: "tex",
  kind: "tex",
  name: "example.sty",
  originalName: "example.sty",
};

const hint: ResourceRequest = {
  type: "file",
  domain: "tex",
  kind: "tex",
  name: "dependency.sty",
  originalName: "dependency.sty",
};

const local = () =>
  new FontResourceRouter(
    new TfmResourceResolver([
      {
        name: "cmr10.tfm",
        virtualPath: "/texlive/fonts/tfm/cmr10.tfm",
        bytes: new Uint8Array([1]),
      },
    ]),
    new Woff2OpenTypeResolver([]),
  );

describe("distribution resource resolution", () => {
  it("keeps packaged resources local and forwards only misses plus prefetch hints", async () => {
    const remoteResponse: ResourceResponse = {
      type: "file",
      domain: "tex",
      kind: "tex",
      name: "example.sty",
      virtualPath: "/texlive/tex/latex/example/example.sty",
      bytes: new Uint8Array([2]),
    };
    const resolve = vi.fn(async () => [remoteResponse]);
    const signal = new AbortController().signal;

    const responses = await resolveResourceBatch(
      local(),
      { resolve } as DistributionResolver,
      [localTfm, packageFile],
      [hint],
      signal,
    );

    expect(resolve).toHaveBeenCalledWith([packageFile], { signal, prefetchHints: [hint] });
    expect(responses.map(({ type }) => type)).toEqual(["file", "file"]);
    expect(responses[0]).toMatchObject({ name: "cmr10.tfm" });
    expect(responses[1]).toBe(remoteResponse);
  });

  it("preserves typed unavailable responses", async () => {
    const unavailable: ResourceResponse = {
      type: "file-unavailable",
      domain: "tex",
      kind: "tex",
      name: "example.sty",
    };
    const responses = await resolveResourceBatch(
      local(),
      { resolve: async () => [unavailable] },
      [packageFile],
      [],
      new AbortController().signal,
    );

    expect(responses).toEqual([unavailable]);
  });

  it("normalizes the resolver's legacy download declaration", async () => {
    const bytes = new Uint8Array([3]);
    const responses = await resolveResourceBatch(
      local(),
      {
        resolve: async () => [
          {
            request: { kind: "tex", name: "example.sty" },
            virtualPath: "/texlive/example.sty",
            bytes,
          },
        ],
      },
      [packageFile],
      [],
      new AbortController().signal,
    );

    expect(responses).toEqual([
      {
        type: "file",
        domain: "tex",
        kind: "tex",
        name: "example.sty",
        virtualPath: "/texlive/example.sty",
        bytes,
      },
    ]);
  });
});

describe("compile cancellation", () => {
  it("aborts only work older than the cancellation epoch", () => {
    const coordinator = new CompileAbortCoordinator();
    const current = coordinator.begin(2);

    coordinator.cancelBefore(2);
    expect(current.aborted).toBe(false);

    coordinator.cancelBefore(3);
    expect(current.aborted).toBe(true);
  });

  it("aborts prior work when a new compile begins or the engine is disposed", () => {
    const coordinator = new CompileAbortCoordinator();
    const first = coordinator.begin(1);
    const second = coordinator.begin(2);

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);

    coordinator.dispose();
    expect(second.aborted).toBe(true);
  });
});
