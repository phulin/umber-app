# Phase 5 Notes: Project Persistence, Import/Export, Demo, and Performance

## Decisions
- Project files remain byte arrays in storage; UTF-8 decoding belongs to editor boundaries.
- Manifest writes are atomic at the store abstraction and follow successful file writes.
- The memory store mirrors OPFS semantics for deterministic unit and demo tests.
- ZIP paths are normalized and traversal segments are rejected before persistence.
- Hash routing is sufficient for `#/projects`, `#/project/<id>`, and `#/demo`.

## Errors and Resolutions
- OPFS writable streams require `ArrayBuffer`-backed views, while a generic `Uint8Array` may be backed by `SharedArrayBuffer`. Resolution: copy bytes into a fresh `ArrayBuffer` before writing.
- Biome rejected a redundant explicit `region` role after an accessible section label was added for the drop target. Resolution: retain the label and native section landmark without the redundant role.
- TypeScript treats drag-event `dataTransfer` as nullable. Resolution: guard it before importing dropped files.
- The first routed-app e2e brand locator also matched bibliography source text. Resolution: target the accessible brand button name.

## Verification
- `npm run check`: 56 files checked with no errors.
- `npm run test`: 20 files and 42 tests passed.
- `npm run build`: strict TypeScript and Vite build passed; app, worker, OPFS, and `fflate` code bundle successfully.
- `npm run test:e2e`: 3 Chromium tests passed, including demo sync, multi-file state, demo copy, autosave, OPFS reload persistence, and project-list navigation.

## Completion Audit Reopen
- The demo workspace had no persistence adapter, so a refresh discarded edits despite §3.9 requiring OPFS scratch space. The earlier browser persistence test only covered copied real projects and was insufficient evidence for the demo requirement.
- Resolution: parameterize the OPFS project-store namespace, create an isolated `/scratch/demo` project, reuse the 500 ms autosave/lifecycle flush path, and pass current workspace buffers into the copy action.
- Updated Chromium evidence proves a scratch edit survives refresh, appears in the copied real project, and remains separate from the user project list until copied.

## Binary Resource Audit
- `ProjectScreen` filtered the manifest to editable extensions before loading files. This correctly avoided opening binaries in CodeMirror but also removed images/fonts/data from the engine project payload.
- Remediation keeps editable document signals separate from immutable binary resources, lists both in the tree, and includes both in `openProject` transferables.
- Verification imports a ZIP with a PNG payload in Chromium, shows the resource with a binary badge and no tab, while a unit test proves `workspaceProjectFiles` preserves exact bytes in the engine payload.
- Follow-up: the orchestrator now receives an explicit editable-document ID set, so it transfers binaries but does not UTF-8 decode or retain duplicate text state for them. A test proves binary edit attempts are rejected while the bytes remain in `openProject`.
