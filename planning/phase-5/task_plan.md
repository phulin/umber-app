# Phase 5 Task Plan: Project Persistence, Import/Export, Demo, and Performance

## Goal
Make projects survive reload without accounts, provide portable ZIP backup/import, protect against cross-tab writes, expose the demo-to-project path, and measure the design doc's latency budgets from day one.

## Tasks
- [x] Define the project manifest and `/projects/<uuid>/files/...` storage contract
- [x] Implement memory and async OPFS project stores
- [x] Debounce file writes by approximately 500 ms
- [x] Flush pending writes on `visibilitychange` and `pagehide`
- [x] Acquire one `navigator.locks` lease per project and expose read-only fallback
- [x] Import ZIP archives and folder/file drop payloads
- [x] Export projects as client-side ZIP downloads with `fflate`
- [x] Add project list, editor, and demo screens using lightweight hash routing
- [x] Add “copy this demo into a real project” behavior
- [x] Instrument edit→patch and patch-application latency with performance marks
- [x] Add a debug performance panel and budget summaries
- [x] Add persistence, archive, locking, routing, and browser tests
- [x] Pass all project verification gates
- [x] Persist demo edits in an isolated OPFS scratch namespace across refreshes
- [x] Copy the current edited demo state, not only the original fixture, into a real project
- [x] Add Chromium evidence for demo refresh persistence and edited-state copying

## Acceptance Evidence
- Store tests prove the documented OPFS layout and round-trip persistence.
- Debounce tests prove coalesced writes and lifecycle flushes.
- Lock tests prove a second session becomes read-only.
- ZIP round-trip tests preserve nested binary/text files and the entry file.
- Browser tests prove demo copy, project list navigation, and reload persistence.
- Performance traces expose edit→patch and DOM-application duration.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Complete after audit remediation** — Demo scratch persistence and edited-state copying now satisfy §3.9 and pass Chromium verification.
