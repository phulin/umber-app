import { describe, expect, it } from "vitest";
import { scanTexDependencies } from "./dependencyScanner";

describe("scanTexDependencies", () => {
  it("finds best-effort class, package, input, and image prefetch candidates", () => {
    expect(
      scanTexDependencies(String.raw`\documentclass{article}
\usepackage[final]{graphicx, amsmath}
\input{chapters/intro}
\include{appendix.tex}
\includegraphics[width=1in]{figures/plot.pdf}`),
    ).toEqual([
      "article.cls",
      "graphicx.sty",
      "amsmath.sty",
      "chapters/intro.tex",
      "appendix.tex",
      "figures/plot.pdf",
    ]);
  });
});
