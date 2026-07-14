import { installHtmlPreview } from "@umber/umber-wasm/html-preview";
import { createEffect, onCleanup, onMount } from "solid-js";

export type RenderedPreviewHit = { page: number; event: number; unit?: number };
export type RenderedPreviewSelection = { start: RenderedPreviewHit; end: RenderedPreviewHit };

function textUnitAtPointer(element: Element, clientX: number, clientY: number): number | undefined {
  const run = element.closest<SVGSVGElement>("svg.umber-run");
  const text = run?.querySelector<SVGTextContentElement>(".umber-run-text");
  const matrix = run?.getScreenCTM();
  if (!run || !text || !matrix) return undefined;
  const point = run.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const unit = text.getCharNumAtPosition(point.matrixTransform(matrix.inverse()));
  return unit >= 0 ? unit : undefined;
}

export function renderedPreviewHit(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): RenderedPreviewHit | undefined {
  if (!target || typeof (target as Element).closest !== "function") return undefined;
  const eventElement = (target as Element).closest<HTMLElement>("[data-umber-event]");
  const pageElement = eventElement?.closest<HTMLElement>("[data-umber-page]");
  if (!eventElement || !pageElement) return undefined;
  const page = Number(pageElement.dataset.umberPage);
  const event = Number(eventElement.dataset.umberEvent);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(event) || event < 0)
    return undefined;
  return { page, event, unit: textUnitAtPointer(eventElement, clientX, clientY) };
}

function compareHits(left: RenderedPreviewHit, right: RenderedPreviewHit): number {
  return left.page - right.page || left.event - right.event || (left.unit ?? 0) - (right.unit ?? 0);
}

function orderedSelection(
  first: RenderedPreviewHit,
  second: RenderedPreviewHit,
): RenderedPreviewSelection {
  return compareHits(first, second) < 0
    ? { start: first, end: second }
    : { start: second, end: first };
}

function paintSelection(document: Document, { start, end }: RenderedPreviewSelection): void {
  const textAt = (hit: RenderedPreviewHit) =>
    document.querySelector<SVGTextContentElement>(
      `[data-umber-page="${hit.page}"] [data-umber-event="${hit.event}"] .umber-run-text`,
    );
  const startText = textAt(start);
  const endText = textAt(end);
  const startNode = startText?.firstChild;
  const endNode = endText?.firstChild;
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, Math.min(start.unit ?? 0, startNode.textContent?.length ?? 0));
  range.setEnd(endNode, Math.min((end.unit ?? 0) + 1, endNode.textContent?.length ?? 0));
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function paintCaret(document: Document, hit: RenderedPreviewHit): HTMLDivElement | undefined {
  if (hit.unit === undefined) return undefined;
  const text = document.querySelector<SVGTextContentElement>(
    `[data-umber-page="${hit.page}"] [data-umber-event="${hit.event}"] .umber-run-text`,
  );
  const svg = text?.ownerSVGElement;
  const matrix = text?.getScreenCTM();
  const view = document.defaultView;
  if (!text || !svg || !matrix || !view || hit.unit >= text.getNumberOfChars()) return undefined;
  const extent = text.getExtentOfChar(hit.unit);
  const top = svg.createSVGPoint();
  top.x = extent.x;
  top.y = extent.y;
  const bottom = svg.createSVGPoint();
  bottom.x = extent.x;
  bottom.y = extent.y + extent.height;
  const clientTop = top.matrixTransform(matrix);
  const clientBottom = bottom.matrixTransform(matrix);
  const caret = document.createElement("div");
  caret.className = "umber-source-caret";
  caret.setAttribute("aria-hidden", "true");
  Object.assign(caret.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "2147483647",
    left: `${clientTop.x + view.scrollX}px`,
    top: `${Math.min(clientTop.y, clientBottom.y) + view.scrollY}px`,
    width: "2px",
    height: `${Math.max(1, Math.abs(clientBottom.y - clientTop.y))}px`,
    background: "#27615d",
    boxShadow: "0 0 0 1px rgb(255 253 248 / 65%)",
  });
  document.body.append(caret);
  caret.animate([{ opacity: 1 }, { opacity: 1 }, { opacity: 0 }], {
    duration: 1200,
    iterations: Number.POSITIVE_INFINITY,
    easing: "steps(1, end)",
  });
  return caret;
}

