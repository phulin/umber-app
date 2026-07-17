import type { ResourceRequest } from "@umber/umber-wasm/low-level";
import { describe, expect, it } from "vitest";
import {
  FontResourceRouter,
  TfmResourceResolver,
  Woff2OpenTypeResolver,
} from "./fontResourceResolvers";

const tfmRequest: ResourceRequest = {
  type: "file",
  domain: "tex",
  kind: "tfm",
  name: "cmr10.tfm",
  originalName: "cmr10.tfm",
};

const openTypeRequest: ResourceRequest = {
  type: "font",
  logicalName: "Libertinus Serif",
  faceIndex: 2,
  variations: [{ tag: "wght", value: 600 }],
  features: [{ tag: "liga", enabled: false }],
  acceptedContainers: ["woff2"],
};

const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]);

describe("font resource resolvers", () => {
  it("keeps classic TFM resolution independent from OpenType programs", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const resolver = new TfmResourceResolver([
      { name: "cmr10.tfm", virtualPath: "/texlive/fonts/tfm/cmr10.tfm", bytes },
    ]);

    expect(resolver.resolve(tfmRequest)).toEqual({
      type: "file",
      domain: "tex",
      kind: "tfm",
      name: "cmr10.tfm",
      virtualPath: "/texlive/fonts/tfm/cmr10.tfm",
      bytes,
    });
  });

  it("answers OpenType selections with WOFF2 alone", () => {
    const resolver = new Woff2OpenTypeResolver([
      {
        logicalName: "Libertinus Serif",
        woff2,
        objectSha256: "a".repeat(64),
        provenance: "test font",
      },
    ]);

    expect(resolver.resolve(openTypeRequest)).toEqual({
      type: "font",
      logicalName: "Libertinus Serif",
      faceIndex: 2,
      variations: [{ tag: "wght", value: 600 }],
      features: [{ tag: "liga", enabled: false }],
      container: "woff2",
      bytes: woff2,
      objectSha256: "a".repeat(64),
      programIdentity: undefined,
      provenance: "test font",
    });
  });

  it("rejects non-WOFF2 font assets at the OpenType boundary", () => {
    expect(
      () => new Woff2OpenTypeResolver([{ logicalName: "bad", woff2: new Uint8Array([0, 1]) }]),
    ).toThrow("not a WOFF2 container");
  });

  it("routes each model to its owner and reports unrelated resources as missing", () => {
    const router = new FontResourceRouter(
      new TfmResourceResolver([
        {
          name: "cmr10.tfm",
          virtualPath: "/texlive/fonts/tfm/cmr10.tfm",
          bytes: new Uint8Array([1]),
        },
      ]),
      new Woff2OpenTypeResolver([{ logicalName: "Libertinus Serif", woff2 }]),
    );
    const texRequest: ResourceRequest = {
      type: "file",
      domain: "tex",
      kind: "tex",
      name: "article.cls",
      originalName: "article.cls",
    };

    const result = router.resolve([tfmRequest, openTypeRequest, texRequest]);

    expect(result.responses).toHaveLength(2);
    expect(result.missing).toEqual([texRequest]);
  });
});
