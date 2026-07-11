export type ProjectManifest = {
  id: string;
  name: string;
  entry: string;
  files: string[];
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  id?: string;
  name: string;
  entry: string;
  files: Record<string, Uint8Array>;
};

export interface ProjectStore {
  listProjects(): Promise<ProjectManifest[]>;
  createProject(input: CreateProjectInput): Promise<ProjectManifest>;
  getManifest(projectId: string): Promise<ProjectManifest | null>;
  readFile(projectId: string, path: string): Promise<Uint8Array>;
  writeFiles(projectId: string, files: ReadonlyMap<string, Uint8Array>): Promise<ProjectManifest>;
  deleteProject(projectId: string): Promise<void>;
}

const validId = /^[a-zA-Z0-9_-]+$/;

export function normalizeProjectPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    segments.length === 0 ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid project path: ${path}`);
  }
  return segments.join("/");
}

const cloneManifest = (manifest: ProjectManifest): ProjectManifest => ({
  ...manifest,
  files: [...manifest.files],
});

export class MemoryProjectStore implements ProjectStore {
  readonly #projects = new Map<
    string,
    { manifest: ProjectManifest; files: Map<string, Uint8Array> }
  >();

  async listProjects(): Promise<ProjectManifest[]> {
    return [...this.#projects.values()]
      .map(({ manifest }) => cloneManifest(manifest))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectManifest> {
    const id = input.id ?? crypto.randomUUID();
    if (!validId.test(id)) throw new Error(`Invalid project id: ${id}`);
    if (this.#projects.has(id)) throw new Error(`Project already exists: ${id}`);
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of Object.entries(input.files)) {
      files.set(normalizeProjectPath(path), bytes.slice());
    }
    const entry = normalizeProjectPath(input.entry);
    if (!files.has(entry)) throw new Error(`Entry file not found: ${entry}`);
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      id,
      name: input.name,
      entry,
      files: [...files.keys()].sort(),
      createdAt: now,
      updatedAt: now,
    };
    this.#projects.set(id, { manifest, files });
    return cloneManifest(manifest);
  }

  async getManifest(projectId: string): Promise<ProjectManifest | null> {
    const project = this.#projects.get(projectId);
    return project ? cloneManifest(project.manifest) : null;
  }

  async readFile(projectId: string, path: string): Promise<Uint8Array> {
    const bytes = this.#projects.get(projectId)?.files.get(normalizeProjectPath(path));
    if (!bytes) throw new Error(`Project file not found: ${projectId}/${path}`);
    return bytes.slice();
  }

  async writeFiles(
    projectId: string,
    changedFiles: ReadonlyMap<string, Uint8Array>,
  ): Promise<ProjectManifest> {
    const project = this.#projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    for (const [path, bytes] of changedFiles) {
      project.files.set(normalizeProjectPath(path), bytes.slice());
    }
    project.manifest = {
      ...project.manifest,
      files: [...project.files.keys()].sort(),
      updatedAt: new Date().toISOString(),
    };
    return cloneManifest(project.manifest);
  }

  async deleteProject(projectId: string): Promise<void> {
    this.#projects.delete(projectId);
  }
}

export class OpfsProjectStore implements ProjectStore {
  readonly #projects: FileSystemDirectoryHandle;

  private constructor(projects: FileSystemDirectoryHandle) {
    this.#projects = projects;
  }

  static async create(
    root?: FileSystemDirectoryHandle,
    namespace = "projects",
  ): Promise<OpfsProjectStore> {
    if (!validId.test(namespace)) throw new Error(`Invalid project-store namespace: ${namespace}`);
    const storageRoot = root ?? (await navigator.storage.getDirectory());
    const projects = await storageRoot.getDirectoryHandle(namespace, { create: true });
    return new OpfsProjectStore(projects);
  }

  async listProjects(): Promise<ProjectManifest[]> {
    const manifests: ProjectManifest[] = [];
    for await (const [, handle] of this.#projects.entries()) {
      if (handle.kind !== "directory") continue;
      const manifest = await this.#readManifest(handle);
      if (manifest) manifests.push(manifest);
    }
    return manifests.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectManifest> {
    const id = input.id ?? crypto.randomUUID();
    if (!validId.test(id)) throw new Error(`Invalid project id: ${id}`);
    try {
      await this.#projects.getDirectoryHandle(id);
      throw new Error(`Project already exists: ${id}`);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const directory = await this.#projects.getDirectoryHandle(id, { create: true });
    const filesDirectory = await directory.getDirectoryHandle("files", { create: true });
    const normalizedFiles = new Map<string, Uint8Array>();
    for (const [path, bytes] of Object.entries(input.files)) {
      normalizedFiles.set(normalizeProjectPath(path), bytes);
    }
    const entry = normalizeProjectPath(input.entry);
    if (!normalizedFiles.has(entry)) throw new Error(`Entry file not found: ${entry}`);
    for (const [path, bytes] of normalizedFiles) await writeNestedFile(filesDirectory, path, bytes);
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      id,
      name: input.name,
      entry,
      files: [...normalizedFiles.keys()].sort(),
      createdAt: now,
      updatedAt: now,
    };
    await writeJson(directory, "manifest.json", manifest);
    return manifest;
  }

  async getManifest(projectId: string): Promise<ProjectManifest | null> {
    try {
      return await this.#readManifest(await this.#projects.getDirectoryHandle(projectId));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async readFile(projectId: string, path: string): Promise<Uint8Array> {
    const directory = await this.#projects.getDirectoryHandle(projectId);
    const files = await directory.getDirectoryHandle("files");
    const handle = await getNestedFile(files, normalizeProjectPath(path));
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async writeFiles(
    projectId: string,
    changedFiles: ReadonlyMap<string, Uint8Array>,
  ): Promise<ProjectManifest> {
    const directory = await this.#projects.getDirectoryHandle(projectId);
    const files = await directory.getDirectoryHandle("files");
    for (const [path, bytes] of changedFiles) {
      await writeNestedFile(files, normalizeProjectPath(path), bytes);
    }
    const manifest = await this.#readManifest(directory);
    if (!manifest) throw new Error(`Project manifest not found: ${projectId}`);
    const next: ProjectManifest = {
      ...manifest,
      files: [
        ...new Set([...manifest.files, ...changedFiles.keys()].map(normalizeProjectPath)),
      ].sort(),
      updatedAt: new Date().toISOString(),
    };
    await writeJson(directory, "manifest.json", next);
    return next;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.#projects.removeEntry(projectId, { recursive: true });
  }

  async #readManifest(directory: FileSystemDirectoryHandle): Promise<ProjectManifest | null> {
    try {
      const handle = await directory.getFileHandle("manifest.json");
      return JSON.parse(await (await handle.getFile()).text()) as ProjectManifest;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && "name" in error && error.name === "NotFoundError";

async function writeJson(
  directory: FileSystemDirectoryHandle,
  name: string,
  value: unknown,
): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value));
  await writable.close();
}

async function getNestedFile(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const segments = path.split("/");
  const fileName = segments.pop();
  if (!fileName) throw new Error(`Invalid project path: ${path}`);
  let directory = root;
  for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
  return directory.getFileHandle(fileName);
}

async function writeNestedFile(
  root: FileSystemDirectoryHandle,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const segments = path.split("/");
  const fileName = segments.pop();
  if (!fileName) throw new Error(`Invalid project path: ${path}`);
  let directory = root;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: true });
  }
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await writable.write(copy.buffer);
  await writable.close();
}
