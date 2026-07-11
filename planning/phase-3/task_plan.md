# Phase 3 Task Plan: Resolver, Cache, and Engine Adapter

## Goal
Provide one verified content-addressed resource path for the main thread and engine worker, backed by OPFS with an in-memory fallback, and connect that path to a restartable WASM engine adapter.

## Tasks
- [x] Define the resource cache contract and deterministic in-memory fallback
- [x] Implement async OPFS content storage under bundle-digest namespaces
- [x] Add byte-size accounting and size-capped LRU eviction
- [x] Protect the active manifest from eviction
- [x] Coordinate idempotent writes with `navigator.locks` when available
- [x] Implement manifest validation and filename-to-hash resolution
- [x] Implement cache-first CDN fetch with SHA-256 verification
- [x] Deduplicate in-flight file requests and add best-effort prefetch
- [x] Add a worker-compatible sync-access fast path where supported
- [x] Define and integrate the restartable real-engine adapter boundary
- [x] Add cache, resolver, integrity, fallback, and adapter tests
- [x] Pass all project verification gates
- [ ] Validate against the supplied real engine module and mirrored bundle
- [x] Persist worker sync-cache LRU metadata across reloads
- [x] Coordinate main-thread and worker content/metadata mutations with shared locks
- [x] Add cross-instance evidence that the 1 GB cap cannot be bypassed by stale metadata

## Acceptance Evidence
- Tests prove cache hits avoid fetch and concurrent misses share one request.
- Tests prove bad hashes are rejected and never cached.
- Tests prove LRU eviction respects the size cap and pinned entries.
- Tests prove OPFS absence selects the memory fallback.
- Tests prove engine fatal/crash recovery recreates an adapter and reloads the project.
- `npm run check`, `npm run test`, `npm run build`, and `npm run test:e2e` pass.

## Status
**Integration-ready after cache remediation; external validation pending** — Shared persistent metadata and lock ordering are verified across async/sync instances. Live engine/bundle validation remains unavailable.
