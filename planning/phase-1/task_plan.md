# Phase 1 Task Plan: Protocol Golden Tests and Fake Engine

## Goal
Lock the editor-to-engine protocol and its ordering invariants behind runtime validation, golden patch streams, and a deterministic fake engine transport.

## Tasks
- [x] Derive protocol messages and invariants from `docs/mvp-design-doc.md` §5
- [x] Define TypeScript message, patch, span, font, and diagnostic types
- [x] Add a forward-compatible runtime decoder for worker messages
- [x] Add transferable-buffer selection for large payloads
- [x] Implement worker and fake-engine transport adapters
- [x] Implement the minimum epoch-ordering session boundary
- [x] Add a recorded paragraph-edit golden stream
- [x] Make strict typecheck, Biome, unit tests, build, and e2e pass
- [x] Integrate the fake engine with the app shell as the development path
- [x] Review Phase 1 acceptance evidence and update the cross-phase plan
- [x] Make the demo fake engine replay a deterministic compile stream after every edit
- [x] Maintain byte-accurate fake project state and cancellation semantics

## Acceptance Evidence
- Unit tests prove unknown messages are ignored.
- Unit tests prove malformed known messages are rejected.
- Unit tests prove edits monotonically increment epochs and cancel older work.
- Unit tests prove stale patches, diagnostics, and progress are discarded.
- Unit tests replay a recorded partial patch stream through the fake transport.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Complete after interactive-demo remediation** — Project open and every accepted edit emit deterministic compile streams with byte-accurate spans.
