import { describe, expect, it } from "vitest";
import { Utf8OffsetMap } from "./utf8OffsetMap";

describe("Utf8OffsetMap", () => {
  it("maps ASCII, multibyte, and surrogate-pair boundaries", () => {
    const map = new Utf8OffsetMap("Aé🙂Z");

    expect([0, 1, 2, 3, 4, 5].map((offset) => map.utf16ToByte(offset))).toEqual([0, 1, 3, 3, 7, 8]);
    expect(map.byteToUtf16(0)).toBe(0);
    expect(map.byteToUtf16(2)).toBe(1);
    expect(map.byteToUtf16(3)).toBe(2);
    expect(map.byteToUtf16(5)).toBe(2);
    expect(map.byteToUtf16(7)).toBe(4);
  });

  it("updates only the edited offset suffix", () => {
    const map = new Utf8OffsetMap("alpha é omega");
    const delta = map.applyChange(6, 7, "🙂");

    expect(delta).toEqual({
      fromUtf16: 6,
      toUtf16: 7,
      fromByte: 6,
      toByte: 8,
      insertedText: "🙂",
    });
    expect(map.text).toBe("alpha 🙂 omega");
    expect(map.byteLength).toBe(new TextEncoder().encode(map.text).byteLength);
    expect(map.utf16ToByte(map.text.length)).toBe(map.byteLength);
  });

  it("coalesces a full CodeMirror transaction to one minimal delta", () => {
    const map = new Utf8OffsetMap("Hello brave world");
    const delta = map.replaceWith("Hello small world");

    expect(delta).toEqual({
      fromUtf16: 6,
      toUtf16: 11,
      fromByte: 6,
      toByte: 11,
      insertedText: "small",
    });
    expect(map.text).toBe("Hello small world");
    expect(map.replaceWith("Hello small world")).toBeNull();
  });
});
