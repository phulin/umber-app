import { describe, expect, it } from "vitest";
import { workspaceProjectFiles } from "./Workspace";

describe("workspaceProjectFiles", () => {
  it("preserves binary resources while encoding editable documents", () => {
    const binary = new Uint8Array([0, 255, 4, 9]);
    const files = workspaceProjectFiles(
      [{ id: "main", path: "main.tex", text: "hello" }],
      [{ id: "plot", path: "figures/plot.png", bytes: binary }],
    );

    expect(files.map(({ path }) => path)).toEqual(["main.tex", "figures/plot.png"]);
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe("hello");
    expect([...new Uint8Array(files[1]?.bytes ?? new ArrayBuffer())]).toEqual([0, 255, 4, 9]);
    expect(files[1]?.bytes).not.toBe(binary.buffer);
  });
});
