import type { FromEngine, SourceSpan } from "../tex-compile/protocol";

export type PatchMessage = Extract<FromEngine, { t: "patch" }>;

export type PreviewBlock = {
  blockId: string;
  html: string;
};

export type PreviewPage = {
  pageId: string;
  widthPt: number;
  heightPt: number;
  index: number;
  blocks: readonly PreviewBlock[];
};

type MutablePage = Omit<PreviewPage, "blocks"> & { blocks: Map<string, PreviewBlock> };

export type PatchResult = {
  applied: boolean;
  epoch: number;
  touchedPageIds: ReadonlySet<string>;
  touchedDocIds: ReadonlySet<string>;
};

export class PreviewDocument {
  readonly #pages = new Map<string, MutablePage>();
  readonly #spans = new Map<string, SourceSpan>();
  readonly #decoder = new TextDecoder();
  #epoch = 0;

  get epoch(): number {
    return this.#epoch;
  }

  get pages(): readonly PreviewPage[] {
    return [...this.#pages.values()]
      .sort((left, right) => left.index - right.index)
      .map((page) => ({ ...page, blocks: [...page.blocks.values()] }));
  }

  get spans(): readonly SourceSpan[] {
    return [...this.#spans.values()];
  }

  spanForElement(elemId: string): SourceSpan | undefined {
    return this.#spans.get(elemId);
  }

  applyPatch(patch: PatchMessage): PatchResult {
    const touchedPageIds = new Set<string>();
    const touchedDocIds = new Set(patch.spans.map(({ docId }) => docId));
    if (patch.epoch < this.#epoch) {
      return {
        applied: false,
        epoch: this.#epoch,
        touchedPageIds,
        touchedDocIds,
      };
    }

    if (patch.epoch > this.#epoch) this.#spans.clear();
    this.#epoch = patch.epoch;

    for (const pageId of patch.removePages) {
      this.#pages.delete(pageId);
      touchedPageIds.add(pageId);
    }

    for (const nextPage of patch.pages) {
      const current = this.#pages.get(nextPage.pageId);
      this.#pages.set(nextPage.pageId, {
        ...nextPage,
        blocks: current?.blocks ?? new Map(),
      });
      touchedPageIds.add(nextPage.pageId);
    }

    for (const removal of patch.removeBlocks) {
      this.#pages.get(removal.pageId)?.blocks.delete(removal.blockId);
      touchedPageIds.add(removal.pageId);
    }

    for (const block of patch.blocks) {
      const page = this.#pages.get(block.pageId);
      if (!page) continue;
      page.blocks.set(block.blockId, {
        blockId: block.blockId,
        html: this.#decoder.decode(block.html),
      });
      touchedPageIds.add(block.pageId);
    }

    for (const span of patch.spans) this.#spans.set(span.elemId, span);

    return {
      applied: true,
      epoch: this.#epoch,
      touchedPageIds,
      touchedDocIds,
    };
  }
}
