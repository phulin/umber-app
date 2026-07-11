import { describe, expect, it } from "vitest";
import { SpanIndex } from "./spanIndex";

describe("SpanIndex", () => {
  it("returns the innermost source span covering a cursor offset", () => {
    const index = new SpanIndex();
    index.apply(1, [
      { elemId: "paragraph", docId: "main", byteStart: 10, byteEnd: 100 },
      { elemId: "word", docId: "main", byteStart: 30, byteEnd: 35 },
      { elemId: "other", docId: "bib", byteStart: 0, byteEnd: 8 },
    ]);

    expect(index.innermost("main", 32)?.elemId).toBe("word");
    expect(index.innermost("main", 70)?.elemId).toBe("paragraph");
    expect(index.innermost("main", 101)).toBeUndefined();
    expect(index.byElement("other")?.docId).toBe("bib");
  });

  it("accumulates streaming spans and clears them on a newer epoch", () => {
    const index = new SpanIndex();
    index.apply(1, [{ elemId: "one", docId: "main", byteStart: 0, byteEnd: 1 }]);
    index.apply(1, [{ elemId: "two", docId: "main", byteStart: 2, byteEnd: 3 }]);
    expect(index.byElement("one")).toBeDefined();
    expect(index.byElement("two")).toBeDefined();

    index.apply(2, [{ elemId: "new", docId: "main", byteStart: 4, byteEnd: 5 }]);
    expect(index.byElement("one")).toBeUndefined();
    expect(index.byElement("new")).toBeDefined();
    expect(index.apply(1, [])).toBe(false);
  });
});
