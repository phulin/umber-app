import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { CodeEditor, type EditorCursor, type EditorDelta } from "../features/editor/CodeEditor";
import { Utf8OffsetMap } from "../features/editor/utf8OffsetMap";
import {
  type LatencySummary,
  PerformanceMonitor,
} from "../features/performance/performanceMonitor";
import { FontManager } from "../features/preview/fontManager";
import { IncrementalPreview } from "../features/preview/IncrementalPreview";
import type { PatchMessage } from "../features/preview/previewDocument";
import { type RenderedPreviewHit, StandalonePreview } from "../features/preview/StandalonePreview";
import { ProjectAutosave } from "../features/projects/autosave";
import { exportProjectZip } from "../features/projects/projectArchive";
import type { ProjectStore } from "../features/projects/projectStore";
import { BundleResolver } from "../features/resources/bundleResolver";
import { createResourceCache } from "../features/resources/resourceCache";
import { SpanIndex } from "../features/sync/spanIndex";
import { TelemetryClient } from "../features/telemetry/telemetry";
import { CompileOrchestrator } from "../features/tex-compile/compileOrchestrator";
import { createDemoEngineTransport } from "../features/tex-compile/demoEngineTransport";
import {
  createWasmWorkerTransport,
  type EngineTransport,
  RestartableEngineTransport,
} from "../features/tex-compile/engineTransport";
import type {
  CompileMode,
  Diagnostic,
  ProjectFile,
  RenderedSourceLocation,
  SourceSpan,
} from "../features/tex-compile/protocol";

export type WorkspaceDocument = { id: string; path: string; text: string };
export type WorkspaceBinaryFile = { id: string; path: string; bytes: Uint8Array };

export function workspaceProjectFiles(
  documents: readonly WorkspaceDocument[],
  binaryFiles: readonly WorkspaceBinaryFile[],
): ProjectFile[] {
  return [
    ...documents.map((document) => ({
      docId: document.id,
      path: document.path,
      bytes: new TextEncoder().encode(document.text).buffer,
    })),
    ...binaryFiles.map((file) => {
      const copy = new Uint8Array(file.bytes.byteLength);
      copy.set(file.bytes);
      return { docId: file.id, path: file.path, bytes: copy.buffer };
    }),
  ];
}

type WorkspaceProps = {
  name: string;
  documents: readonly WorkspaceDocument[];
  binaryFiles?: readonly WorkspaceBinaryFile[];
  entry: string;
  compileMode: CompileMode;
  readOnly?: boolean;
  project?: { id: string; store: ProjectStore; downloadable?: boolean };
  onCopyDemo?: (documents: readonly WorkspaceDocument[]) => void | Promise<void>;
  engineTransport?: EngineTransport;
};

