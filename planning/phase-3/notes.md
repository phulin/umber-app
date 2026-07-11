# Phase 3 Notes: Resolver, Cache, and Engine Adapter

## Decisions
- SHA-256 is the immutable bundle hash algorithm because it is available through Web Crypto in all target browsers and at build time.
- The cache namespace is one directory per bundle digest; file names are validated lowercase hexadecimal hashes.
- The resolver owns in-flight request deduplication and integrity verification; cache implementations remain byte stores with LRU metadata.
- OPFS is optional at runtime; absence or initialization failure falls back to the same size-capped memory implementation.

## Errors and Resolutions
- Concurrent dependency prefetch initially fetched the manifest twice. Resolution: deduplicate manifest initialization behind one in-flight promise.
- TypeScript narrowed `navigator` to `never` in an OPFS capability expression. Resolution: use an explicitly extended `StorageManager` capability value.
- A multi-file patch failed after Biome had reordered an expected import line. Resolution: inspect the current files and apply smaller context-specific patches.

## Verification
- `npm run test`: 11 files and 26 tests passed.
- `npm run check`: 38 files checked with no errors.
- `npm run build`: passed and emitted a dedicated `engine.worker` asset.
- `npm run test:e2e`: Chromium app flow passed.
- Resource tests cover LRU pinning, buffer-copy safety, OPFS fallback, SHA-256 rejection, in-flight deduplication, prefetch, sync handles, worker restart/reload, and external module validation.

## External Integration Inputs Still Needed
- URL or package location for the Rust/WASM module exporting `createIncrementalTexEngine(host)`.
- Bundle CDN base URL.
- Immutable bundle digest and matching manifest/resources.

## Local Engine Audit
- `/Users/phulin/Documents/Projects/umber2/docs/wasm_mvp.md` is marked proposed, describes `umber-wasm` as a new crate, and returns DVI rather than incremental coordinate-identical HTML patches. No `umber-wasm` crate currently exists in its workspace.
- `/Users/phulin/Documents/Projects/notex/docs/incremental_state.md` describes incremental replay as future work and states that existing behavior remains non-incremental.
- Both engine repositories are outside this app's scope and have independent user-owned worktree state. Neither can be substituted for the design doc's given engine without materially changing the product contract.
