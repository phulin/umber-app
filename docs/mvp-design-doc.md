# MVP Design Doc — Browser-Native Incremental TeX Editor

**Status:** Accepted implementation path (2026-07-11)
**Scope:** Single-user, local-first, in-browser editor with incremental compile and bidirectional sync.
**Given:** A full-parity incremental TeX engine (Rust→WASM) that produces coordinate-identical HTML, runs in a Web Worker, performs its own async resource fetches, and emits progress messages. Engine internals are out of scope here; its message protocol is not.

---

## 1. Goals and non-goals

**Goals**

- Keystroke-to-preview latency that feels continuous: p50 ≤ 50 ms, p95 ≤ 150 ms for a paragraph-local edit in a warm ~30-page document.
- Cold open of a document with uncached packages ≤ 5 s on a typical connection; warm reload ≤ 1 s.
- Precise bidirectional sync (click preview → cursor in source; move cursor → preview scrolls and highlights) using engine source spans.
- Inline diagnostics with real source positions.
- Fully static deployment: no application server in the compile path.
- Local-first persistence: projects survive reload without accounts.

**Non-goals (MVP)**

Accounts, real-time collaboration, WYSIWYG editing, template gallery, PDF export UI polish (a basic export can ride along if the engine already serializes PDF; otherwise defer), mobile layout, offline-first installability (PWA hooks may fall out for free but are not a requirement).

---

## 2. System overview

```
┌────────────────────────────── Browser ──────────────────────────────┐
│                                                                     │
│  Main thread                                                        │
│  ┌───────────┐   edit deltas    ┌──────────────────┐                │
│  │ Editor    │◄────────────────►│ Compile          │                │
│  │ (CM6)     │   diagnostics    │ Orchestrator     │                │
│  └───────────┘                  └───────┬──────────┘                │
│  ┌───────────┐   DOM patches            │ postMessage               │
│  │ Preview   │◄──────────────┐          │ (protocol §5)             │
│  │ Renderer  │               │          ▼                           │
│  └─────┬─────┘        ┌──────┴───────────────────┐                  │
│        │              │ Engine Worker (WASM)     │                  │
│  ┌─────┴─────┐        │  - incremental engine    │                  │
│  │ Font      │        │  - snapshot store        │                  │
│  │ Manager   │        │  - resolver (§6)         │                  │
│  └─────┬─────┘        └──────┬───────────────────┘                  │
│        │                     │                                      │
│        └──────► Resource/Cache Layer (OPFS, §7) ◄────────           │
│                              │                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ HTTPS (content-addressed, immutable)
                    ┌──────────┴──────────┐
                    │  Bundle CDN (§10)   │
                    └─────────────────────┘
```

Two independent consumers fetch from the same cache/CDN: the **engine worker** (package files, font *metrics*) and the **main-thread font manager** (font *binaries* for `FontFace` registration). The cache layer dedupes so a font fetched for metrics is never re-downloaded for rendering.

---

## 3. Frontend components

### 3.1 App shell

Thin. Project list view, editor view, demo view. No router library needed beyond hash/history routing over three screens. State management: keep it boring — a small store (Zustand or hand-rolled) holding project metadata, compile status, and diagnostics; the heavy state (document text, DOM tree, engine memory) lives in its owning component/worker and never passes through the store.

### 3.2 Editor (CodeMirror 6)

CM6 over Monaco: smaller, extension-first architecture, first-class incremental change sets that map directly onto our edit-delta protocol.

Responsibilities:

- Emit **edit deltas** (`{docId, fromByte, toByte, insertedText}`) on every transaction. CM6 changesets already carry exactly this; convert UTF-16 offsets to byte offsets at the boundary (the engine speaks bytes; keep a rolling offset map per document rather than re-encoding on every keystroke).
- Render diagnostics from the engine as squiggles + gutter markers via CM6's lint extension. Diagnostics carry byte spans; map back to UTF-16.
- Cursor activity events (debounced ~100 ms) feed forward-sync (§3.6).
- LaTeX syntax highlighting via an existing CM6 legacy mode or a Lezer grammar. MVP: ship the legacy stex mode; a proper Lezer grammar is a fast-follow, not a blocker.
- Multi-file: one CM6 state per open file, tab strip above the editor. The engine sees a project as a set of named documents; the editor just needs to route deltas with the right `docId`.

