# Phase 1 Notes: Protocol Golden Tests and Fake Engine

## Contract Decisions
- Worker messages are validated at runtime before entering application state.
- Unknown message types decode to `null` and are intentionally ignored for forward compatibility.
- Source span tables use structured-cloneable record arrays for the first locked contract; typed-array packing can be added without changing semantic fields.
- A new edit sends `cancel {beforeEpoch}` immediately before its `edit` message.
- The session accepts equal-epoch streaming patches and rejects messages older than the latest applied patch epoch.
- HTML, source inserts, project files, and PDF buffers are selected as transferables.

## Implementation Artifacts
- `src/features/tex-compile/protocol.ts`
- `src/features/tex-compile/engineTransport.ts`
- `src/features/tex-compile/compileSession.ts`
- `src/features/tex-compile/__fixtures__/paragraph-edit.ts`
- Protocol and session unit tests alongside those modules

## Errors and Resolutions
- Initial patch validation used realm-sensitive `instanceof ArrayBuffer`, which rejected jsdom/Node buffers. Resolution: use a cross-realm ArrayBuffer tag check.
- The first transferable switch grouped `edit` and `fileAdd`, preventing TypeScript from narrowing their distinct payload fields. Resolution: use separate switch cases.
- Initial test callbacks used overly narrow tuple and Promise executor signatures. Resolution: narrow mock arguments inside the callback and wrap `queueMicrotask` with a `Promise<void>` executor.

## Verification
- `npm run check`: passed, 22 files checked.
- `npm run test`: passed, 3 files and 9 tests.
- `npm run build`: passed with strict TypeScript and Vite production output.
- `npm run test:e2e`: passed in Chromium, including the fake-engine HTML patch appearing in the preview.

## Completion Audit Reopen
- The initial golden stream exhausted after `openProject`. Edits were recorded by `FakeEngineTransport` but never generated progress/patch/diagnostic messages, so the demo did not prove keystroke-to-preview behavior.
- Resolution: add a stateful fake-engine handler that owns project bytes, applies edit/add/remove messages, respects `cancel.beforeEpoch`, extracts the document body, and emits progress/patch/span/diagnostic/idle messages for epoch 0 and each edit.
- Chromium reverse-syncs to the source span, replaces the line, observes `Updated preview.` in the preview, and verifies the performance panel receives an edit→patch sample.
