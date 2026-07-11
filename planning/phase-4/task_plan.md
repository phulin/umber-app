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
- [x] Advance the monotonic epoch for every local edit, including edits queued during saturation
- [x] Label each coalesced per-document batch with its latest constituent edit epoch
- [x] Drop diagnostics and progress older than the latest local edit even before its patch arrives
- [x] Make the bottom diagnostics panel collapsible while retaining click-to-source behavior

## Acceptance Evidence
- Unicode edits prove byte ranges without whole-document re-encoding.
- Saturated multi-edit sequences emit one correct coalesced edit on idle.
- Each file preserves its editor selection and undo state when switching tabs.
- Diagnostics arrive before compile completion and click-jump to the exact file/offset.
- Preview clicks move the source cursor; source cursor movement highlights the innermost span.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Complete after diagnostics-panel remediation** — Diagnostic ordering, navigation, inline markers, and the collapsible bottom presentation are verified.
