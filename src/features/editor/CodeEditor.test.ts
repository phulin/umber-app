import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../tex-compile/protocol";
import { engineDiagnosticsToCodeMirror } from "./CodeEditor";
import { Utf8OffsetMap } from "./utf8OffsetMap";

describe("engineDiagnosticsToCodeMirror", () => {
  it("maps engine byte spans back to CodeMirror UTF-16 offsets", () => {
    const offsets = new Utf8OffsetMap("é🙂 warning");
    const diagnostics: Diagnostic[] = [
      {
        severity: "warning",
        docId: "main",
        byteStart: 2,
        byteEnd: 6,
        message: "emoji warning",
      },
    ];

    expect(engineDiagnosticsToCodeMirror(diagnostics, offsets)).toEqual([
      { from: 1, to: 3, severity: "warning", message: "emoji warning" },
    ]);
  });
});
