# Phase 4 Task Plan: Editor, Orchestrator, Diagnostics, and Sync

## Goal
Complete the interactive editing loop with byte-accurate incremental deltas, multi-file editor state, saturation-aware compile orchestration, streamed diagnostics, and precise bidirectional source/preview synchronization.

## Tasks
- [x] Implement an incrementally maintained UTF-16 ↔ UTF-8 byte offset map
- [x] Emit one byte-accurate edit delta for each CodeMirror transaction
- [x] Preserve one CodeMirror state per open file behind a tab strip
- [x] Add debounced cursor activity events
- [x] Implement saturation handling and pending-edit coalescing
- [x] Surface compile/fetch/idle state in the activity bar
- [x] Render diagnostics as CodeMirror lint markers and in the bottom panel
- [x] Drop superseded diagnostics by epoch
- [x] Build per-document source-span interval indexes
- [x] Implement preview click → file/cursor reverse sync
- [x] Implement editor cursor → preview scroll/highlight forward sync
- [x] Add unit and Chromium tests for Unicode offsets, coalescing, diagnostics, and both sync directions
- [x] Pass all project verification gates

## Acceptance Evidence
- Unicode edits prove byte ranges without whole-document re-encoding.
- Saturated multi-edit sequences emit one correct coalesced edit on idle.
- Each file preserves its editor selection and undo state when switching tabs.
- Diagnostics arrive before compile completion and click-jump to the exact file/offset.
- Preview clicks move the source cursor; source cursor movement highlights the innermost span.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Complete** — The interactive editor/compile/diagnostic/sync loop is implemented against the fake engine and fully verified.