export function StandalonePreview(props: {
  html: ArrayBuffer;
  onRenderedSource?: (hit: RenderedPreviewHit) => void;
  onRenderedSelection?: (selection: RenderedPreviewSelection) => void;
  clearCaretRequestId?: number;
}) {
  let iframe: HTMLIFrameElement | undefined;
  let wrapper: HTMLDivElement | undefined;
  let source = "";
  let lastRender = "";
  let detachPreviewClick: (() => void) | undefined;
  let previewCaret: HTMLDivElement | undefined;

  const clearPreviewCaret = () => {
    previewCaret?.remove();
    previewCaret = undefined;
  };

  const attachPreviewClick = () => {
    detachPreviewClick?.();
    const document = iframe?.contentDocument;
    if (!document) return;
    previewCaret = undefined;
    let dragStart: RenderedPreviewHit | undefined;
    const onClick = (event: MouseEvent) => {
      if (!document.getSelection()?.isCollapsed) return;
      const hit = renderedPreviewHit(event.target, event.clientX, event.clientY);
      if (hit) {
        clearPreviewCaret();
        previewCaret = paintCaret(document, hit);
        props.onRenderedSource?.(hit);
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      dragStart = renderedPreviewHit(event.target, event.clientX, event.clientY);
      if (dragStart) {
        clearPreviewCaret();
        document.getSelection()?.removeAllRanges();
        event.preventDefault();
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!dragStart) return;
      const dragEnd = renderedPreviewHit(event.target, event.clientX, event.clientY);
      if (!dragEnd || compareHits(dragStart, dragEnd) === 0) return;
      event.preventDefault();
      paintSelection(document, orderedSelection(dragStart, dragEnd));
    };
    const onMouseUp = (event: MouseEvent) => {
      const dragEnd = renderedPreviewHit(event.target, event.clientX, event.clientY);
      if (!dragStart || !dragEnd || compareHits(dragStart, dragEnd) === 0) {
        dragStart = undefined;
        return;
      }
      const rendered = orderedSelection(dragStart, dragEnd);
      dragStart = undefined;
      paintSelection(document, rendered);
      props.onRenderedSelection?.(rendered);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    detachPreviewClick = () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  };

  const render = () => {
    if (!iframe || !wrapper || !source) return;
    const widths = [...source.matchAll(/class="umber-page"[^>]*style="width:([\d.]+)px/g)].map(
      (match) => Number(match[1]),
    );
    const widestPage = Math.max(...widths, 1);
    const scale = Math.min(1, Math.max(0.1, (wrapper.clientWidth - 24) / widestPage));
    const renderKey = `${source.length}:${scale.toFixed(4)}`;
    if (renderKey === lastRender) return;
    lastRender = renderKey;
    const fittedHtml = source.replace(
      "</style>",
      `.umber-document{zoom:${scale.toFixed(4)}}\n.umber-run{width:100%;height:100%;pointer-events:none}\n.umber-run-text{pointer-events:visiblePainted}\n</style>`,
    );
    installHtmlPreview(iframe, new TextEncoder().encode(fittedHtml), { allowDomAccess: true });
  };

  onMount(() => {
    if (!wrapper) return;
    const observer = new ResizeObserver(render);
    observer.observe(wrapper);
    iframe?.addEventListener("load", attachPreviewClick);
    onCleanup(() => {
      observer.disconnect();
      iframe?.removeEventListener("load", attachPreviewClick);
      detachPreviewClick?.();
    });
  });

  createEffect(() => {
    source = new TextDecoder().decode(props.html);
    lastRender = "";
    render();
  });

  createEffect(() => {
    props.clearCaretRequestId;
    clearPreviewCaret();
  });

  return (
    <div ref={wrapper} class="standalone-preview-frame">
      <iframe ref={iframe} class="standalone-preview" title="Umber HTML preview" />
    </div>
  );
}
