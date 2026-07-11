import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncrementalPreview, splitPatchForFrames } from "./IncrementalPreview";
import type { PatchMessage } from "./previewDocument";

const html = (value: string) => new TextEncoder().encode(value).buffer;

const longDocumentPatch = (): PatchMessage => ({
  t: "patch",
  epoch: 1,
  pages: Array.from({ length: 10 }, (_, index) => ({
    pageId: `page-${index + 1}`,
    widthPt: 612,
    heightPt: 792,
    index,
  })),
  removePages: [],
  blocks: Array.from({ length: 10 }, (_, index) => ({
    pageId: `page-${index + 1}`,
    blockId: `block-${index + 1}`,
    html: html(`<p id="element-${index + 1}">Page ${index + 1}</p>`),
  })),
  removeBlocks: [],
  spans: [],
  final: true,
});

let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => window.clearTimeout(handle));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("IncrementalPreview", () => {
  it("keeps exact page spacers while mounting only the initial viewport plus overscan", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    dispose = render(() => <IncrementalPreview patch={longDocumentPatch()} />, root);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(root.querySelectorAll("[data-page-id]")).toHaveLength(10);
    expect(root.querySelectorAll(".preview-page-content")).toHaveLength(5);
    expect(root.textContent).toContain("Page 1");
    expect(root.textContent).not.toContain("Page 6");
    expect(root.querySelector<HTMLElement>('[data-page-id="page-1"]')?.style.height).toBe("1056px");
  });

  it("chunks large patch storms by page with viewport pages first", () => {
    const patch = longDocumentPatch();
    patch.pages = Array.from({ length: 30 }, (_, index) => ({
      pageId: `page-${index}`,
      widthPt: 612,
      heightPt: 792,
      index,
    }));
    patch.blocks = patch.pages.map((page) => ({
      pageId: page.pageId,
      blockId: `block-${page.index}`,
      html: html(`<p>Page ${page.index}</p>`),
    }));

    const chunks = splitPatchForFrames(patch, { first: 10, last: 12 }, [], 5);

    expect(chunks).toHaveLength(31);
    expect(chunks[0]).toMatchObject({ pages: [], blocks: [], final: false });
    expect(
      chunks
        .slice(1, 4)
        .map((chunk) => chunk.pages[0]?.index)
        .sort(),
    ).toEqual([10, 11, 12]);
    expect(chunks.at(-1)?.final).toBe(true);
  });
});
