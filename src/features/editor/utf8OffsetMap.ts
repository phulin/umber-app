export type TextEditDelta = {
  fromUtf16: number;
  toUtf16: number;
  fromByte: number;
  toByte: number;
  insertedText: string;
};

const encoder = new TextEncoder();

function relativeByteOffsets(value: string): number[] {
  const offsets = new Array<number>(value.length + 1);
  offsets[0] = 0;
  let utf16 = 0;
  let bytes = 0;
  for (const character of value) {
    const units = character.length;
    if (units === 2) offsets[utf16 + 1] = bytes;
    bytes += encoder.encode(character).byteLength;
    utf16 += units;
    offsets[utf16] = bytes;
  }
  return offsets;
}

export class Utf8OffsetMap {
  #text: string;
  #byteOffsets: number[];

  constructor(text = "") {
    this.#text = text;
    this.#byteOffsets = relativeByteOffsets(text);
  }

  get text(): string {
    return this.#text;
  }

  get byteLength(): number {
    return this.#byteOffsets.at(-1) ?? 0;
  }

  utf16ToByte(offset: number): number {
    this.#assertUtf16Offset(offset);
    return this.#byteOffsets[offset] ?? 0;
  }

  byteToUtf16(offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.byteLength) {
      throw new RangeError(`Byte offset out of range: ${offset}`);
    }
    let low = 0;
    let high = this.#byteOffsets.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.#byteOffsets[middle] ?? 0) < offset) low = middle + 1;
      else high = middle;
    }
    if (this.#byteOffsets[low] === offset) return low;
    const precedingByte = this.#byteOffsets[Math.max(0, low - 1)] ?? 0;
    while (low > 1 && this.#byteOffsets[low - 2] === precedingByte) low -= 1;
    return Math.max(0, low - 1);
  }

  applyChange(fromUtf16: number, toUtf16: number, insertedText: string): TextEditDelta {
    this.#assertUtf16Offset(fromUtf16);
    this.#assertUtf16Offset(toUtf16);
    if (toUtf16 < fromUtf16) throw new RangeError("Edit end precedes edit start");

    const fromByte = this.utf16ToByte(fromUtf16);
    const toByte = this.utf16ToByte(toUtf16);
    const insertedOffsets = relativeByteOffsets(insertedText);
    const insertedBytes = insertedOffsets.at(-1) ?? 0;
    const byteDelta = insertedBytes - (toByte - fromByte);

    this.#text = `${this.#text.slice(0, fromUtf16)}${insertedText}${this.#text.slice(toUtf16)}`;
    this.#byteOffsets = [
      ...this.#byteOffsets.slice(0, fromUtf16 + 1),
      ...insertedOffsets.slice(1).map((offset) => fromByte + offset),
      ...this.#byteOffsets.slice(toUtf16 + 1).map((offset) => offset + byteDelta),
    ];

    return { fromUtf16, toUtf16, fromByte, toByte, insertedText };
  }

  replaceWith(nextText: string): TextEditDelta | null {
    if (nextText === this.#text) return null;
    let prefix = 0;
    const prefixLimit = Math.min(this.#text.length, nextText.length);
    while (prefix < prefixLimit && this.#text[prefix] === nextText[prefix]) prefix += 1;
    if (prefix > 0 && /[\uD800-\uDBFF]/.test(this.#text[prefix - 1] ?? "")) prefix -= 1;

    let oldSuffix = this.#text.length;
    let newSuffix = nextText.length;
    while (
      oldSuffix > prefix &&
      newSuffix > prefix &&
      this.#text[oldSuffix - 1] === nextText[newSuffix - 1]
    ) {
      oldSuffix -= 1;
      newSuffix -= 1;
    }
    if (oldSuffix < this.#text.length && /[\uDC00-\uDFFF]/.test(this.#text[oldSuffix] ?? "")) {
      oldSuffix += 1;
      newSuffix += 1;
    }

    return this.applyChange(prefix, oldSuffix, nextText.slice(prefix, newSuffix));
  }

  #assertUtf16Offset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.#text.length) {
      throw new RangeError(`UTF-16 offset out of range: ${offset}`);
    }
  }
}
