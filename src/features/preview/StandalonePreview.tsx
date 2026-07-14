import { installHtmlPreview } from "@umber/umber-wasm/html-preview";
import { createEffect, onCleanup, onMount } from "solid-js";

export function StandalonePreview(props: { html: ArrayBuffer }) {
  let iframe: HTMLIFrameElement | undefined;
  let wrapper: HTMLDivElement | undefined;
  let source = "";
  let lastRender = "";

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
      `.umber-document{zoom:${scale.toFixed(4)}}\n.umber-run{width:100%;height:100%}\n</style>`,
    );
    installHtmlPreview(iframe, new TextEncoder().encode(fittedHtml));
  };

  onMount(() => {
    if (!wrapper) return;
    const observer = new ResizeObserver(render);
    observer.observe(wrapper);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    source = new TextDecoder().decode(props.html);
    lastRender = "";
    render();
  });

  return (
    <div ref={wrapper} class="standalone-preview-frame">
      <iframe ref={iframe} class="standalone-preview" title="Umber HTML preview" />
    </div>
  );
}
