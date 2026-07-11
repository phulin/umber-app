import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { SourceSpan } from "../tex-compile/protocol";
import type { PatchMessage, PreviewBlock, PreviewPage } from "./previewDocument";
import { PreviewDocument } from "./previewDocument";

type IncrementalPreviewProps = {
  patch?: PatchMessage;
  overscanPages?: number;
  highlightedElementId?: string;
  onSourceSpan?: (span: SourceSpan) => void;
  onPatchApplied?: (result: { epoch: number; durationMs: number }) => void;
};

type Anchor = { pageId: string; top: number };
type VisibleRange = { first: number; last: number };
type PatchWork = { chunks: PatchMessage[]; epoch: number; workMs: number; applied: boolean };

const ptToPx = (points: number) => points * (96 / 72);
const frameBudgetMs = 8;
const chunkThresholdPages = 20;

export function splitPatchForFrames(
  patch: PatchMessage,
  visible: VisibleRange,
  currentPages: readonly PreviewPage[] = [],
  threshold = chunkThresholdPages,
): PatchMessage[] {
  const pageIds = new Set([
    ...patch.pages.map(({ pageId }) => pageId),
    ...patch.blocks.map(({ pageId }) => pageId),
    ...patch.removeBlocks.map(({ pageId }) => pageId),
  ]);
  if (pageIds.size <= threshold) return [patch];

  const pageMetadata = new Map(
    [...currentPages, ...patch.pages].map((page) => [page.pageId, page] as const),
  );
  const center = (visible.first + visible.last) / 2;
  const orderedPageIds = [...pageIds].sort((left, right) => {
    const leftIndex = pageMetadata.get(left)?.index ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = pageMetadata.get(right)?.index ?? Number.MAX_SAFE_INTEGER;
    const leftVisible = leftIndex >= visible.first && leftIndex <= visible.last;
    const rightVisible = rightIndex >= visible.first && rightIndex <= visible.last;
    if (leftVisible !== rightVisible) return leftVisible ? -1 : 1;
    return Math.abs(leftIndex - center) - Math.abs(rightIndex - center) || leftIndex - rightIndex;
  });

  const chunks: PatchMessage[] = [
    {
      ...patch,
      pages: [],
      blocks: [],
      removeBlocks: [],
      final: false,
    },
  ];
  for (const [position, pageId] of orderedPageIds.entries()) {
    chunks.push({
      t: "patch",
      epoch: patch.epoch,
      pages: patch.pages.filter((page) => page.pageId === pageId),
      removePages: [],
      blocks: patch.blocks.filter((block) => block.pageId === pageId),
      removeBlocks: patch.removeBlocks.filter((block) => block.pageId === pageId),
      spans: [],
      final: patch.final && position === orderedPageIds.length - 1,
    });
  }
  return chunks;
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

function PreviewBlockBody(props: { block: PreviewBlock }) {
  let element: HTMLDivElement | undefined;

  createEffect(() => {
    const detached = document.createElement("div");
    detached.innerHTML = props.block.html;
    element?.replaceChildren(...detached.childNodes);
  });

  return <div ref={element} class="preview-block-root" data-block-id={props.block.blockId} />;
}

function PageBody(props: { page: PreviewPage }) {
  return (
    <div class="preview-page-content">
      <For each={props.page.blocks}>{(block) => <PreviewBlockBody block={block} />}</For>
    </div>
  );
}

export function IncrementalPreview(props: IncrementalPreviewProps) {
  const model = new PreviewDocument();
  const [revision, setRevision] = createSignal(0);
  const [visibleRange, setVisibleRange] = createSignal({ first: 0, last: 4 });
  const queuedPatches: PatchMessage[] = [];
  let scroller: HTMLDivElement | undefined;
  let frameHandle: number | undefined;
  let highlightedElement: HTMLElement | undefined;
  let activeWork: PatchWork | undefined;

  const pages = createMemo(() => {
    revision();
    return model.pages;
  });
  const pageMap = createMemo(() => new Map(pages().map((page) => [page.pageId, page] as const)));
  const pageIds = createMemo(() => pages().map(({ pageId }) => pageId));

  const captureAnchor = (): Anchor | undefined => {
    if (!scroller) return undefined;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const elements = scroller.querySelectorAll<HTMLElement>("[data-page-id]");
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > scrollerTop) {
        return { pageId: element.dataset.pageId ?? "", top: rect.top };
      }
    }
    return undefined;
  };

  const restoreAnchor = (anchor: Anchor | undefined) => {
    if (!anchor || !scroller) return;
    const element = scroller.querySelector<HTMLElement>(`[data-page-id="${anchor.pageId}"]`);
    if (element) scroller.scrollTop += element.getBoundingClientRect().top - anchor.top;
  };

  const updateVisibleRange = () => {
    if (!scroller) return;
    const overscan = props.overscanPages ?? 2;
    const viewport = scroller.getBoundingClientRect();
    if (viewport.height === 0) return;
    const elements = [...scroller.querySelectorAll<HTMLElement>("[data-page-index]")];
    const visible = elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
    });
    if (visible.length === 0) return;
    const indices = visible.map((element) => Number(element.dataset.pageIndex));
    setVisibleRange({
      first: Math.max(0, Math.min(...indices) - overscan),
      last: Math.min(elements.length - 1, Math.max(...indices) + overscan),
    });
  };

  const flushPatches = () => {
    frameHandle = undefined;
    if (!activeWork) {
      const patch = queuedPatches.shift();
      if (!patch) return;
      activeWork = {
        chunks: splitPatchForFrames(patch, visibleRange(), model.pages),
        epoch: patch.epoch,
        workMs: 0,
        applied: false,
      };
    }
    const anchor = captureAnchor();
    let changed = false;
    const frameStartedAt = performance.now();
    do {
      const chunk = activeWork.chunks.shift();
      if (!chunk) break;
      const applied = model.applyPatch(chunk).applied;
      activeWork.applied = applied || activeWork.applied;
      changed = applied || changed;
    } while (activeWork.chunks.length > 0 && performance.now() - frameStartedAt < frameBudgetMs);
    activeWork.workMs += performance.now() - frameStartedAt;
    if (changed) {
      const renderStartedAt = performance.now();
      setRevision((value) => value + 1);
      activeWork.workMs += performance.now() - renderStartedAt;
    }
    frameHandle = requestFrame(() => {
      frameHandle = undefined;
      restoreAnchor(anchor);
      updateVisibleRange();
      if (activeWork?.chunks.length === 0) {
        if (activeWork.applied) {
          props.onPatchApplied?.({ epoch: activeWork.epoch, durationMs: activeWork.workMs });
        }
        activeWork = undefined;
      }
      if (activeWork || queuedPatches.length > 0) frameHandle = requestFrame(flushPatches);
    });
  };

  createEffect(() => {
    const patch = props.patch;
    if (!patch) return;
    queuedPatches.push(patch);
    if (frameHandle === undefined) frameHandle = requestFrame(flushPatches);
  });

  createEffect(() => {
    revision();
    const elemId = props.highlightedElementId;
    highlightedElement?.classList.remove("source-sync-highlight");
    highlightedElement = undefined;
    if (!elemId || !scroller) return;
    const element = [...scroller.querySelectorAll<HTMLElement>("[id]")].find(
      (candidate) => candidate.id === elemId,
    );
    if (!element) return;
    element.classList.add("source-sync-highlight");
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    highlightedElement = element;
  });

  onMount(updateVisibleRange);
  onCleanup(() => {
    if (frameHandle !== undefined) cancelFrame(frameHandle);
  });

  return (
    <div
      ref={scroller}
      class="preview-canvas"
      onScroll={updateVisibleRange}
      onPointerDown={(event) => {
        const element = (event.target as Element).closest<HTMLElement>("[id]");
        if (!element || !scroller?.contains(element)) return;
        const span = model.spanForElement(element.id);
        if (span) {
          event.preventDefault();
          props.onSourceSpan?.(span);
        }
      }}
    >
      <Show
        when={pages().length > 0}
        fallback={<div class="preview-empty">Waiting for a patch…</div>}
      >
        <For each={pageIds()}>
          {(pageId, index) => {
            const page = () => pageMap().get(pageId);
            const mounted = () => {
              const range = visibleRange();
              return index() >= range.first && index() <= range.last;
            };
            return (
              <Show when={page()}>
                {(currentPage) => (
                  <article
                    class="preview-page-shell"
                    data-page-id={pageId}
                    data-page-index={index()}
                    style={{
                      width: `${ptToPx(currentPage().widthPt)}px`,
                      height: `${ptToPx(currentPage().heightPt)}px`,
                    }}
                  >
                    <Show when={mounted()}>
                      <PageBody page={currentPage()} />
                    </Show>
                  </article>
                )}
              </Show>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