export function Workspace(props: WorkspaceProps) {
  const engineModuleUrl = import.meta.env.VITE_TEX_ENGINE_MODULE_URL as string | undefined;
  const bundleBaseUrl = import.meta.env.VITE_TEX_BUNDLE_BASE_URL as string | undefined;
  const configuredDigest = import.meta.env.VITE_TEX_BUNDLE_DIGEST as string | undefined;
  const liveEngine = Boolean(engineModuleUrl && bundleBaseUrl && configuredDigest);
  const bundleDigest = configuredDigest || "demo-bundle";
  const documents = props.documents.map((document) => {
    const [text, setText] = createSignal(document.text);
    return { ...document, text, setText };
  });
  const entryDocument = documents.find(({ path }) => path === props.entry) ?? documents[0];
  const [engineStatus, setEngineStatus] = createSignal("Starting engine…");
  const [recoveryNotice, setRecoveryNotice] = createSignal<string>();
  const [previewPatch, setPreviewPatch] = createSignal<PatchMessage>();
  const [previewDocument, setPreviewDocument] = createSignal<ArrayBuffer>();
  const [previewEpoch, setPreviewEpoch] = createSignal(0);
  const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
  const [diagnosticEpoch, setDiagnosticEpoch] = createSignal(0);
  const [highlightedElementId, setHighlightedElementId] = createSignal<string>();
  const [latency, setLatency] = createSignal<LatencySummary>({ samples: 0 });
  const [cursorTarget, setCursorTarget] = createSignal<{
    docId: string;
    offset: number;
    endOffset?: number;
    requestId: number;
  }>();
  const [previewCaretClearRequestId, setPreviewCaretClearRequestId] = createSignal(0);
  const spans = new SpanIndex();
  const performanceMonitor = new PerformanceMonitor();
  const telemetry = new TelemetryClient();
  const [telemetryEnabled, setTelemetryEnabled] = createSignal(telemetry.enabled);
  const orchestrator = new CompileOrchestrator(
    props.engineTransport ??
      (typeof Worker === "function"
        ? new RestartableEngineTransport(createWasmWorkerTransport)
        : createDemoEngineTransport()),
  );
  const fontManager =
    liveEngine && bundleBaseUrl
      ? createResourceCache(bundleDigest).then((cache) => {
          const resolver = new BundleResolver({
            bundleDigest,
            baseUrl: bundleBaseUrl,
            cache,
            onMetric: (metric) => telemetry.recordHealth(metric),
          });
          return new FontManager({ get: (hash) => resolver.getFile(hash) });
        })
      : undefined;
  let autosave: ProjectAutosave | undefined;
  let detachLifecycle: (() => void) | undefined;
  let cursorRequestId = 0;
  let renderedSourceRequestId = 0;
  let renderedSelectionId = 0;
  const renderedSelectionQueries = new Map<
    number,
    { selectionId: number; edge: "start" | "end" }
  >();
  const renderedSelectionResults = new Map<
    number,
    { start?: RenderedSourceLocation; end?: RenderedSourceLocation }
  >();

  const jumpToSource = (docId: string, byteOffset: number) => {
    const document = documents.find(({ id }) => id === docId);
    if (!document) return;
    const offsets = new Utf8OffsetMap(document.text());
    const utf16Offset = offsets.byteToUtf16(Math.min(byteOffset, offsets.byteLength));
    setCursorTarget({ docId, offset: utf16Offset, requestId: ++cursorRequestId });
  };

  const jumpToSourcePath = (path: string, byteOffset: number) => {
    const projectPath = path.startsWith("/job/") ? path.slice("/job/".length) : path;
    const document = documents.find((candidate) => candidate.path === projectPath);
    if (document) jumpToSource(document.id, byteOffset);
  };

  const jumpToSourceRange = (path: string, byteStart: number, byteEnd: number) => {
    const projectPath = path.startsWith("/job/") ? path.slice("/job/".length) : path;
    const document = documents.find((candidate) => candidate.path === projectPath);
    if (!document) return;
    const offsets = new Utf8OffsetMap(document.text());
    setCursorTarget({
      docId: document.id,
      offset: offsets.byteToUtf16(Math.min(byteStart, offsets.byteLength)),
      endOffset: offsets.byteToUtf16(Math.min(byteEnd, offsets.byteLength)),
      requestId: ++cursorRequestId,
    });
  };

  const requestRenderedSelection = (start: RenderedPreviewHit, end: RenderedPreviewHit) => {
    const selectionId = ++renderedSelectionId;
    renderedSelectionResults.set(selectionId, {});
    for (const [edge, hit] of [
      ["start", start],
      ["end", end],
    ] as const) {
      const requestId = ++renderedSourceRequestId;
      renderedSelectionQueries.set(requestId, { selectionId, edge });
      orchestrator.requestRenderedSource(requestId, hit.page, hit.event, hit.unit);
    }
  };

  const handleCursor = (cursor: EditorCursor) => {
    const span = spans.innermost(cursor.docId, cursor.byteOffset);
    setHighlightedElementId(span?.elemId);
  };

  const handleEdit = (delta: EditorDelta) => {
    performanceMonitor.beginEdit();
    orchestrator.submitEdit(delta);
  };

  const saveDocument = (document: (typeof documents)[number], value: string) => {
    document.setText(value);
    if (!props.readOnly) autosave?.schedule(document.path, new TextEncoder().encode(value));
  };

  const downloadProject = async () => {
    if (!props.project) return;
    await autosave?.flush();
    const archive = await exportProjectZip(props.project.store, props.project.id);
    const blob = new Blob([archive.slice().buffer], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${props.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "project"}.zip`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  onMount(() => {
    if (props.project && !props.readOnly) {
      autosave = new ProjectAutosave(props.project.store, props.project.id);
      detachLifecycle = autosave.attachLifecycle();
    }
    const unsubscribe = orchestrator.subscribe((message) => {
      if (message.t === "ready") setEngineStatus(`Ready · ${message.engineVersion}`);
      if (message.t === "progress") {
        setEngineStatus(message.detail ? `${message.phase} · ${message.detail}` : message.phase);
      }
      if (message.t === "saturated") {
        setEngineStatus(`Compiling · ${message.queuedDeltas} edits queued`);
      }
      if (message.t === "fontsNeeded" && fontManager) {
        void fontManager
          .then((manager) => manager.ensureAll(message.fonts))
          .catch((error: unknown) => {
            setEngineStatus(`Font load failed · ${error instanceof Error ? error.message : error}`);
          });
      }
      if (message.t === "patch") {
        setPreviewPatch(message);
        setPreviewEpoch(message.epoch);
        spans.apply(message.epoch, message.spans);
      }
      if (message.t === "document") {
        setPreviewDocument(message.html);
        setPreviewEpoch(message.epoch);
        performanceMonitor.patchApplied(message.epoch, 0);
        setLatency(performanceMonitor.summary());
      }
      if (message.t === "renderedSource") {
        const selectionQuery = renderedSelectionQueries.get(message.requestId);
        if (!selectionQuery) {
          if (message.location) jumpToSourcePath(message.location.path, message.location.start);
        } else {
          renderedSelectionQueries.delete(message.requestId);
          const result = renderedSelectionResults.get(selectionQuery.selectionId);
          if (!message.location || !result) {
            renderedSelectionResults.delete(selectionQuery.selectionId);
          } else {
            result[selectionQuery.edge] = message.location;
            if (result.start && result.end) {
              renderedSelectionResults.delete(selectionQuery.selectionId);
              if (result.start.path === result.end.path) {
                jumpToSourceRange(result.start.path, result.start.start, result.end.end);
              }
            }
          }
        }
      }
      if (message.t === "telemetry") telemetry.recordHealth(message.metric);
      if (message.t === "diagnostics" && message.epoch >= diagnosticEpoch()) {
        setDiagnosticEpoch(message.epoch);
        setDiagnostics(message.items);
      }
      if (message.t === "fatal") {
        if (message.kind === "worker") telemetry.recordHealth("worker-crash");
        setRecoveryNotice(`Engine recovery started automatically · ${message.message}`);
        setEngineStatus(`Engine restarting · ${message.message}`);
      }
    });

    orchestrator.initialize(
      {
        t: "init",
        bundleDigest,
        engineOpts: liveEngine
          ? { moduleUrl: engineModuleUrl, bundleBaseUrl }
          : { mode: "plain-demo" },
      },
      {
        entry: props.entry,
        compileMode: props.compileMode,
        editableDocIds: new Set(documents.map((document) => document.id)),
        files: workspaceProjectFiles(
          documents.map((document) => ({
            id: document.id,
            path: document.path,
            text: document.text(),
          })),
          props.binaryFiles ?? [],
        ),
      },
    );
    onCleanup(unsubscribe);
  });

  onCleanup(() => {
    detachLifecycle?.();
    void autosave?.dispose();
    orchestrator.dispose();
  });

  return (
    <>
      <section class="workspace-toolbar">
        <div>
          <span class="muted">Workspace</span>
          <strong>{props.name}</strong>
          <Show when={props.readOnly}>
            <span class="read-only-badge">Read only · open in another tab</span>
          </Show>
        </div>
        <div class="workspace-actions">
          <Show when={props.onCopyDemo}>
            <button
              type="button"
              onClick={() =>
                void props.onCopyDemo?.(
                  documents.map((document) => ({
                    id: document.id,
                    path: document.path,
                    text: document.text(),
                  })),
                )
              }
            >
              Copy into a project
            </button>
          </Show>
          <Show when={props.project && props.project.downloadable !== false}>
            <button type="button" onClick={() => void downloadProject()}>
              Download project
            </button>
          </Show>
        </div>
      </section>

      <section class="compile-activity" role="status" aria-live="polite">
        <span class="activity-dot" aria-hidden="true" />
        <span>{engineStatus()}</span>
      </section>

      <Show when={recoveryNotice()}>
        {(notice) => (
          <aside class="recovery-notice" role="alert">
            <span>{notice()}</span>
            <button type="button" onClick={() => setRecoveryNotice()}>
              Dismiss
            </button>
          </aside>
        )}
      </Show>

      <section class="workspace-grid" aria-label="Workspace preview">
        <section class="panel editor-panel">
          <Show when={entryDocument}>
            {(document) => (
              <CodeEditor
                docId={document().id}
                value={document().text()}
                readOnly={props.readOnly}
                diagnostics={diagnostics().filter(({ docId }) => docId === document().id)}
                cursorTarget={cursorTarget()?.docId === document().id ? cursorTarget() : undefined}
                onChange={(value) => saveDocument(document(), value)}
                onDelta={handleEdit}
                onCursor={handleCursor}
                onInteraction={() => setPreviewCaretClearRequestId((requestId) => requestId + 1)}
              />
            )}
          </Show>
        </section>

        <section class="panel preview-panel">
          <div class="panel-heading">
            <span>HTML Preview</span>
            <span class="muted">Epoch {previewEpoch()}</span>
          </div>
          <Show
            when={previewDocument()}
            fallback={
              <IncrementalPreview
                patch={previewPatch()}
                highlightedElementId={highlightedElementId()}
                onSourceSpan={(span: SourceSpan) => jumpToSource(span.docId, span.byteStart)}
                onPatchApplied={({ epoch, durationMs }) => {
                  performanceMonitor.patchApplied(epoch, durationMs);
                  const summary = performanceMonitor.summary();
                  setLatency(summary);
                  telemetry.sendPerformance(summary);
                }}
              />
            }
          >
            {(html) => (
              <StandalonePreview
                html={html()}
                onRenderedSource={({ page, event, unit }) =>
                  orchestrator.requestRenderedSource(++renderedSourceRequestId, page, event, unit)
                }
                onRenderedSelection={({ start, end }) => requestRenderedSelection(start, end)}
                clearCaretRequestId={previewCaretClearRequestId()}
              />
            )}
          </Show>
        </section>
      </section>

      <section class="bottom-panel">
        <div>
          <h2>Performance</h2>
          <dl class="performance-grid">
            <div>
              <dt>Samples</dt>
              <dd>{latency().samples}</dd>
            </div>
            <div>
              <dt>Edit → patch p50</dt>
              <dd>{latency().p50EditToPatchMs?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Edit → patch p95</dt>
              <dd>{latency().p95EditToPatchMs?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Latest patch</dt>
              <dd>{latency().latestPatchApplicationMs?.toFixed(1) ?? "—"} ms</dd>
            </div>
          </dl>
          <label class="telemetry-preference">
            <input
              type="checkbox"
              checked={telemetryEnabled()}
              onChange={(event) => {
                telemetry.setEnabled(event.currentTarget.checked);
                setTelemetryEnabled(event.currentTarget.checked);
              }}
            />
            Share anonymous performance metrics
          </label>
        </div>
        <details class="diagnostics-panel" open>
          <summary>
            Diagnostics <span class="muted">{diagnostics().length}</span>
          </summary>
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
        </details>
      </section>
    </>
  );
}
