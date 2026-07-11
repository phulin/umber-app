import { describe, expect, it } from "vitest";
import type { PatchMessage } from "./previewDocument";
import { PreviewDocument } from "./previewDocument";

const bytes = (value: string) => new TextEncoder().encode(value).buffer;

const patch = (overrides: Partial<PatchMessage> = {}): PatchMessage => ({
  t: "patch",
  epoch: 1,
  pages: [{ pageId: "p1", widthPt: 612, heightPt: 792, index: 0 }],
  removePages: [],
  blocks: [{ pageId: "p1", blockId: "b1", html: bytes('<p id="e1">Hello</p>') }],
  removeBlocks: [],
  spans: [{ elemId: "e1", docId: "main", byteStart: 0, byteEnd: 5 }],
  final: true,
  ...overrides,
});

describe("PreviewDocument", () => {
  it("adds, replaces, and removes stable page blocks", () => {
    const document = new PreviewDocument();
    document.applyPatch(patch());
    document.applyPatch(
      patch({
        blocks: [{ pageId: "p1", blockId: "b1", html: bytes('<p id="e1">Updated</p>') }],
        spans: [],
      }),
    );

    expect(document.pages[0]?.blocks).toEqual([{ blockId: "b1", html: '<p id="e1">Updated</p>' }]);

    document.applyPatch(patch({ blocks: [], removeBlocks: [{ pageId: "p1", blockId: "b1" }] }));
    expect(document.pages[0]?.blocks).toEqual([]);
    document.applyPatch(patch({ pages: [], blocks: [], removePages: ["p1"] }));
    expect(document.pages).toEqual([]);
  });

  it("accumulates streaming patches within one epoch", () => {
    const document = new PreviewDocument();
    document.applyPatch(patch({ final: false }));
    document.applyPatch(
      patch({
        pages: [],
        blocks: [{ pageId: "p1", blockId: "b2", html: bytes('<p id="e2">World</p>') }],
        spans: [{ elemId: "e2", docId: "main", byteStart: 6, byteEnd: 11 }],
      }),
    );

    expect(document.pages[0]?.blocks.map(({ blockId }) => blockId)).toEqual(["b1", "b2"]);
    expect(document.spans.map(({ elemId }) => elemId)).toEqual(["e1", "e2"]);
  });

  it("clears epoch-scoped spans and rejects stale patches", () => {
    const document = new PreviewDocument();
    document.applyPatch(patch());
    document.applyPatch(
      patch({
        epoch: 2,
        pages: [],
        blocks: [],
        spans: [{ elemId: "e2", docId: "main", byteStart: 8, byteEnd: 9 }],
      }),
    );
    const stale = document.applyPatch(patch({ epoch: 1 }));

    expect(stale.applied).toBe(false);
    expect(document.epoch).toBe(2);
    expect(document.spanForElement("e1")).toBeUndefined();
    expect(document.spanForElement("e2")).toBeDefined();
  });
});
