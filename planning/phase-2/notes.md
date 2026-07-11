# Phase 2 Notes: Incremental Renderer and Font Manager

## Design Constraints
- Pages retain exact point dimensions even when their content is virtualized away.
- Streaming patches at the same epoch accumulate; the first patch of a newer epoch resets the epoch-scoped span index.
- Engine HTML is trusted input, but it is parsed in a detached container before live DOM replacement.
- Page shells may remain mounted as spacers; only page content is mounted inside the viewport ±2 pages.
- Font family names derive only from immutable file hashes so engine HTML and browser registration agree.

## Errors and Resolutions
- The font-manager deferred test inferred a recursive `never` promise type. Resolution: type the fake face against the explicit `LoadableFontFace` interface.
- jsdom exposed `requestAnimationFrame` without advancing frames, so the virtualization test observed no pages. Resolution: install a deterministic timer-backed animation-frame stub in that test.

## Verification
- `npm run test`: 6 files and 15 tests passed, including stable block operations, stale epochs, streaming spans, font deduplication, and ten-page virtualization.
- `npm run check`: passed, 28 files checked.
- `npm run build`: strict TypeScript and Vite build passed.
- `npm run test:e2e`: Chromium passed with the fake-engine patch rendered through `IncrementalPreview`.