Explicitly not in the editor for MVP: autocomplete, snippets, format-on-save.

### 3.3 Compile orchestrator (main thread)

The traffic controller between editor and engine worker. This is small but load-bearing; get its invariants right.

- **Epoch model.** Every edit increments a monotonic `editEpoch`. Every message to the engine and every patch from it carries the epoch it corresponds to. The renderer discards patches from epochs older than the last applied one. This makes out-of-order and superseded compiles safe by construction.
- **Coalescing.** Forward deltas to the engine immediately (the engine's own incrementality decides what to reuse; don't second-guess it with debounce on the send side). If the engine reports it is saturated (compile in flight, N deltas queued), coalesce pending deltas into one before sending the next batch.
- **Cancellation.** On new input, send `cancel {beforeEpoch}` so the engine can abandon stale work at its next safe point. The engine remains authoritative about what "safe point" means.
- **Status surface.** Consume `progress` messages into a single UI affordance: a slim activity bar (compiling / fetching `xyz.sty` / idle) — visible but never modal.

### 3.4 Preview renderer

Consumes coordinate-identical HTML patches and maintains the live preview.

- **Page-keyed DOM.** The preview is a vertical stack of absolutely-sized page containers. The engine addresses content by stable IDs (§5 patch format); the renderer's job is `applyPatch`: replace/insert/remove identified block subtrees, add/remove pages. Use `Element.setHTMLUnsafe`/`innerHTML` on detached containers, then swap — never incrementally mutate live subtrees mid-patch.
- **Virtualization.** Only mount pages within the viewport ± 2 pages; keep unmounted pages as empty spacers with correct heights (heights are known exactly — the engine produces them). Without this, a 200-page document will die at style/layout time regardless of how fast the engine is.
- **Patch application ≠ jank.** Apply patches inside `requestAnimationFrame`; if a patch storm arrives (full recompile), batch all pages in one frame if under budget, otherwise chunk by page with the viewport pages first.
- **Scroll anchoring.** When content above the viewport changes height, compensate scroll position so the user's view doesn't jump. The engine's exact page heights make this deterministic.
- **Selection/copy.** Coord-identical HTML tends to break text selection (absolutely positioned runs). MVP stance: accept engine-native selection quality, verify copy produces readable text ordering per block. If glyph runs are positioned per-word or finer, add `user-select` boundaries at block level. Do not attempt a selection overlay in MVP.

### 3.5 Font manager (main thread)

Owns the *rendering* side of fonts; the engine independently consumes the same binaries for metrics.

