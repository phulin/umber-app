# Repository Guidance

This project is a browser-native, local-first incremental TeX editor built with TypeScript,
SolidJS, Vite, and a Rust/WASM engine supplied by the sibling `../umber2` repository.

The repository uses progressive disclosure: read this file first, then the nearest nested
`AGENTS.md` before editing within a subdirectory. Keep every `AGENTS.md` up to date whenever
source files or subdirectories are added, removed, or repurposed.

The project also uses bd (Beads) for issue tracking; see below for full instructions.

## General Instructions

- Commit as you go in logical chunks with useful messages: a concise
  one-line summary followed by details when needed. Prefer rough Conventional Commits style.
- Write clean code and make refactors when an area has become complex or difficult to understand.
- Do not optimize only for the smallest or lowest-risk patch. Clean architecture can require
  ambitious, cross-cutting changes, and those changes are appropriate when they are justified by
  the task.
- Keep source files focused and preferably under roughly 600 lines. A file may be somewhat larger
  when cohesion warrants it; split tests only along logical boundaries.
- Prefer principled solutions, clear module boundaries, strong TypeScript types, and efficient
  implementations. Avoid one-off hacks and unnecessary type assertions.
- For complex features, write design or technical documentation in `docs/` before implementation
  so decisions remain available to future work. Do not commit temporary task plans or scratch
  notes; keep durable work tracking and project memory in Beads.
- Colocate nontrivial unit and component tests with their implementation as `*.test.ts` or
  `*.test.tsx`. Put browser-level Playwright coverage in `tests/e2e/`.
- Limit `rg` output aggressively; broad searches can easily consume the available context.
- Codex: for `wait`, use a timeout of at least 180 seconds, and for `wait_agent`, 600 seconds.

## Directory Map

- `.agents/`: project-local agent skills and coordination workflow guidance.
- `docs/`: architecture, feature design, support plans, and launch-readiness documentation.
- `infra/bundle-cdn/`: CDN configuration and operational guidance for immutable TeX bundles.
- `public/`: static deployment headers, SPA redirects, and third-party license notices.
- `scripts/`: build-time asset generation and production-bundle verification scripts.
- `src/app/`: application shell, workspace orchestration, and top-level SolidJS components.
- `src/assets/`: bundled Computer Modern web fonts, encodings, and TFM metrics.
- `src/features/editor/`: CodeMirror integration and UTF-8/source-offset mapping.
- `src/features/performance/`: browser performance monitoring.
- `src/features/preview/`: incremental and standalone HTML preview rendering, fonts, and paper
  geometry.
- `src/features/projects/`: OPFS project persistence, autosave, locking, and archive handling.
- `src/features/resources/`: dependency scanning, bundle resolution, and browser resource caches.
- `src/features/sync/`: source-to-preview span indexing and synchronization support.
- `src/features/telemetry/`: opt-in, privacy-preserving telemetry collection.
- `src/features/tex-compile/`: worker protocol, engine transport, compile sessions, pass
  orchestration, and Rust/WASM adapter integration.
- `src/styles/`: application-wide CSS.
- `src/workers/`: web-worker entry points.
- `tests/e2e/`: Playwright browser and performance tests.
- `tools/bundle-builder/`: standalone Rust utility for constructing and validating immutable TeX
  bundles; follow its README and Cargo workflow when changing it.

## Development

- Run the most relevant tests explicitly while implementing. Use a targeted command such as
  `npm test -- src/features/preview/paperSize.test.ts` to keep feedback and output focused.
- Before handing off TypeScript application changes, run `npm run check`, `npm run test`, and
  `npm run build`. Run `npm run test:e2e` when browser behavior, persistence, workers, preview
  rendering, or the production integration path changes.
- Use `npm run audit:launch` when a single command should build the app, verify production output,
  and run the end-to-end suite.
- Run `cargo test --manifest-path tools/bundle-builder/Cargo.toml` when changing the bundle-builder
  tool.
- Use `npm run dev` for local app runs. The `@umber/umber-wasm` dependency comes from
  `../umber2/target/umber-wasm-package`; rebuild that package in `../umber2` when engine bindings
  change.

## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill for more detailed Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.
- Do not install Beads Git hooks in this repository.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
