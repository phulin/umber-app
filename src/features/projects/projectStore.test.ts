import { describe, expect, it } from "vitest";
import { MemoryProjectStore, normalizeProjectPath } from "./projectStore";

const text = (value: string) => new TextEncoder().encode(value);

describe("MemoryProjectStore", () => {
  it("round-trips nested project files and updates the manifest", async () => {
    const store = new MemoryProjectStore();
    const manifest = await store.createProject({
      id: "project-1",
      name: "Paper",
      entry: "main.tex",
      files: {
        "main.tex": text("hello"),
        "figures/plot.bin": new Uint8Array([0, 1, 2, 255]),
      },
    });

    expect(manifest.files).toEqual(["figures/plot.bin", "main.tex"]);
    expect(await store.listProjects()).toHaveLength(1);
    expect([...(await store.readFile("project-1", "figures/plot.bin"))]).toEqual([0, 1, 2, 255]);
    const updated = await store.writeFiles(
      "project-1",
      new Map([["chapters/one.tex", text("chapter")]]),
    );
    expect(updated.files).toContain("chapters/one.tex");
    expect(new TextDecoder().decode(await store.readFile("project-1", "chapters/one.tex"))).toBe(
      "chapter",
    );
  });

  it("rejects archive traversal and absolute paths", () => {
    expect(() => normalizeProjectPath("../secret")).toThrow("Invalid project path");
    expect(() => normalizeProjectPath("/absolute.tex")).toThrow("Invalid project path");
    expect(normalizeProjectPath("chapters\\one.tex")).toBe("chapters/one.tex");
  });
});
