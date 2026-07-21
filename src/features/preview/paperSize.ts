const pointsToPixels = 96 / 72;

type PaperSize = { widthPt: number; heightPt: number };

function decodeHex(value: string): string | undefined {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return undefined;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

export function declaredPaperSize(source: string): PaperSize | undefined {
  for (const match of source.matchAll(/data-umber-special-hex="([0-9a-f]+)"/gi)) {
    const special = decodeHex(match[1] ?? "");
    const dimensions = /^papersize=([\d.]+)pt,([\d.]+)pt$/i.exec(special ?? "");
    if (!dimensions) continue;
    const widthPt = Number(dimensions[1]);
    const heightPt = Number(dimensions[2]);
    if (Number.isFinite(widthPt) && widthPt > 0 && Number.isFinite(heightPt) && heightPt > 0) {
      return { widthPt, heightPt };
    }
  }
  return undefined;
}

export function applyDeclaredPaperSize(source: string): string {
  const paper = declaredPaperSize(source);
  if (!paper) return source;
  const widthSp = Math.round(paper.widthPt * 65_536);
  const heightSp = Math.round(paper.heightPt * 65_536);
  const widthPx = (paper.widthPt * pointsToPixels).toFixed(8);
  const heightPx = (paper.heightPt * pointsToPixels).toFixed(8);
  return source.replace(/<section class="umber-page"(?=\s)[^>]*>/g, (tag) =>
    tag
      .replace(/data-umber-width-sp="-?\d+"/, `data-umber-width-sp="${widthSp}"`)
      .replace(/data-umber-height-sp="-?\d+"/, `data-umber-height-sp="${heightSp}"`)
      .replace(
        /style="width:[\d.]+px;height:[\d.]+px"/,
        `style="width:${widthPx}px;height:${heightPx}px"`,
      ),
  );
}
