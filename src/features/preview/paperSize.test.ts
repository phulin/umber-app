import { describe, expect, it } from "vitest";
import { applyDeclaredPaperSize, declaredPaperSize } from "./paperSize";

const specialHex = Array.from(new TextEncoder().encode("papersize=614.295pt,794.96999pt"))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

describe("LaTeX paper size", () => {
  it("reads the physical dimensions from the generated DVI special", () => {
    expect(declaredPaperSize(`<span data-umber-special-hex="${specialHex}"></span>`)).toEqual({
      widthPt: 614.295,
      heightPt: 794.96999,
    });
  });

  it("applies the physical dimensions to every rendered page", () => {
    const page =
      '<section class="umber-page" data-umber-width-sp="1" data-umber-height-sp="2" style="width:3px;height:4px">';
    const output = applyDeclaredPaperSize(
      `${page}${page}<span data-umber-special-hex="${specialHex}"></span>`,
    );

    expect(output.match(/data-umber-width-sp="40258437"/g)).toHaveLength(2);
    expect(output.match(/data-umber-height-sp="52099153"/g)).toHaveLength(2);
    expect(output.match(/style="width:819.06000000px;height:1059.95998667px"/g)).toHaveLength(2);
  });

  it("leaves output without a valid paper-size declaration unchanged", () => {
    const source = '<section class="umber-page" style="width:3px;height:4px">';
    expect(applyDeclaredPaperSize(source)).toBe(source);
  });
});
