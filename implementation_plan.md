# Vite + SolidJS MVP Implementation Plan

## Product Cut
Build a local-first browser app for LaTeX projects:

```text
Open local folder
-> detect TeX root
-> edit .tex/.bib/.sty files
-> compile with Rust/Wasm TeX engine
-> show PDF and logs
-> write edits back to the same host folder
```

The first release should prove that opening a real local LaTeX repo and compiling it feels excellent. Full Git-in-browser is explicitly out of scope for V1.

## Current State
The repository at `/Users/phulin/Documents/Projects/umber-app` is empty. This is a greenfield Vite + SolidJS + TypeScript app.

## Recommended Stack
- App: Vite, SolidJS, TypeScript
- Routing: `@solidjs/router`, though V1 can be mostly a single workspace route
- Editor: CodeMirror 6
- Filesystem: File System Access API behind a `ProjectFS` abstraction
- Compiler: Rust TeX engine compiled to Wasm with wasm-bindgen/wasm-pack
- Worker: Web Worker for compile jobs and engine lifecycle
- PDF preview: Native browser PDF embed first, PDF.js later if needed
- Tests: Vitest for filesystem/project logic, Playwright for browser smoke flows
- Deploy: Cloudflare Pages static app first; Workers/Pages Functions only when server features exist

## V1 Non-Goals
- No isomorphic-git mutation.
- No in-browser commit, checkout, merge, pull, or push.
- No GitHub sync.
- No hosted project storage.
- No auth.
- No collaborative editing.
- No server-side compilation.

## Target User Experience
1. User opens the app.
2. User clicks an open-folder control.
3. Browser prompts through `showDirectoryPicker()`.
4. App scans the selected folder and detects likely TeX root files.
5. User selects or confirms the root file.
6. App shows a file tree, source editor, PDF pane, and log/diagnostics pane.
7. User edits LaTeX files and saves changes to the same local folder.
8. App compiles in a worker and updates the PDF/log output.
9. App detects whether the folder has `.git` and displays basic repo context without changing Git data.

## Milestone 1: Scaffold and App Shell
- Create the Vite SolidJS TypeScript project.
- Add baseline tooling:
  - ESLint
  - Prettier
  - Vitest
  - Playwright
  - Wrangler
- Add package scripts:
  - `dev`
  - `build`
  - `preview`
  - `test`
  - `lint`
  - `format`
  - `test:e2e`
- Add a Cloudflare Pages-ready static build config.
- Build the app shell:
  - top toolbar
  - project/file tree column
  - editor pane
  - PDF preview pane
  - logs/diagnostics drawer or bottom panel
  - status bar

## Milestone 2: ProjectFS Abstraction
Create a browser-neutral filesystem contract before wiring UI deeply to browser handles.

```ts
export interface ProjectFS {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<ProjectDirEntry[]>;
  stat(path: string): Promise<ProjectStat>;
}
```

Implement:
- `LocalFolderFS`: wraps `FileSystemDirectoryHandle`.
- `MemoryFS`: deterministic unit tests and demo fixtures.

Design details:
- Use POSIX-style virtual paths, even on macOS/Windows host folders.
- Normalize paths at the adapter boundary.
- Treat binary files as `Uint8Array`.
- Keep handles private to `LocalFolderFS`.
- Add explicit errors for not found, permission denied, type mismatch, and unsupported operation.

Acceptance criteria:
- Unit tests cover nested reads/writes, directory listing, missing files, binary files, and path normalization.
- The UI can open a folder and display a navigable file tree.
- Text edits can be written back to the original local file.

## Milestone 3: TeX Project Detection
Build project intelligence before advanced Git.

Features:
- Find candidate root files:
  - files containing `\documentclass`
  - common names like `main.tex`, `paper.tex`, `thesis.tex`
- Parse basic dependency references:
  - `\input{...}`
  - `\include{...}`
  - `\bibliography{...}`
  - `\addbibresource{...}`
  - figure/image commands for common patterns
- Surface missing files as diagnostics.
- Let the user override the detected root file.

Acceptance criteria:
- Opening a folder with one obvious root selects it.
- Opening a folder with multiple roots asks the user to choose.
- Missing included files appear in the diagnostics panel.
- Root choice is stored per browser/session where practical.

## Milestone 4: Editor Loop
Add a focused LaTeX editing experience.

Features:
- CodeMirror 6 editor for `.tex`, `.bib`, `.sty`, `.cls`, `.md`, and plain text files.
- Dirty state per open file.
- Save current file.
- Save all.
- Optional autosave after debounce, behind a clearly visible setting.
- File tree filtering to emphasize TeX-relevant files.
- Basic keyboard shortcuts:
  - save
  - compile
  - open command palette later if needed

Acceptance criteria:
- Edits persist to the selected host folder.
- Switching files preserves unsaved buffer state.
- Dirty/saved state is visible.
- Binary or unsupported files do not open as text accidentally.

