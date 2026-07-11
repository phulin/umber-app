# Phase 4 Notes: Editor, Orchestrator, Diagnostics, and Sync

## Decisions
- CodeMirror remains UTF-16-native; one rolling map per document translates only at the engine boundary.
- A CodeMirror transaction is coalesced to its minimal old/new text delta before being sent.
- Saturation coalescing compares the last engine-acknowledged bytes with the latest local bytes, producing one minimal byte delta when the engine returns idle.
- Span lookup chooses the smallest (innermost) interval containing the cursor byte offset.

## Errors and Resolutions
- Changing the golden replay trigger from `edit` to `openProject` invalidated an older session test. Resolution: make the test exercise the current project-open compile path.
- The first sync e2e locator matched identical text in both editor and preview. Resolution: address the stable preview element ID directly.
- Preview pointer default handling reclaimed focus after reverse sync focused CodeMirror. Resolution: prevent the default pointer action when a source span is handled.
- Biome flagged a useless `String.raw` bibliography literal. Resolution: use a normal template literal.

## Verification
- `npm run check`: 45 files checked with no errors.
- `npm run test`: 15 files and 34 tests passed.
- `npm run build`: strict TypeScript and Vite worker/app build passed.
- `npm run test:e2e`: 2 Chromium tests passed, covering diagnostics, both sync directions, and independent multi-file editor persistence.
