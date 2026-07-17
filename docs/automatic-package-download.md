# Automatic package download

## Goal

Use the distribution resolver shipped by `@umber/umber-wasm` so the browser
compiler can acquire missing TeX inputs and TFM files from Umber's pinned,
content-addressed TeX Live snapshot. Keep network and cache policy in the
browser host while the WASM session remains host-neutral.

## Implementation

1. Build and test against the WASM package from
   `/Users/phulin/.codex/worktrees/0d49/umber2` so the app has the schema-v2
   manifest resolver, production manifest URL and digest, typed unavailable
   responses, dependency hints, and regenerated format schema.
2. Create one `HttpManifestResolver` per worker using the package's
   `TEXLIVE_2026_MANIFEST_URL` and `TEXLIVE_2026_MANIFEST_SHA256` exports and
   its IndexedDB persistent cache.
3. Make the low-level persistent session's advance loop asynchronous. Resolve
   packaged WOFF2/TFM resources locally first, send the remaining required
   resources to the HTTP resolver, forward `prefetchHints`, provide the
   combined responses, and continue advancing.
4. Pass typed unavailable responses into the session. A verified manifest miss
   is TeX input state, while HTTP, CORS, integrity, size, and abort failures are
   host diagnostics and must not be treated as successful progress.
5. Emit `fetching` progress while distribution requests are outstanding and
   return to `typesetting` or `idle` afterward.
6. Give each active compile an `AbortController`. Let cancel messages abort an
   outstanding resolver operation immediately, even though ordinary worker
   messages remain ordered, and prevent stale results from reaching the
   session or UI.
7. Keep format selection separate from resource acquisition. The first slice
   continues using the packaged Plain format. A subsequent LaTeX-mode slice
   should load the manifest's `latex` format with engine-version and
   format-schema compatibility checks rather than inferring the format from
   source text.
8. Retain the legacy flat `BundleResolver` only for the configurable external
   engine path. Do not duplicate schema-v2 root verification, shard lookup,
   dependency selection, or typed miss behavior in the app.

## Verification

- Unit-test local-resource precedence, remote fallback, dependency-hint
  forwarding, typed misses, fetch diagnostics, and abort behavior.
- Run the existing TypeScript, browser-boundary, formatting, and build checks
  against the freshly built worktree package.
- Exercise a cold-cache document requiring a distribution input and verify a
  warm run reuses authenticated cached objects.
- For the LaTeX-mode follow-up, compile a document requiring a non-base package
  with the manifest-provided `latex` format and add cold/warm browser coverage.
