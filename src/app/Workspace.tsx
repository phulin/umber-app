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
import type { Diagnostic, ProjectFile, SourceSpan } from "../features/tex-compile/protocol";

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
  const [activeDocId, setActiveDocId] = createSignal(entryDocument?.id ?? "");
  const [engineStatus, setEngineStatus] = createSignal("Starting engine…");
  const [recoveryNotice, setRecoveryNotice] = createSignal<string>();
  const [previewPatch, setPreviewPatch] = createSignal<PatchMessage>();
  const [previewEpoch, setPreviewEpoch] = createSignal(0);
  const [diagnostics, setDiagnostics] = createSignal<Diagnostic[]>([]);
  const [diagnosticEpoch, setDiagnosticEpoch] = createSignal(0);
  const [highlightedElementId, setHighlightedElementId] = createSignal<string>();
  const [latency, setLatency] = createSignal<LatencySummary>({ samples: 0 });
  const [cursorTarget, setCursorTarget] = createSignal<{
    docId: string;
    offset: number;
    requestId: number;
  }>();
  const spans = new SpanIndex();
  const performanceMonitor = new PerformanceMonitor();
  const telemetry = new TelemetryClient();
  const [telemetryEnabled, setTelemetryEnabled] = createSignal(telemetry.enabled);
  const orchestrator = new CompileOrchestrator(
    props.engineTransport ??
      (liveEngine
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
        engineOpts: liveEngine ? { moduleUrl: engineModuleUrl, bundleBaseUrl } : { mode: "fake" },
      },
      {
        entry: props.entry,
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
        <aside class="panel file-tree">
          <div class="panel-heading">
            <span>Project</span>
            <span class="muted">{documents.length + (props.binaryFiles?.length ?? 0)} files</span>
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
            <For each={props.binaryFiles ?? []}>
              {(file) => (
                <li class="binary-file" title="Binary project resource">
                  <span>{file.path}</span>
                  <span class="binary-badge">binary</span>
                </li>
              )}
            </For>
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
                  readOnly={props.readOnly}
                  diagnostics={diagnostics().filter(({ docId }) => docId === document.id)}
                  cursorTarget={cursorTarget()?.docId === document.id ? cursorTarget() : undefined}
                  onChange={(value) => saveDocument(document, value)}
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
            onSourceSpan={(span: SourceSpan) => jumpToSource(span.docId, span.byteStart)}
            onPatchApplied={({ epoch, durationMs }) => {
              performanceMonitor.patchApplied(epoch, durationMs);
              const summary = performanceMonitor.summary();
              setLatency(summary);
              telemetry.sendPerformance(summary);
            }}
          />
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
