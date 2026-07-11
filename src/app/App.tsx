import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CodeEditor, type EditorCursor, type EditorDelta } from "../features/editor/CodeEditor";
import { Utf8OffsetMap } from "../features/editor/utf8OffsetMap";
import { IncrementalPreview } from "../features/preview/IncrementalPreview";
import type { PatchMessage } from "../features/preview/previewDocument";
import { SpanIndex } from "../features/sync/spanIndex";
import { paragraphEditReplay } from "../features/tex-compile/__fixtures__/paragraph-edit";
import { CompileOrchestrator } from "../features/tex-compile/compileOrchestrator";
import { FakeEngineTransport } from "../features/tex-compile/engineTransport";
import type { Diagnostic, SourceSpan } from "../features/tex-compile/protocol";

const milestones = [
  "Lock engine protocol",
  "Render incremental HTML",
  "Cache TeX resources in OPFS",
  "Synchronize source and preview",
  "Persist and export projects",
  "Validate launch performance",
];

const initialMain = String.raw`\documentclass{article}
\begin{document}
Hello, Umber.
\end{document}`;

const initialBibliography = `@book{umber,
  title = {Browser-Native TeX},
  year = {2026}
}`;

export function App() {
  const [mainSource, setMainSource] = createSignal(initialMain);
  const [bibliography, setBibliography] = createSignal(initialBibliography);
  const documents = [
    { id: "main", path: "main.tex", text: mainSource, setText: setMainSource },
    { id: "references", path: "references.bib", text: bibliography, setText: setBibliography },
  ];
  const [activeDocId, setActiveDocId] = createSignal("main");
  const [engineStatus, setEngineStatus] = createSignal("Starting fake engine…");
  const [previewPatch, setPreviewPatch] = createSignal<PatchMessage>();
  const [previewEpoch, setPreviewEpoch] = createSignal(0);
  const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
  const [diagnosticEpoch, setDiagnosticEpoch] = createSignal(0);
  const [highlightedElementId, setHighlightedElementId] = createSignal<string>();
  const [cursorTarget, setCursorTarget] = createSignal<{
    docId: string;
    offset: number;
    requestId: number;
  }>();
  const spans = new SpanIndex();
  const orchestrator = new CompileOrchestrator(new FakeEngineTransport(paragraphEditReplay));
  let cursorRequestId = 0;

  const jumpToSource = (docId: string, byteOffset: number) => {
    const document = documents.find(({ id }) => id === docId);
    if (!document) return;
    const offsets = new Utf8OffsetMap(document.text());
    const utf16Offset = offsets.byteToUtf16(Math.min(byteOffset, offsets.byteLength));
    setActiveDocId(docId);
    setCursorTarget({ docId, offset: utf16Offset, requestId: ++cursorRequestId });
  };

  const handleCursor = (cursor: EditorCursor) => {
    const span = spans.innermost(cursor.docId, cursor.byteOffset);
    setHighlightedElementId(span?.elemId);
  };

  const handlePreviewSpan = (span: SourceSpan) => jumpToSource(span.docId, span.byteStart);
  const handleEdit = (delta: EditorDelta) => orchestrator.submitEdit(delta);

  onMount(() => {
    const unsubscribe = orchestrator.subscribe((message) => {
      if (message.t === "ready") setEngineStatus(`Ready · ${message.engineVersion}`);
      if (message.t === "progress") {
        setEngineStatus(message.detail ? `${message.phase} · ${message.detail}` : message.phase);
      }
      if (message.t === "saturated") {
        setEngineStatus(`Compiling · ${message.queuedDeltas} edits queued`);
      }
      if (message.t === "patch") {
        setPreviewPatch(message);
        setPreviewEpoch(message.epoch);
        spans.apply(message.epoch, message.spans);
      }
      if (message.t === "diagnostics" && message.epoch >= diagnosticEpoch()) {
        setDiagnosticEpoch(message.epoch);
        setDiagnostics(message.items);
      }
      if (message.t === "fatal") setEngineStatus(`Engine restarting · ${message.message}`);
    });

    orchestrator.initialize(
      { t: "init", bundleDigest: "demo-bundle", engineOpts: { mode: "fake" } },
      {
        entry: "main.tex",
        files: documents.map((document) => ({
          docId: document.id,
          path: document.path,
          bytes: new TextEncoder().encode(document.text()).buffer,
        })),
      },
    );
    onCleanup(unsubscribe);
  });

  onCleanup(() => orchestrator.dispose());

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Umber</p>
          <h1>Local LaTeX workspace</h1>
        </div>
        <button class="primary-action" type="button">
          New Project
        </button>
      </header>

      <section class="compile-activity" role="status" aria-live="polite">
        <span class="activity-dot" aria-hidden="true" />
        <span>{engineStatus()}</span>
      </section>

      <section class="workspace-grid" aria-label="Workspace preview">
        <aside class="panel file-tree">
          <div class="panel-heading">
            <span>Project</span>
            <span class="muted">Demo project</span>
          </div>
          <ul>
            <For each={documents}>
              {(document) => (
                <li>
                  <button
                    type="button"
                    classList={{ active: activeDocId() === document.id }}
                    onClick={() => setActiveDocId(document.id)}
                  >
                    {document.path}
                  </button>
                </li>
              )}
            </For>
            <li class="folder-label">figures/</li>
          </ul>
        </aside>

        <section class="panel editor-panel">
          <div class="editor-tabs" role="tablist" aria-label="Open files">
            <For each={documents}>
              {(document) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeDocId() === document.id}
                  onClick={() => setActiveDocId(document.id)}
                >
                  {document.path}
                </button>
              )}
            </For>
          </div>
          <For each={documents}>
            {(document) => (
              <div hidden={activeDocId() !== document.id}>
                <CodeEditor
                  docId={document.id}
                  value={document.text()}
                  diagnostics={diagnostics().filter(({ docId }) => docId === document.id)}
                  cursorTarget={cursorTarget()?.docId === document.id ? cursorTarget() : undefined}
                  onChange={document.setText}
                  onDelta={handleEdit}
                  onCursor={handleCursor}
                />
              </div>
            )}
          </For>
        </section>

        <section class="panel preview-panel">
          <div class="panel-heading">
            <span>HTML Preview</span>
            <span class="muted">Epoch {previewEpoch()}</span>
          </div>
          <IncrementalPreview
            patch={previewPatch()}
            highlightedElementId={highlightedElementId()}
            onSourceSpan={handlePreviewSpan}
          />
        </section>
      </section>

      <section class="bottom-panel">
        <div>
          <h2>MVP path</h2>
          <ol>
            <For each={milestones}>{(milestone) => <li>{milestone}</li>}</For>
          </ol>
        </div>
        <div>
          <h2>Diagnostics</h2>
          <Show when={diagnostics().length > 0} fallback={<p>No diagnostics.</p>}>
            <ul class="diagnostic-list">
              <For each={diagnostics()}>
                {(diagnostic) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => jumpToSource(diagnostic.docId, diagnostic.byteStart)}
                    >
                      <span class={`diagnostic-${diagnostic.severity}`}>{diagnostic.severity}</span>
                      {diagnostic.docId}:{diagnostic.byteStart} · {diagnostic.message}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </section>
    </main>
  );
}
