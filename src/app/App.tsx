import { createResource, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { importProjectFiles, importProjectZip } from "../features/projects/projectArchive";
import { ProjectLockLease } from "../features/projects/projectLock";
import {
  MemoryProjectStore,
  OpfsProjectStore,
  type ProjectStore,
} from "../features/projects/projectStore";
import { Workspace, type WorkspaceBinaryFile, type WorkspaceDocument } from "./Workspace";

const demoDocuments: WorkspaceDocument[] = [
  {
    id: "main",
    path: "main.tex",
    text: String.raw`\documentclass{article}
\begin{document}
Hello, Umber.
\end{document}`,
  },
  {
    id: "references",
    path: "references.bib",
    text: `@book{umber,
  title = {Browser-Native TeX},
  year = {2026}
}`,
  },
];

type Route = { screen: "demo" } | { screen: "projects" } | { screen: "project"; id: string };

const parseRoute = (): Route => {
  const path = window.location.hash.replace(/^#/, "") || "/demo";
  const project = path.match(/^\/project\/([^/]+)$/);
  if (project?.[1]) return { screen: "project", id: decodeURIComponent(project[1]) };
  if (path === "/projects") return { screen: "projects" };
  return { screen: "demo" };
};

const navigate = (path: string) => {
  window.location.hash = path;
};

type AppStores = { projects: ProjectStore; scratch: ProjectStore };

async function createStores(): Promise<AppStores> {
  try {
    const root = await navigator.storage.getDirectory();
    return {
      projects: await OpfsProjectStore.create(root, "projects"),
      scratch: await OpfsProjectStore.create(root, "scratch"),
    };
  } catch {
    return { projects: new MemoryProjectStore(), scratch: new MemoryProjectStore() };
  }
}

function ProjectList(props: { store: ProjectStore }) {
  const [projects, { refetch }] = createResource(() => props.store.listProjects());
  let zipInput: HTMLInputElement | undefined;
  let folderInput: HTMLInputElement | undefined;

  const importFiles = async (files: FileList | readonly File[]) => {
    const selected = [...files];
    if (selected.length === 1 && selected[0]?.name.toLowerCase().endsWith(".zip")) {
      const file = selected[0];
      if (!file) return;
      const project = await importProjectZip(props.store, new Uint8Array(await file.arrayBuffer()));
      navigate(`/project/${project.id}`);
      return;
    }
    const project = await importProjectFiles(props.store, selected);
    navigate(`/project/${project.id}`);
  };

  return (
    <section
      class="project-list-screen"
      aria-label="Project import and list"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer) void importFiles(event.dataTransfer.files);
      }}
    >
      <div class="screen-heading">
        <div>
          <p class="eyebrow">Local-first</p>
          <h2>Your projects</h2>
        </div>
        <div class="workspace-actions">
          <button type="button" onClick={() => navigate("/demo")}>
            New from demo
          </button>
          <button type="button" onClick={() => zipInput?.click()}>
            Import ZIP
          </button>
          <button type="button" onClick={() => folderInput?.click()}>
            Import folder
          </button>
          <input
            ref={(element) => {
              zipInput = element;
            }}
            class="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            onChange={(event) => {
              if (event.currentTarget.files) void importFiles(event.currentTarget.files);
            }}
          />
          <input
            ref={(element) => {
              folderInput = element;
              element.setAttribute("webkitdirectory", "");
            }}
            class="visually-hidden"
            type="file"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files) void importFiles(event.currentTarget.files);
            }}
          />
        </div>
      </div>
      <p class="drop-hint">Drop a project folder or ZIP anywhere on this panel.</p>
      <Show when={(projects() ?? []).length > 0} fallback={<p>No saved projects yet.</p>}>
        <div class="project-cards">
          {projects()?.map((project) => (
            <button type="button" onClick={() => navigate(`/project/${project.id}`)}>
              <strong>{project.name}</strong>
              <span>{project.entry}</span>
              <time>{new Date(project.updatedAt).toLocaleString()}</time>
            </button>
          ))}
        </div>
      </Show>
      <button class="refresh-projects" type="button" onClick={() => void refetch()}>
        Refresh projects
      </button>
    </section>
  );
}

