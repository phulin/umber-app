import { createResource, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { importProjectFiles, importProjectZip } from "../features/projects/projectArchive";
import { ProjectLockLease } from "../features/projects/projectLock";
import {
  MemoryProjectStore,
  OpfsProjectStore,
  type ProjectStore,
} from "../features/projects/projectStore";
import { Workspace, type WorkspaceDocument } from "./Workspace";

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

async function createStore(): Promise<ProjectStore> {
  try {
    return await OpfsProjectStore.create();
  } catch {
    return new MemoryProjectStore();
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
      for (const path of manifest.files.filter((file) =>
        /\.(tex|bib|sty|cls|md|txt)$/i.test(file),
      )) {
        documents.push({
          id: path,
          path,
          text: new TextDecoder().decode(await props.store.readFile(id, path)),
        });
      }
      return { manifest, documents, readOnly: !lease.writable };
    },
  );
  onCleanup(() => void lease?.release());

  return (
    <Show when={project()} fallback={<p class="loading-state">Loading project…</p>}>
      {(loaded) => (
        <Workspace
          name={loaded().manifest.name}
          documents={loaded().documents}
          entry={loaded().manifest.entry}
          readOnly={loaded().readOnly}
          project={{ id: loaded().manifest.id, store: props.store }}
        />
      )}
    </Show>
  );
}

export function App() {
  const [route, setRoute] = createSignal<Route>(parseRoute());
  const [store] = createResource(createStore);

  onMount(() => {
    const updateRoute = () => setRoute(parseRoute());
    window.addEventListener("hashchange", updateRoute);
    if (!window.location.hash) navigate("/demo");
    onCleanup(() => window.removeEventListener("hashchange", updateRoute));
  });

  const copyDemo = async (projectStore: ProjectStore) => {
    const project = await projectStore.createProject({
      name: "Umber demo",
      entry: "main.tex",
      files: Object.fromEntries(
        demoDocuments.map((document) => [document.path, new TextEncoder().encode(document.text)]),
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

      <Show when={store()} fallback={<p class="loading-state">Opening local project storage…</p>}>
        {(projectStore) => (
          <Switch>
            <Match when={route().screen === "projects"}>
              <ProjectList store={projectStore()} />
            </Match>
            <Match when={route().screen === "project"}>
              <ProjectScreen
                store={projectStore()}
                id={(route() as Extract<Route, { screen: "project" }>).id}
              />
            </Match>
            <Match when={route().screen === "demo"}>
              <Workspace
                name="Try Umber"
                documents={demoDocuments}
                entry="main.tex"
                onCopyDemo={() => copyDemo(projectStore())}
              />
            </Match>
          </Switch>
        )}
      </Show>
    </main>
  );
}