## Milestone 5: Compile Worker and Wasm Engine
Run the Rust/Wasm TeX engine in a worker.

Worker responsibilities:
- Load and initialize the Wasm module.
- Own compile job queue and cancellation/debouncing.
- Request file reads/writes through a message protocol.
- Emit progress, logs, diagnostics, and output artifact locations.

Main thread responsibilities:
- Own `FileSystemDirectoryHandle`.
- Proxy `ProjectFS` operations for the worker.
- Update editor/PDF/log UI.

Initial compile API shape:

```ts
type CompileRequest = {
  root: string;
  outputDir: string;
  jobId: string;
};
```

Acceptance criteria:
- Compile does not block editor typing or UI interactions.
- Compile output lands under `/.latex-web/build`.
- PDF output can be opened from the app.
- Failed compiles show logs and diagnostics instead of crashing the UI.
- Rapid edits debounce or cancel stale compile jobs.

## Milestone 6: PDF and Log Feedback
Build the feedback loop that makes the product feel useful.

Features:
- PDF preview pane using object URL from compiled PDF bytes or local build output.
- Compile status indicator:
  - idle
  - compiling
  - succeeded
  - failed
- Log panel with warnings/errors.
- Parse common TeX errors into file/line diagnostics.
- Click diagnostic to open source file and move cursor to line.

Acceptance criteria:
- Successful compile updates preview.
- Failed compile keeps the last good PDF visible while showing current errors.
- Clicking an error navigates to the relevant source location when available.

## Milestone 7: Minimal Git Awareness
Add useful repo context without mutating `.git`.

Features:
- Detect whether selected folder contains `.git`.
- Read `.git/HEAD` to show current branch or detached commit.
- Read `.git/config` enough to show remote origin if present.
- Show session-local changed files:
  - opened and modified
  - saved to disk
  - generated build files ignored from this list

Acceptance criteria:
- Git repo detection is read-only.
- The app never writes inside `.git`.
- User can tell whether the folder is a Git repo and which files they changed during the session.

## Milestone 8: Cloudflare Pages Deployment
Because V1 is local-first, deployment is just static hosting.

Tasks:
- Add `wrangler.toml` or `wrangler.jsonc` for Pages.
- Document Cloudflare Pages settings:
  - build command: `npm run build`
  - output directory: `dist`
- Add `.env.example` even if initially empty.
- Add README setup, browser support notes, and deploy instructions.

Acceptance criteria:
- `npm run build` produces a static app.
- The app can be previewed locally.
- The app can be deployed to Cloudflare Pages without a backend.

## Later: isomorphic-git Integration
Only start this after the edit/compile loop is strong.

Preferred long-term path:

```text
isomorphic-git
-> Node-like fs adapter
-> FileSystemDirectoryHandle
-> real local repo folder
```

Work required:
- Node-like fs adapter over `ProjectFS`.
- Path normalization and binary correctness.
- `.git` object writes and lock-file behavior.
- Tests around status, diff, add, and commit.

Defer:
- Remote push/pull.
- GitHub Smart HTTP.
- Custom Git proxy.
- GitHub API commit/PR flow.

## Suggested Folder Structure

```text
src/
  app/
    App.tsx
    routes.tsx
  components/
    layout/
    panels/
    ui/
  features/
    editor/
    filesystem/
    git-awareness/
    pdf-preview/
    project-detection/
    tex-compile/
  lib/
    paths/
    diagnostics/
  workers/
    compile.worker.ts
  styles/
  main.tsx
```

If the Rust engine source lives in this repo, add:

```text
engine/
  Cargo.toml
  src/
```

or if it is external, document how the generated Wasm package is imported.

## Verification Checklist
- `npm run lint`
- `npm run test`
- `npm run build`
- Playwright smoke test:
  - app loads
  - unsupported browser path displays a clear message
  - demo `MemoryFS` project opens
  - root detection works
  - editor can modify a file
  - compile worker returns success/failure fixture result

## Implementation Order
1. Scaffold app and tooling.
2. Build static shell layout.
3. Implement `ProjectFS`, `MemoryFS`, and tests.
4. Implement `LocalFolderFS` and folder opening.
5. Add file tree and editor save loop.
6. Add TeX root/dependency detection.
7. Add worker protocol with fake compiler.
8. Integrate real Rust/Wasm engine.
9. Add PDF preview and log diagnostics.
10. Add read-only Git awareness.
11. Add Cloudflare Pages deployment docs/config.

## Open Decisions
- Confirm CodeMirror 6 vs Monaco.
- Confirm location and current build state of the Rust TeX engine.
- Confirm whether PDF.js is needed in V1 or native PDF rendering is enough.
- Confirm target browser policy for non-Chromium browsers where File System Access support may be limited.
