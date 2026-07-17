# LaTeX Support Plan

Most of the required Umber infrastructure already exists. The main missing work is in `umber-app`: it always boots `plain.fmt`, so downloaded `.cls` and `.sty` files cannot make LaTeX syntax work.

What needs to change in `umber-app`:

1. Add an explicit project compile mode, such as `"plain"` or `"latex"`.

2. For LaTeX projects, load the format through the existing resolver:

```ts
const format = await resolver.resolveFormat("latex", {
  engineVersion: packageVersion(),
  formatSchema: formatSchemaVersion(),
});
```

3. Construct `CompilerSession` with that format instead of the currently bundled Plain format in `plainWasmEngine.ts`.

4. Set the appropriate engine/session mode if required by the format contract, preferably `engine: "latex"`.

5. Persist the selected format in the project manifest and expose a small project setting or import-time choice. It should not infer LaTeX by searching for `\documentclass`.

6. Rename/refactor `createPlainWasmEngine` into a general distribution-backed engine. Bundled Plain fonts can remain local resources; `.cls`, `.sty`, `.tex`, and missing TFMs already fall through to the new distribution resolver.

7. Handle LaTeX’s generated files and repeated passes:

- Start with an empty `<jobname>.aux` file.
- Capture generated `.aux`, `.toc`, `.out`, etc.
- Feed changed generated files into another pass.
- Stop when they stabilize or after a bounded pass count.
- Keep these generated files separate from authored project files.

Without this, simple documents may render, but references, tables of contents, citations, and packages that rely on auxiliary state will not behave correctly.

What may still need to change in Umber:

- Confirm the production manifest actually publishes a schema-compatible `latex` format for the exact WASM engine version. The worktree appears designed to do this.
- Expose generated-file outputs cleanly from the persistent `CompilerSession` if the current low-level result does not provide them.
- Ensure incremental sessions can restart or establish a new accepted revision after an auxiliary-file pass.
- Add a browser parity fixture compiling a representative LaTeX document against the production manifest.
- Potentially expose a higher-level persistent LaTeX façade. The existing `compileInWorker` supports format selection but is one-shot, while this app needs persistent edits and rendered-source mapping.

So the division is:

- **Package discovery/download:** already implemented.
- **Selecting `latex.fmt`:** app change.
- **Project format setting:** app change.
- **AUX/TOC multi-pass orchestration:** primarily app change, possibly requiring a better generated-files API from Umber.
- **TeX/LaTeX compatibility failures discovered afterward:** Umber engine changes.

The smallest useful next step is explicit LaTeX mode plus `resolveFormat("latex")`. That should make ordinary single-pass `\documentclass` and `\usepackage` documents work. Multi-pass orchestration is the next slice for references, TOCs, and bibliographies.
