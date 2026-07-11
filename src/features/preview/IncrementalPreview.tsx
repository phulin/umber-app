import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { SourceSpan } from "../tex-compile/protocol";
import type { PatchMessage, PreviewPage } from "./previewDocument";
import { PreviewDocument } from "./previewDocument";

type IncrementalPreviewProps = {
  patch?: PatchMessage;
  overscanPages?: number;
  highlightedElementId?: string;
  onSourceSpan?: (span: SourceSpan) => void;
};

type Anchor = { pageId: string; top: number };

const ptToPx = (points: number) => points * (96 / 72);

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return window.setTimeout(() => callback(performance.now()), 0);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

function PageBody(props: { page: PreviewPage }) {
  let element: HTMLDivElement | undefined;

  createEffect(() => {
    const detached = document.createElement("div");
    detached.innerHTML = props.page.blocks.map(({ html }) => html).join("");
    element?.replaceChildren(...detached.childNodes);
  });

  return <div ref={element} class="preview-page-content" />;
}

export function IncrementalPreview(props: IncrementalPreviewProps) {
  const model = new PreviewDocument();
  const [revision, setRevision] = createSignal(0);
  const [visibleRange, setVisibleRange] = createSignal({ first: 0, last: 4 });
  const queuedPatches: PatchMessage[] = [];
  let scroller: HTMLDivElement | undefined;
  let frameHandle: number | undefined;
  let highlightedElement: HTMLElement | undefined;

  const pages = createMemo(() => {
    revision();
    return model.pages;
  });

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
    const anchor = captureAnchor();
    let changed = false;
    for (const patch of queuedPatches.splice(0)) {
      changed = model.applyPatch(patch).applied || changed;
    }
    if (!changed) return;
    setRevision((value) => value + 1);
    frameHandle = requestFrame(() => {
      frameHandle = undefined;
      restoreAnchor(anchor);
      updateVisibleRange();
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
        <For each={pages()}>
          {(page, index) => {
            const mounted = () => {
              const range = visibleRange();
              return index() >= range.first && index() <= range.last;
            };
            return (
              <article
                class="preview-page-shell"
                data-page-id={page.pageId}
                data-page-index={index()}
                style={{
                  width: `${ptToPx(page.widthPt)}px`,
                  height: `${ptToPx(page.heightPt)}px`,
                }}
              >
                <Show when={mounted()}>
                  <PageBody page={page} />
                </Show>
              </article>
            );
          }}
        </For>
      </Show>
    </div>
  );
}