function ProjectScreen(props: { store: ProjectStore; id: string }) {
  let lease: ProjectLockLease | undefined;
  const [project] = createResource(
    () => props.id,
    async (id) => {
      await lease?.release();
      const manifest = await props.store.getManifest(id);
      if (!manifest) throw new Error(`Project not found: ${id}`);
      lease = await ProjectLockLease.acquire(id);
      const documents: WorkspaceDocument[] = [];
      const binaryFiles: WorkspaceBinaryFile[] = [];
      for (const path of manifest.files) {
        const bytes = await props.store.readFile(id, path);
        if (/\.(tex|bib|sty|cls|md|txt)$/i.test(path)) {
          documents.push({ id: path, path, text: new TextDecoder().decode(bytes) });
        } else {
          binaryFiles.push({ id: path, path, bytes });
        }
      }
      return { manifest, documents, binaryFiles, readOnly: !lease.writable };
    },
  );
  onCleanup(() => void lease?.release());

  return (
    <Show when={project()} fallback={<p class="loading-state">Loading project…</p>}>
      {(loaded) => (
        <Workspace
          name={loaded().manifest.name}
          documents={loaded().documents}
          binaryFiles={loaded().binaryFiles}
          entry={loaded().manifest.entry}
          readOnly={loaded().readOnly}
          project={{ id: loaded().manifest.id, store: props.store }}
        />
      )}
    </Show>
  );
}

function DemoScreen(props: {
  scratchStore: ProjectStore;
  onCopy: (documents: readonly WorkspaceDocument[]) => void | Promise<void>;
}) {
  const [demo] = createResource(async () => {
    let manifest = await props.scratchStore.getManifest("demo");
    if (!manifest) {
      manifest = await props.scratchStore.createProject({
        id: "demo",
        name: "Try Umber",
        entry: "main.tex",
        files: Object.fromEntries(
          demoDocuments.map((document) => [document.path, new TextEncoder().encode(document.text)]),
        ),
      });
    }
    const documents: WorkspaceDocument[] = [];
    for (const path of manifest.files.filter((file) => /\.(tex|bib|sty|cls|md|txt)$/i.test(file))) {
      documents.push({
        id: path === "main.tex" ? "main" : path,
        path,
        text: new TextDecoder().decode(await props.scratchStore.readFile("demo", path)),
      });
    }
    return { manifest, documents };
  });

  return (
    <Show when={demo()} fallback={<p class="loading-state">Opening demo scratch space…</p>}>
      {(loaded) => (
        <Workspace
          name="Try Umber"
          documents={loaded().documents}
          entry={loaded().manifest.entry}
          project={{ id: "demo", store: props.scratchStore, downloadable: false }}
          onCopyDemo={props.onCopy}
        />
      )}
    </Show>
  );
}

export function App() {
  const [route, setRoute] = createSignal<Route>(parseRoute());
  const [stores] = createResource(createStores);

  onMount(() => {
    const updateRoute = () => setRoute(parseRoute());
    window.addEventListener("hashchange", updateRoute);
    if (!window.location.hash) navigate("/demo");
    onCleanup(() => window.removeEventListener("hashchange", updateRoute));
  });

  const copyDemo = async (
    projectStore: ProjectStore,
    currentDocuments: readonly WorkspaceDocument[],
  ) => {
    const project = await projectStore.createProject({
      name: "Umber demo",
      entry: "main.tex",
      files: Object.fromEntries(
        currentDocuments.map((document) => [
          document.path,
          new TextEncoder().encode(document.text),
        ]),
      ),
    });
    navigate(`/project/${project.id}`);
  };

  return (
    <main class="app-shell">
      <header class="topbar">
        <button class="brand-button" type="button" onClick={() => navigate("/demo")}>
          <span class="eyebrow">Umber</span>
          <span class="brand-title">Browser-native TeX</span>
        </button>
        <nav aria-label="Primary navigation">
          <button type="button" onClick={() => navigate("/demo")}>
            Demo
          </button>
          <button type="button" onClick={() => navigate("/projects")}>
            Projects
          </button>
        </nav>
      </header>

      <Show when={stores()} fallback={<p class="loading-state">Opening local project storage…</p>}>
        {(appStores) => (
          <Switch>
            <Match when={route().screen === "projects"}>
              <ProjectList store={appStores().projects} />
            </Match>
            <Match when={route().screen === "project"}>
              <ProjectScreen
                store={appStores().projects}
                id={(route() as Extract<Route, { screen: "project" }>).id}
              />
            </Match>
            <Match when={route().screen === "demo"}>
              <DemoScreen
                scratchStore={appStores().scratch}
                onCopy={(documents) => copyDemo(appStores().projects, documents)}
              />
            </Match>
          </Switch>
        )}
      </Show>
    </main>
  );
}
