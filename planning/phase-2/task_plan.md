# Phase 2 Task Plan: Incremental Renderer and Font Manager

## Goal
Render coordinate-identical HTML patches safely and smoothly with stable page/block identities, viewport virtualization, epoch-scoped spans, and deterministic cached font registration.

## Tasks
- [x] Implement the page/block/span document model and stale-patch rejection
- [x] Apply block HTML through detached containers
- [x] Mount content only for viewport pages ±2 while retaining exact page spacers
- [x] Batch patch application through `requestAnimationFrame`
- [x] Preserve scroll position when page heights change above the viewport
- [x] Implement deterministic hash-derived font families
- [x] Deduplicate font loads through the shared cache interface
- [x] Hide pending-font content until `FontFace.load()` resolves
- [x] Replace the app's temporary direct `innerHTML` path with the renderer
- [x] Add model, renderer, font-manager, and browser tests
- [x] Pass all project verification gates

## Acceptance Evidence
- Stable-ID block replacement/removal and page addition/removal are unit tested.
- Stale epochs cannot mutate rendered state.
- A long document mounts content only within the virtualization window.
- Pending fonts register once, use deterministic family names, and toggle visibility classes.
- App e2e proves a fake-engine patch renders through the production renderer.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Complete** — The renderer and font manager are integrated with the fake engine and all verification gates pass.
