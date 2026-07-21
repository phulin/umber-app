import type { CompileOutput } from "@umber/umber-wasm/low-level";
import { describe, expect, it } from "vitest";
import {
  collectGeneratedFiles,
  generatedFileMapsEqual,
  initialLatexGeneratedFiles,
  latexJobName,
  prepareLatexGeneratedInput,
} from "./latexPasses";

const output = (files: CompileOutput["files"]): CompileOutput => ({
  terminal: "",
  log: new Uint8Array(),
  dvi: new Uint8Array(),
  htmlAssets: [],
  files,
});

describe("LaTeX pass state", () => {
  it("derives the auxiliary job name from a nested entry", () => {
    expect(latexJobName("src/paper.tex")).toBe("paper");
    expect(latexJobName("main")).toBe("main");
  });

  it("seeds common read-before-write files for the first pass", () => {
    const generated = initialLatexGeneratedFiles("src/paper.tex");

    expect([...generated.keys()]).toEqual([
      "paper.aux",
      "paper.toc",
      "paper.out",
      "paper.lof",
      "paper.lot",
    ]);
    expect([...generated.values()].every((bytes) => bytes.byteLength === 0)).toBe(true);
  });

  it("normalizes and clones generated output files", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const generated = collectGeneratedFiles(
      output([
        { path: "/job/paper.aux", bytes },
        { path: "paper.toc", bytes: new Uint8Array([4]) },
      ]),
    );

    expect([...generated.keys()]).toEqual(["paper.aux", "paper.toc"]);
    expect(generated.get("paper.aux")).not.toBe(bytes);
  });

  it("declares the LaTeX paper size when the auxiliary file is read", () => {
    const existing = new TextEncoder().encode("\\relax\n");
    const seeded = prepareLatexGeneratedInput("src/paper.tex", "paper.aux", existing);

    expect(new TextDecoder().decode(seeded)).toBe(
      "\\relax\\special{papersize=\\the\\paperwidth,\\the\\paperheight}\n\\relax\n",
    );
    expect(prepareLatexGeneratedInput("src/paper.tex", "paper.toc", existing)).toBe(existing);
  });

  it("detects path, size, and byte changes between passes", () => {
    const baseline = new Map([["paper.aux", new Uint8Array([1, 2])]]);
    expect(generatedFileMapsEqual(baseline, new Map([["paper.aux", new Uint8Array([1, 2])]]))).toBe(
      true,
    );
    expect(generatedFileMapsEqual(baseline, new Map([["paper.aux", new Uint8Array([1, 3])]]))).toBe(
      false,
    );
    expect(generatedFileMapsEqual(baseline, new Map([["paper.toc", new Uint8Array([1, 2])]]))).toBe(
      false,
    );
  });
});