- Engine announces fonts as it encounters them: `fontsNeeded [{family, styleKey, fileHash}]`. The font manager resolves `fileHash` through the shared cache (§7) — almost always already present because the engine just fetched it for metrics — and registers a `FontFace` under a **deterministic synthetic family name** derived from the hash (e.g. `f-3fa9c2`). The engine emits HTML referencing exactly these names. No fontconfig-style matching in the browser, ever.
- **Late-arrival behavior.** Because layout is engine-computed and positions are absolute, a late font cannot cause reflow — only a repaint. Policy: render text in the affected face as `visibility: hidden` (via a `fonts-pending-<hash>` class toggled by the font manager) until its `FontFace` resolves, then reveal. No fallback-font flash, no layout shift. Fonts resolve in tens of ms from OPFS, so hidden states are rare and brief after first use.
- **Preload set.** Ship Latin Modern (or the engine's default face set) inside the app bundle so a fresh user's first document paints with zero font round-trips.
- Format note: serve fonts as WOFF2 in the bundle where possible (smaller); the engine metrics path can read the same WOFF2 (decompress in worker) or the bundle can carry OTF+WOFF2 pairs keyed to the same logical font — decide with measurements, prefer single-artifact WOFF2.

### 3.6 Sync service (bidirectional source ↔ preview)

The span data model is the contract:

- The engine emits, per patch, a **sidecar span table** rather than per-node data attributes (keeps HTML payloads lean): `[{elemId, docId, byteStart, byteEnd}]` for every addressable element it chooses to expose (word-run or box granularity — engine's choice, renderer is agnostic).
- **Reverse sync (click → source):** pointer events on the preview walk up to the nearest `elemId`, look up the span, dispatch the editor to `{docId, byteOffset}`. O(1) map lookup.
- **Forward sync (cursor → preview):** maintain per-document interval trees over spans. On (debounced) cursor movement, query the tree for the innermost covering span, scroll its element into view, and paint a transient highlight. Rebuild only the trees of documents touched by the latest patch; incremental tree repair is a non-goal for MVP.
- Spans are versioned by epoch alongside patches; a sync query always runs against the epoch currently rendered.

### 3.7 Diagnostics panel

Inline squiggles (via §3.2) plus a collapsible bottom panel listing errors/warnings with file:offset, click-to-jump. Diagnostics stream in during compile (don't wait for compile end). Superseded-epoch diagnostics are dropped like patches.

### 3.8 Project store

Local-first persistence over OPFS.

- Layout: `/projects/<uuid>/manifest.json` (name, entry file, file list, timestamps) + `/projects/<uuid>/files/<path>`.
- Save policy: debounce writes ~500 ms after last edit; flush on `visibilitychange`/`pagehide`.
- Import/export: drag-drop a folder or `.zip` in; "Download project" produces a `.zip` (client-side, `fflate`). This is the MVP answer to backup, sharing, and migration — and the escape hatch that makes "no accounts" acceptable.
- Cross-tab safety: `navigator.locks` per project; second tab opening the same project gets read-only mode with a banner. Do not attempt multi-tab merge.
- Engine snapshots are **ephemeral** (in-worker-memory only) for MVP. Persisted snapshots (instant resume across reloads) are attractive but couple us to engine memory-layout stability across versions; revisit post-MVP.

### 3.9 Demo page ("try without signup")

The landing page *is* the product with a preloaded document and no persistence guarantees (still uses OPFS scratch space so refresh doesn't lose work mid-session). Same components, one flag. A "copy this into a real project" button. This page is the marketing plan; treat its cold-load performance as a launch gate: measure time-to-first-keystroke-response as the KPI.

---

## 4. Engine worker integration (consuming what exists)

The engine is given; the integration obligations on our side:

- **Module + memory lifecycle.** Instantiate WASM once per project session. Define an out-of-memory / panic recovery path: on worker crash, restart worker, reload project files, full recompile, toast the user. Crash recovery must be boring and automatic.
- **Fetch path.** The engine performs async fetches itself; it must do so **through the shared resource layer API** (§7) rather than raw `fetch`, so caching, dedup, and telemetry are uniform with UI-side fetches. Provide the resolver client (§6) as an imported JS module the WASM side calls.
- **Backpressure contract.** The engine must be able to receive deltas while compiling and either incorporate or queue them, reporting `saturated` when the orchestrator should coalesce. (If the engine prefers strict one-compile-at-a-time, the orchestrator degrades gracefully to send-on-idle; the protocol supports both.)

---

## 5. Editor ⇄ Engine protocol

Transport: `postMessage` with transferables for large payloads (HTML patches as `ArrayBuffer` of UTF-8; span tables as typed arrays where practical).

```ts
// ── main thread → engine worker ──────────────────────────
type ToEngine =
  | { t: "init", bundleDigest: string, engineOpts: {...} }
  | { t: "openProject", files: {docId: string, path: string, bytes: ArrayBuffer}[],
      entry: string }
  | { t: "edit", epoch: number, docId: string,
      fromByte: number, toByte: number, insert: ArrayBuffer }
  | { t: "cancel", beforeEpoch: number }
  | { t: "fileAdd" | "fileRemove", docId: string, path?: string, bytes?: ArrayBuffer }
  | { t: "exportPdf", epoch: number }            // optional, if engine supports

// ── engine worker → main thread ──────────────────────────
type FromEngine =
  | { t: "ready", engineVersion: string }
  | { t: "progress", epoch: number,
      phase: "expanding" | "typesetting" | "fetching" | "idle",
      detail?: string }                           // e.g. "tikz.sty"
  | { t: "saturated", queuedDeltas: number }
  | { t: "fontsNeeded", fonts: {family: string, fileHash: string}[] }
  | { t: "patch", epoch: number,
      pages: {pageId: string, widthPt: number, heightPt: number, index: number}[],
      removePages: string[],
      blocks: {pageId: string, blockId: string, html: ArrayBuffer}[],
      removeBlocks: {pageId: string, blockId: string}[],
      spans: SpanTable,                           // sidecar, epoch-scoped
      final: boolean }                            // false = streaming partial
  | { t: "diagnostics", epoch: number,
      items: {severity: "error"|"warning", docId: string,
              byteStart: number, byteEnd: number, message: string}[] }
  | { t: "pdf", epoch: number, bytes: ArrayBuffer }
  | { t: "fatal", message: string }               // triggers worker restart path
```

Protocol invariants:

1. Patches for epoch *n* fully describe the delta from the last applied epoch the engine acknowledged; the renderer never needs to diff.
2. `final: false` patches let the engine stream viewport-priority pages early; renderer applies them identically.
3. All offsets are byte offsets into the document version at the stated epoch.
4. Unknown message types are ignored by both sides (forward compatibility).

---

## 6. Resolver & bundle client (shared module)

One TypeScript module used by both the engine worker (via JS import) and the main thread.

- **Manifest.** On `init`, fetch `manifest-<digest>.json` (or load from cache): a flat map `filename → {hash, size, flags}`. Flat namespace, Tectonic-style: name conflicts are resolved at bundle build time, lookup is one map probe. Manifest for a full TeX Live tree is a few MB raw; ship it gzipped and store parsed in the worker (structured-clone once to main thread for the font manager).
- **Resolution:** `resolve(name) → hash | null`; `null` surfaces to the engine as file-not-found (a normal TeX condition it already handles).
- **Fetch:** `getFile(hash) → Promise<ArrayBuffer>` — cache-first (§7), then CDN `GET /f/<hash>`, verify hash, insert into cache. In-flight dedup map so concurrent requests for one hash share a promise.
- **Prefetch:** `prefetch(names[])` fire-and-forget, called by the orchestrator after a cheap static scan of project sources for `\usepackage`, `\input`, `\includegraphics`, `\documentclass`. Best-effort; misses fall back to engine on-demand fetch (which, with snapshots, resumes rather than restarts).

Content-addressed per-file objects are chosen over a single indexed archive + range requests: better CDN cache granularity, trivial delta publishing between bundle versions, no range/content-coding edge cases. HTTP/2 multiplexing absorbs the many-small-requests cost.

## 7. Cache layer (OPFS)

- Layout: `/cache/<bundleDigest>/… by hash`, plus `/cache/meta.json` (LRU bookkeeping, total size).
- API: `get(hash)`, `put(hash, bytes)`, `has(hash)`; workers use OPFS **sync access handles** (fast path); main thread uses the async API. Cross-context write coordination via `navigator.locks` keyed by hash (writes are rare and idempotent — content-addressed — so contention is a non-issue; last write wins with identical bytes).
- Eviction: size-capped LRU (default 1 GB, user-adjustable later). Never evict the active bundle's manifest.
- Immutability: entries are valid forever by construction; a new bundle digest is a new namespace. No invalidation logic exists anywhere in the client. Fallback: if OPFS is unavailable (rare, e.g. some private-browsing modes), degrade to in-memory cache with a console warning — everything still works, just cold every session.

---

## 8. Backend components

There is no application server in the MVP. "Backend" = build-time tooling + static infrastructure.

### 8.1 Bundle build pipeline (offline tool, Rust)

Input: a TeX Live snapshot tarball (+ our patch/selection config). Output: an immutable bundle.

Steps: unpack texmf tree → apply file-selection rules and name-conflict resolution (search-order config, à la Tectonic's bundle tooling — evaluate reusing/forking theirs before writing from scratch) → normalize fonts (WOFF2 where feasible, keep originals when the engine requires) → hash every file (BLAKE3 or SHA-256; pick one, forever) → emit `files/<hash>` objects + `manifest-<digest>.json` where `digest` = hash of the manifest → upload to object storage. CI job, versioned config in-repo, reproducible.

Bootstrap shortcut: for the first weeks of development, mirror an existing Tectonic bundle and generate our manifest from its index, deferring the full pipeline until the format stabilizes.

### 8.2 Bundle CDN

Object storage + CDN (R2/S3+CloudFront class). Requirements:

- `Access-Control-Allow-Origin: *` on all bundle paths (public, immutable data; no credentials).
- `Cache-Control: public, max-age=31536000, immutable` on `files/<hash>` and digest-named manifests.
- Serve font/binary files without on-the-fly content-coding surprises; per-file pre-compression (brotli) with correct `Content-Encoding` is fine since we fetch whole objects, not ranges.
- Budget note: egress is the only meaningful hosting cost; content-addressing + immutable caching keeps repeat traffic near zero.

### 8.3 App hosting

Static site (the SPA + WASM + preloaded fonts) on the same CDN class. Requirements: correct `application/wasm` MIME (streaming instantiation), long-cache hashed assets, short-cache `index.html`. **No COOP/COEP requirement** — the async-fetch engine design means no SharedArrayBuffer, so hosting stays maximally simple and third-party embeds (demo page shares/iframes) stay possible.

### 8.4 Telemetry & error reporting (minimal, optional)

Privacy-respecting, aggregate-only: compile latency histograms, cache hit rates, worker-crash counts, bundle fetch failures. Client-side opt-out toggle. No document content, ever. Implementation: a single beacon endpoint (this is the one place a tiny serverless function exists) or an off-the-shelf privacy-focused analytics service. Ship without it if it threatens the timeline; add before public launch.

### 8.5 Explicitly deferred

Accounts/auth, server-side compile fallback, share-by-link (requires storage + abuse handling), real-time collaboration, PDF rendering service, package-version pinning UI (the bundle digest pins everything implicitly for now).

---

## 9. Performance budgets & instrumentation

| Metric | Budget | Notes |
|---|---|---|
| Edit → patch applied (warm, 30 pp) | p50 ≤ 50 ms, p95 ≤ 150 ms | end-to-end incl. DOM |
| Patch DOM application | ≤ 8 ms/frame | chunk if exceeded |
| Cold demo page → first render | ≤ 3 s | preloaded fonts, small doc |
| Cold compile, uncached packages | ≤ 5 s typical doc | prefetch + parallel fetch |
| Worker memory (engine + snapshots) | ≤ 1.5 GB steady | wasm32 ceiling is 4 GB |
| OPFS cache | ≤ 1 GB LRU | |

Instrument from day one: a `performance.mark`-based trace across orchestrator→engine→renderer, dumped via a debug panel. Latency regressions must be visible in dev, not discovered by users.

---

## 10. Risks & open questions

1. **Patch/span granularity** is the contract with the most churn risk. Lock the protocol (§5) with a golden-file test suite (source edit → expected patch stream) before building the renderer against it.
2. **Text selection quality** in coord-identical HTML — spike early; if per-glyph positioning breaks selection badly, the engine may need to group runs at word level.
3. **Manifest size** on low-end devices — measure parse/memory; mitigation is a two-tier manifest (hot core + lazily fetched long tail).
4. **WOFF2 vs OTF duality** for engine metrics vs rendering — resolve with a measurement, not a debate; single-artifact strongly preferred.
5. **Epoch semantics under engine queuing** (§4 backpressure) need one precise paragraph agreed with the engine before orchestrator work starts.

## 11. Build order

1. Protocol golden tests + a fake engine (replays recorded patch streams) → unblocks all frontend work in parallel with engine integration.
2. Renderer + font manager against the fake engine.
3. Resolver/cache + mirrored Tectonic bundle; real engine wired through the resource layer.
4. Editor + orchestrator + diagnostics; sync service.
5. Project store, import/export; demo page; perf hardening against budgets (§9).
6. Bundle pipeline productionized; CDN + hosting; telemetry; launch-gate perf audit.

