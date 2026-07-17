import { describe, expect, it } from "vitest";
import { exportProjectZip, importProjectFiles, importProjectZip } from "./projectArchive";
import { MemoryProjectStore } from "./projectStore";

describe("project ZIP archives", () => {
  it("round-trips nested text and binary files with entry metadata", async () => {
    const source = new MemoryProjectStore();
    await source.createProject({
      id: "source",
      name: "My paper",
      entry: "src/paper.tex",
      compileMode: "latex",
      files: {
        "src/paper.tex": new TextEncoder().encode("paper"),
        "figures/pixel.bin": new Uint8Array([0, 255, 4]),
      },
    });
    const archive = await exportProjectZip(source, "source");
    const destination = new MemoryProjectStore();
    const imported = await importProjectZip(destination, archive, { id: "copy" });

    expect(imported.name).toBe("My paper");
    expect(imported.entry).toBe("src/paper.tex");
    expect(imported.compileMode).toBe("latex");
    expect([...(await destination.readFile("copy", "figures/pixel.bin"))]).toEqual([0, 255, 4]);
  });

  it("imports browser folder selections while stripping their shared root", async () => {
    const store = new MemoryProjectStore();
    const main = new File(["main"], "main.tex");
    Object.defineProperty(main, "webkitRelativePath", { value: "paper/main.tex" });
    const bibliography = new File(["bib"], "refs.bib");
    Object.defineProperty(bibliography, "webkitRelativePath", { value: "paper/data/refs.bib" });

    const manifest = await importProjectFiles(store, [main, bibliography], {
      id: "folder",
      compileMode: "latex",
    });

    expect(manifest.name).toBe("paper");
    expect(manifest.files).toEqual(["data/refs.bib", "main.tex"]);
    expect(manifest.compileMode).toBe("latex");
  });
});
