# MVP Launch Readiness

Updated: 2026-07-11

## Automated gates

| Requirement | Evidence | Status |
|---|---|---|
| Protocol ordering and forward compatibility | Golden stream, runtime decoders, epoch/cancellation tests | Pass |
| Incremental HTML renderer | Stable block/page tests, virtualization, removal-storm chunking, Chromium render | Pass |
| Bidirectional sync and diagnostics | Span-index tests and Chromium click/focus/highlight/collapse flow | Pass |
| Local-first persistence | Memory/OPFS store tests and Chromium reload persistence | Pass |
| ZIP/folder portability | Nested binary/text archive and folder-import tests | Pass |
| Resource integrity and caching | SHA-256, LRU, dedupe, fallback, sync-handle tests | Pass |
| Worker recovery | Fatal restart, current-project replay, and dismissible recovery-alert tests | Pass |
| Static hosting | Build verifier checks worker, MIME/cache headers, and SPA fallback | Pass |
| Cold demo first render ≤3 s | Chromium launch test | Pass with fake engine |
| Bundle reproducibility | Rust byte-identical manifest/digest and dedupe tests | Pass |
| Privacy | Telemetry defaults off and aggregate allowlist test | Pass |

## Live-engine launch gates

These cannot be truthfully verified until the supplied engine module and bundle coordinates are
available in the repository or environment:

- engine module loads and exports `createIncrementalTexEngine(host)`;
- mirrored bundle manifest and `/f/<hash>` objects resolve with valid SHA-256 hashes;
- Latin Modern/default engine fonts are preloaded and use the engine's exact synthetic families;
- warm 30-page paragraph edits meet p50 ≤50 ms and p95 ≤150 ms end-to-end;
- cold uncached compile completes within 5 s and warm reload within 1 s;
- steady worker memory remains ≤1.5 GB;
- coordinate-identical HTML and selection/copy quality pass against real engine output;
- production CDN CORS/cache behavior is validated over HTTPS.

Required environment values are documented in `.env.example` and `README.md`. Until those live
gates pass, the application is an implementation-complete fake-engine MVP, not a production-ready
TeX compiler release.

### Local engine evidence

- `../umber2/docs/wasm_mvp.md` is a proposed DVI-returning browser MVP and refers to `umber-wasm`
  as a new crate that is not present in that workspace.
- `../notex/docs/incremental_state.md` describes incremental compilation and replay as future work;
  its documented current behavior remains non-incremental.

Neither local repository implements the accepted app contract of streaming coordinate-identical
HTML patches, epoch-scoped source spans, and the `createIncrementalTexEngine(host)` adapter export.
