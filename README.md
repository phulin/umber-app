# Umber

Browser-native, local-first incremental TeX editor. The application stores projects in OPFS,
compiles through a restartable Rust/WASM worker, applies coordinate-identical HTML patches, and
supports bidirectional source/preview synchronization.

## Development

```sh
npm ci
npm run dev
```

Verification:

```sh
npm run check
npm run test
npm run build
npm run test:e2e
cargo test --manifest-path tools/bundle-builder/Cargo.toml
```

The app uses the deterministic fake engine until these values point at a compatible live engine
and immutable bundle:

```sh
VITE_TEX_ENGINE_MODULE_URL=https://example.test/engine.js
VITE_TEX_BUNDLE_BASE_URL=https://bundle.example.test
VITE_TEX_BUNDLE_DIGEST=<sha256>
```

The engine module must export `createIncrementalTexEngine(host)` as documented by the browser
adapter in `src/features/tex-compile/wasmEngineAdapter.ts`.

## Static deployment

Cloudflare Pages settings:

- build command: `npm run build`
- output directory: `dist`
- SPA routing and cache/MIME policy: `public/_redirects` and `public/_headers`
- no COOP/COEP headers are required

Deploy manually with:

```sh
npm run cf:deploy
```

Bundle objects are deployed separately. See `tools/bundle-builder` and `infra/bundle-cdn`.

## Privacy

Telemetry is disabled by default. Users may opt in to aggregate latency, cache, crash, and fetch
failure counters. Source, file paths, diagnostics, and rendered content are never collected.
