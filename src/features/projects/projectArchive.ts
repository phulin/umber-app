import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { normalizeProjectPath, type ProjectManifest, type ProjectStore } from "./projectStore";

const archiveManifestPath = ".umber/manifest.json";

type ArchiveManifest = Pick<ProjectManifest, "name" | "entry">;

export async function exportProjectZip(
  store: ProjectStore,
  projectId: string,
): Promise<Uint8Array> {
  const manifest = await store.getManifest(projectId);
  if (!manifest) throw new Error(`Project not found: ${projectId}`);
  const files: Record<string, Uint8Array> = {
    [archiveManifestPath]: strToU8(JSON.stringify({ name: manifest.name, entry: manifest.entry })),
  };
  for (const path of manifest.files) files[path] = await store.readFile(projectId, path);
  return zipSync(files, { level: 6 });
}

export async function importProjectZip(
  store: ProjectStore,
  archive: Uint8Array,
  options: { id?: string; name?: string } = {},
): Promise<ProjectManifest> {
  const unpacked = unzipSync(archive);
  let archiveManifest: ArchiveManifest | undefined;
  if (unpacked[archiveManifestPath]) {
    archiveManifest = JSON.parse(strFromU8(unpacked[archiveManifestPath])) as ArchiveManifest;
  }
  const files: Record<string, Uint8Array> = {};
  for (const [rawPath, bytes] of Object.entries(unpacked)) {
    if (rawPath === archiveManifestPath || rawPath.endsWith("/")) continue;
    files[normalizeProjectPath(rawPath)] = bytes;
  }
  const paths = Object.keys(files);
  const entry = normalizeProjectPath(
    archiveManifest?.entry ??
      (paths.includes("main.tex")
        ? "main.tex"
        : (paths.find((path) => path.endsWith(".tex")) ?? "")),
  );
  return store.createProject({
    id: options.id,
    name: options.name ?? archiveManifest?.name ?? "Imported project",
    entry,
    files,
  });
}

export async function importProjectFiles(
  store: ProjectStore,
  incoming: readonly File[],
  options: { id?: string; name?: string } = {},
): Promise<ProjectManifest> {
  if (incoming.length === 0) throw new Error("No project files selected");
  const rawPaths = incoming.map((file) => file.webkitRelativePath || file.name);
  const firstSegments = rawPaths.map((path) => path.replaceAll("\\", "/").split("/")[0]);
  const commonRoot = firstSegments.every((segment) => segment === firstSegments[0])
    ? firstSegments[0]
    : undefined;
  const files: Record<string, Uint8Array> = {};
  for (let index = 0; index < incoming.length; index += 1) {
    const file = incoming[index];
    if (!file) continue;
    let path = rawPaths[index] ?? file.name;
    if (commonRoot && path.startsWith(`${commonRoot}/`)) path = path.slice(commonRoot.length + 1);
    files[normalizeProjectPath(path)] = new Uint8Array(await file.arrayBuffer());
  }
  const paths = Object.keys(files);
  const entry = paths.includes("main.tex")
    ? "main.tex"
    : (paths.find((path) => path.endsWith(".tex")) ?? "");
  return store.createProject({
    id: options.id,
    name: options.name ?? commonRoot ?? "Imported project",
    entry,
    files,
  });
}
