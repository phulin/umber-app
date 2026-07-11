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

## Completion Audit Reopen
- The renderer mounted only viewport ±2 content, but `flushPatches` still applied every page/block in one model operation. This could exceed the 8 ms frame budget on a 200-page full recompile and did not prioritize viewport pages.
- Resolution: split patches larger than 20 affected pages into an epoch/span/removal metadata chunk plus one chunk per page; order viewport pages by distance from viewport center, then offscreen pages.
- The scheduler applies at least one chunk per animation frame and continues only while measured work remains below 8 ms. DOM revisions and scroll-anchor restoration happen between frame batches.
- Chromium selection evidence confirms the fake engine's rendered block copies as `Hello, Umber.` in readable order.
- Follow-up audit: `PageBody` concatenated every block's HTML and called `replaceChildren` on the page content root. This discarded unchanged block nodes instead of applying stable-ID subtree replacement.
- Resolution: reconcile page components by stable `pageId`, render stable block objects through keyed `For`, and parse/swap HTML inside a `data-block-id` root with `display: contents`. Unit evidence proves an unchanged sibling node is identical before/after while the changed block root is replaced.
