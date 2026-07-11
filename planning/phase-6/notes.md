# Phase 6 Notes: Bundle Pipeline, Hosting, Telemetry, and Launch Audit

## Decisions
- SHA-256 remains the sole bundle hash algorithm, matching the browser resolver.
- Builder output uses `files/<hash>` plus `manifest-<digest>.json` with stable JSON ordering.
- CI can supply a selected texmf directory initially; tarball extraction and font normalization are explicit preprocessing steps.
- Telemetry is disabled by default and never includes source, paths, diagnostics, or rendered HTML.

## Errors and Resolutions
- `cargo fmt --check` identified two formatting differences before the first Rust test run. Resolution: format the crate, then verify `cargo fmt --check` and `cargo test`.
- jsdom exposed a non-Storage `localStorage` placeholder, causing telemetry initialization to reject. Resolution: capability-check `getItem` and `setItem`, and tolerate unavailable storage.
- The telemetry test's partial Storage and untyped mock sender passed Vitest but failed strict project TypeScript. Resolution: implement the complete Storage interface and explicitly type beacon arguments.
- Completion audit found the workspace always selected the fake engine despite a production worker adapter. Resolution: choose the restartable WASM worker when all live environment values exist, share the main-thread resolver with `FontManager`, and prefetch scanned dependencies in the worker.

## Verification
- Rust: `cargo fmt --check` and 3 bundle-builder tests pass.
- TypeScript: `npm run check` passes across 68 files; 24 test files and 55 tests pass.
- Production: Vite build and `verify:build` pass, including worker emission, size cap, WASM MIME/cache policy, and SPA fallback.
- Browser: 5 Chromium tests pass; the cold demo remains below the 3-second gate.

## External Inputs Still Required
- Compatible engine module URL/export.
- Bundle CDN base URL and digest.
- Exact default font artifacts/family mapping from the real engine.
- HTTPS deployment endpoint for CORS/cache verification.
- Representative 30-page performance corpus for the live p50/p95, cold compile, memory, and selection audit.
- A locally discovered `umber2` WASM design is only proposed and DVI-oriented; `notex` incremental replay is also still planned. Neither supplies the required live HTML-patch engine artifact.

## Completion Audit Reopen
- §8.1 defines a TeX Live snapshot tarball as pipeline input. The initial Rust CLI accepted only an already-selected directory and documented extraction as external preprocessing, which was narrower than the accepted design.
- Resolution: validate archive paths with `tar -tf`, extract through system `tar`, deterministically collapse single-directory wrappers, then run the same selection/conflict/hash pipeline. A Rust test proves tar and directory inputs emit identical manifest bytes and digest.
- Telemetry audit: the existing opt-in beacon sent latency summaries only. §8.4 also names cache hit rates, worker-crash counts, and bundle fetch failures; these can be counted without collecting document-derived data and batched into the same beacon.
- Resolution: instrument both main-thread and worker bundle resolvers for cache hits, cache misses, and manifest/resource fetch failures; distinguish hard worker failures in the protocol; and reset aggregate counters only after a successful opt-in beacon. Resolver, protocol, restart, and telemetry tests cover the full path without collecting document-derived values.
