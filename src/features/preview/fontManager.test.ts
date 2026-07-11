import { describe, expect, it, vi } from "vitest";
import {
  FontManager,
  fontFamilyForHash,
  type LoadableFontFace,
  pendingFontClass,
} from "./fontManager";

describe("FontManager", () => {
  it("derives deterministic synthetic family names from hashes", () => {
    expect(fontFamilyForHash("3FA9-C2_deadbeef")).toBe("f-3fa9c2deadbeef");
    expect(fontFamilyForHash("3FA9-C2_deadbeef")).toBe(fontFamilyForHash("3FA9-C2_deadbeef"));
  });

  it("deduplicates loads and hides pending font content until registration", async () => {
    const root = document.createElement("div");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const get = vi.fn(async () => bytes);
    let resolveLoad: ((face: LoadableFontFace) => void) | undefined;
    const face: LoadableFontFace = {
      load: vi.fn(
        () =>
          new Promise<LoadableFontFace>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    };
    const add = vi.fn();
    const factory = vi.fn(() => face);
    const manager = new FontManager({ get }, { root, fontSet: { add }, factory });
    const font = { family: "Latin Modern", styleKey: "normal", fileHash: "abc123" };

    const first = manager.ensure(font);
    const second = manager.ensure(font);
    expect(first).toBe(second);
    expect(root.classList.contains(pendingFontClass(font.fileHash))).toBe(true);
    await Promise.resolve();
    resolveLoad?.(face);
    await first;

    expect(get).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("f-abc123", bytes, { style: "normal" });
    expect(add).toHaveBeenCalledWith(face);
    expect(root.classList.contains(pendingFontClass(font.fileHash))).toBe(false);
    expect(document.head.querySelector('[data-umber-font-pending="abc123"]')).not.toBeNull();
  });
});
