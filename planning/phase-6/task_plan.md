# Phase 6 Task Plan: Bundle Pipeline, Hosting, Telemetry, and Launch Audit

## Goal
Productionize the immutable TeX bundle pipeline and static hosting configuration, add privacy-preserving optional telemetry, and automate the launch performance/readiness audit.

## Tasks
- [x] Implement a reproducible Rust bundle builder using SHA-256
- [x] Emit content-addressed file objects and a digest-named manifest
- [x] Add selection/conflict policy configuration and deterministic ordering
- [x] Add bundle-builder golden and reproducibility tests
- [x] Define bundle CDN CORS and immutable cache policies
- [x] Define static app MIME/cache headers, including WASM
- [x] Document Cloudflare Pages and object-storage deployment
- [x] Add opt-in aggregate-only telemetry with no document content
- [x] Add a user-visible telemetry preference
- [x] Add cold-demo and production-bundle launch checks
- [x] Produce a requirement-by-requirement launch readiness report
- [x] Pass TypeScript, Rust, unit, build, and Chromium verification gates
- [ ] Validate the real engine, mirrored bundle, default font preload, and performance budgets
- [x] Accept a TeX Live snapshot tarball directly and prove it matches directory input
- [x] Include cache hit/miss, hard worker crash, and bundle fetch failure counters in telemetry

## Acceptance Evidence
- Two builds of one fixture produce byte-identical manifests/digests and deduplicated objects.
- CDN policy enables public CORS and one-year immutable caching for digest content.
- Pages policy serves WASM correctly, hashed assets immutably, and `index.html` with revalidation.
- Telemetry is disabled by default, contains aggregate metrics only, and honors user preference.
- Browser launch check proves cold demo first render ≤3 s.
- Live-engine audit proves warm paragraph-edit p50 ≤50 ms, p95 ≤150 ms and cold compile ≤5 s.

## Status
**Implementation complete; live launch audit pending** — Aggregate latency and health telemetry are connected and verified. Real-engine, mirrored-bundle, font, and performance validation still require the external launch inputs listed in the notes.
