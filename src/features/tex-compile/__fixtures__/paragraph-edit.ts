import type { FakeEngineStep } from "../engineTransport";
import type { FromEngine } from "../protocol";

const html = (value: string) => new TextEncoder().encode(value).buffer;

export const paragraphEditGolden: FromEngine[] = [
  { t: "ready", engineVersion: "fake-1.0.0" },
  { t: "progress", epoch: 1, phase: "typesetting" },
  {
    t: "patch",
    epoch: 1,
    pages: [{ pageId: "page-1", widthPt: 612, heightPt: 792, index: 0 }],
    removePages: [],
    blocks: [
      {
        pageId: "page-1",
        blockId: "paragraph-1",
        html: html('<p id="span-1" style="position:absolute;left:72pt;top:72pt">Hello, Umber.</p>'),
      },
    ],
    removeBlocks: [],
    spans: [{ elemId: "span-1", docId: "main", byteStart: 41, byteEnd: 54 }],
    final: false,
  },
  {
    t: "diagnostics",
    epoch: 1,
    items: [
      {
        severity: "warning",
        docId: "main",
        byteStart: 41,
        byteEnd: 54,
        message: "Fake engine source-span check",
      },
    ],
  },
  { t: "progress", epoch: 1, phase: "idle" },
];

export const paragraphEditReplay: FakeEngineStep[] = [
  { afterMessage: "init", emit: paragraphEditGolden[0] },
  ...paragraphEditGolden.slice(1).map((emit) => ({ afterMessage: "openProject" as const, emit })),
];
