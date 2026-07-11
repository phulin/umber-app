import { createSignal, For, onCleanup, onMount } from "solid-js";
import { CodeEditor } from "../features/editor/CodeEditor";
import { IncrementalPreview } from "../features/preview/IncrementalPreview";
import type { PatchMessage } from "../features/preview/previewDocument";
import { paragraphEditReplay } from "../features/tex-compile/__fixtures__/paragraph-edit";
import { CompileSession } from "../features/tex-compile/compileSession";
import { FakeEngineTransport } from "../features/tex-compile/engineTransport";

const milestones = [
  "Lock engine protocol",
  "Render incremental HTML",
  "Cache TeX resources in OPFS",
  "Synchronize source and preview",
  "Persist and export projects",
  "Validate launch performance",
];

export function App() {
  const [source, setSource] = createSignal(String.raw`\documentclass{article}
\begin{document}
Hello from Umber.
\end{document}`);
  const [engineStatus, setEngineStatus] = createSignal("Starting fake engine…");
  const [previewPatch, setPreviewPatch] = createSignal<PatchMessage>();
  const session = new CompileSession(new FakeEngineTransport(paragraphEditReplay));

  onMount(() => {
    const unsubscribe = session.subscribe((message) => {
      if (message.t === "ready") setEngineStatus(`Ready · ${message.engineVersion}`);
      if (message.t === "progress") {
        setEngineStatus(message.detail ? `${message.phase} · ${message.detail}` : message.phase);
      }
      if (message.t === "patch") setPreviewPatch(message);
      if (message.t === "fatal") setEngineStatus(`Engine restart required · ${message.message}`);
    });

    session.send({ t: "init", bundleDigest: "demo-bundle", engineOpts: { mode: "fake" } });
    session.edit("main", 41, 46, "Hello, Umber.");
    onCleanup(unsubscribe);
  });

  onCleanup(() => session.dispose());

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
            <li>main.tex</li>
            <li>references.bib</li>
            <li>figures/</li>
          </ul>
        </aside>

        <section class="panel editor-panel">
          <div class="panel-heading">
            <span>Editor</span>
            <span class="muted">CodeMirror</span>
          </div>
          <CodeEditor value={source()} onChange={setSource} />
        </section>

        <section class="panel preview-panel">
          <div class="panel-heading">
            <span>HTML Preview</span>
            <span class="muted">Epoch {session.latestAppliedEpoch}</span>
          </div>
          <IncrementalPreview patch={previewPatch()} />
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
          <h2>Compile log</h2>
          <p>{engineStatus()}</p>
        </div>
      </section>
    </main>
  );
}
