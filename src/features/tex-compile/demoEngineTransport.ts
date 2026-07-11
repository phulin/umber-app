import { type FakeEngineHandler, FakeEngineTransport } from "./engineTransport";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const replaceBytes = (
  current: ArrayBuffer,
  fromByte: number,
  toByte: number,
  insert: ArrayBuffer,
): ArrayBuffer => {
  const source = new Uint8Array(current);
  const inserted = new Uint8Array(insert);
  const next = new Uint8Array(fromByte + inserted.byteLength + source.byteLength - toByte);
  next.set(source.subarray(0, fromByte));
  next.set(inserted, fromByte);
  next.set(source.subarray(toByte), fromByte + inserted.byteLength);
  return next.buffer;
};

const bodySpan = (source: string) => {
  const match = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(source);
  if (!match || match.index === undefined) {
    return { text: source, utf16Start: 0, utf16End: source.length };
  }
  const raw = match[1] ?? "";
  const leading = raw.length - raw.trimStart().length;
  const text = raw.trim();
  const utf16Start = match.index + match[0].indexOf(raw) + leading;
  return { text, utf16Start, utf16End: utf16Start + text.length };
};

const cloneFile = (file: ProjectFile): ProjectFile => ({ ...file, bytes: file.bytes.slice(0) });

export function createDemoEngineTransport(): FakeEngineTransport {
  const files = new Map<string, ProjectFile>();
  let entry = "main.tex";
  let cancelBeforeEpoch = 0;

  const compile = (epoch: number): FromEngine[] => {
    const main =
      [...files.values()].find((file) => file.path === entry) ?? files.values().next().value;
    if (!main) return [{ t: "fatal", message: "Demo project has no entry file" }];
    const source = decoder.decode(main.bytes);
    const body = bodySpan(source);
    const byteStart = encoder.encode(source.slice(0, body.utf16Start)).byteLength;
    const byteEnd = encoder.encode(source.slice(0, body.utf16End)).byteLength;
    return [
      { t: "progress", epoch, phase: "typesetting" },
      {
        t: "patch",
        epoch,
        pages: [{ pageId: "page-1", widthPt: 612, heightPt: 792, index: 0 }],
        removePages: [],
        blocks: [
          {
            pageId: "page-1",
            blockId: "paragraph-1",
            html: encoder.encode(`<p id="span-1">${escapeHtml(body.text)}</p>`).buffer,
          },
        ],
        removeBlocks: [],
        spans: [{ elemId: "span-1", docId: main.docId, byteStart, byteEnd }],
        final: true,
      },
      {
        t: "diagnostics",
        epoch,
        items: [
          {
            severity: "warning",
            docId: main.docId,
            byteStart,
            byteEnd,
            message: "Fake engine source-span check",
          },
        ],
      },
      { t: "progress", epoch, phase: "idle" },
    ];
  };

  const handler: FakeEngineHandler = (message: ToEngine) => {
    switch (message.t) {
      case "init":
        return [{ t: "ready", engineVersion: "fake-interactive-1.0.0" }];
      case "openProject":
        files.clear();
        for (const file of message.files) files.set(file.docId, cloneFile(file));
        entry = message.entry;
        return compile(0);
      case "cancel":
        cancelBeforeEpoch = Math.max(cancelBeforeEpoch, message.beforeEpoch);
        return [];
      case "edit": {
        if (message.epoch < cancelBeforeEpoch) return [];
        const file = files.get(message.docId);
        if (!file || message.fromByte > message.toByte || message.toByte > file.bytes.byteLength) {
          return [{ t: "fatal", message: `Invalid demo edit for ${message.docId}` }];
        }
        file.bytes = replaceBytes(file.bytes, message.fromByte, message.toByte, message.insert);
        return compile(message.epoch);
      }
      case "fileAdd":
        files.set(message.docId, {
          docId: message.docId,
          path: message.path,
          bytes: message.bytes.slice(0),
        });
        return [];
      case "fileRemove":
        files.delete(message.docId);
        return [];
      case "exportPdf":
        return [];
    }
  };
  return new FakeEngineTransport([], handler);
}
