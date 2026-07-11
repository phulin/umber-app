import type { SourceSpan } from "../tex-compile/protocol";

type IntervalNode = {
  center: number;
  overlaps: SourceSpan[];
  left?: IntervalNode;
  right?: IntervalNode;
};

function buildTree(spans: SourceSpan[]): IntervalNode | undefined {
  if (spans.length === 0) return undefined;
  const points = spans.flatMap((span) => [span.byteStart, span.byteEnd]).sort((a, b) => a - b);
  const center = points[Math.floor(points.length / 2)] ?? 0;
  const left: SourceSpan[] = [];
  const right: SourceSpan[] = [];
  const overlaps: SourceSpan[] = [];
  for (const span of spans) {
    if (span.byteEnd < center) left.push(span);
    else if (span.byteStart > center) right.push(span);
    else overlaps.push(span);
  }
  return { center, overlaps, left: buildTree(left), right: buildTree(right) };
}

function queryTree(node: IntervalNode | undefined, offset: number, matches: SourceSpan[]): void {
  if (!node) return;
  for (const span of node.overlaps) {
    if (span.byteStart <= offset && offset <= span.byteEnd) matches.push(span);
  }
  if (offset < node.center) queryTree(node.left, offset, matches);
  if (offset > node.center) queryTree(node.right, offset, matches);
}

export class SpanIndex {
  readonly #byElement = new Map<string, SourceSpan>();
  readonly #byDocument = new Map<string, Map<string, SourceSpan>>();
  readonly #trees = new Map<string, IntervalNode | undefined>();
  #epoch = 0;

  get epoch(): number {
    return this.#epoch;
  }

  apply(epoch: number, spans: readonly SourceSpan[]): boolean {
    if (epoch < this.#epoch) return false;
    if (epoch > this.#epoch) {
      this.#byElement.clear();
      this.#byDocument.clear();
      this.#trees.clear();
      this.#epoch = epoch;
    }

    const touched = new Set<string>();
    for (const span of spans) {
      this.#byElement.set(span.elemId, span);
      let document = this.#byDocument.get(span.docId);
      if (!document) {
        document = new Map();
        this.#byDocument.set(span.docId, document);
      }
      document.set(span.elemId, span);
      touched.add(span.docId);
    }
    for (const docId of touched) {
      this.#trees.set(docId, buildTree([...(this.#byDocument.get(docId)?.values() ?? [])]));
    }
    return true;
  }

  byElement(elemId: string): SourceSpan | undefined {
    return this.#byElement.get(elemId);
  }

  innermost(docId: string, byteOffset: number): SourceSpan | undefined {
    const matches: SourceSpan[] = [];
    queryTree(this.#trees.get(docId), byteOffset, matches);
    return matches.sort((left, right) => {
      const leftLength = left.byteEnd - left.byteStart;
      const rightLength = right.byteEnd - right.byteStart;
      return leftLength - rightLength || right.byteStart - left.byteStart;
    })[0];
  }
}
