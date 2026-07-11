export type EngineOptions = Record<string, unknown>;

export type ProjectFile = {
  docId: string;
  path: string;
  bytes: ArrayBuffer;
};

export type EditMessage = {
  t: "edit";
  epoch: number;
  docId: string;
  fromByte: number;
  toByte: number;
  insert: ArrayBuffer;
};

export type ToEngine =
  | { t: "init"; bundleDigest: string; engineOpts: EngineOptions }
  | { t: "openProject"; files: ProjectFile[]; entry: string }
  | EditMessage
  | { t: "cancel"; beforeEpoch: number }
  | { t: "fileAdd"; docId: string; path: string; bytes: ArrayBuffer }
  | { t: "fileRemove"; docId: string }
  | { t: "exportPdf"; epoch: number };

export type CompilePhase = "expanding" | "typesetting" | "fetching" | "idle";

export type PagePatch = {
  pageId: string;
  widthPt: number;
  heightPt: number;
  index: number;
};

export type BlockPatch = {
  pageId: string;
  blockId: string;
  html: ArrayBuffer;
};

export type BlockRemoval = {
  pageId: string;
  blockId: string;
};

export type SourceSpan = {
  elemId: string;
  docId: string;
  byteStart: number;
  byteEnd: number;
};

export type Diagnostic = {
  severity: "error" | "warning";
  docId: string;
  byteStart: number;
  byteEnd: number;
  message: string;
};

export type FromEngine =
  | { t: "ready"; engineVersion: string }
  | { t: "progress"; epoch: number; phase: CompilePhase; detail?: string }
  | { t: "saturated"; queuedDeltas: number }
  | {
      t: "fontsNeeded";
      fonts: { family: string; styleKey?: string; fileHash: string }[];
    }
  | {
      t: "patch";
      epoch: number;
      pages: PagePatch[];
      removePages: string[];
      blocks: BlockPatch[];
      removeBlocks: BlockRemoval[];
      spans: SourceSpan[];
      final: boolean;
    }
  | { t: "diagnostics"; epoch: number; items: Diagnostic[] }
  | { t: "pdf"; epoch: number; bytes: ArrayBuffer }
  | { t: "fatal"; message: string };

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNonNegativeInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value) && value >= 0;
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";

function isPagePatch(value: unknown): value is PagePatch {
  return (
    isRecord(value) &&
    isString(value.pageId) &&
    isNumber(value.widthPt) &&
    value.widthPt > 0 &&
    isNumber(value.heightPt) &&
    value.heightPt > 0 &&
    isNonNegativeInteger(value.index)
  );
}

function isBlockPatch(value: unknown): value is BlockPatch {
  return (
    isRecord(value) &&
    isString(value.pageId) &&
    isString(value.blockId) &&
    isArrayBuffer(value.html)
  );
}

function isBlockRemoval(value: unknown): value is BlockRemoval {
  return isRecord(value) && isString(value.pageId) && isString(value.blockId);
}

function isSourceSpan(value: unknown): value is SourceSpan {
  return (
    isRecord(value) &&
    isString(value.elemId) &&
    isString(value.docId) &&
    isNonNegativeInteger(value.byteStart) &&
    isNonNegativeInteger(value.byteEnd) &&
    value.byteEnd >= value.byteStart
  );
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return (
    isRecord(value) &&
    (value.severity === "error" || value.severity === "warning") &&
    isString(value.docId) &&
    isNonNegativeInteger(value.byteStart) &&
    isNonNegativeInteger(value.byteEnd) &&
    value.byteEnd >= value.byteStart &&
    isString(value.message)
  );
}

function isFont(value: unknown) {
  return (
    isRecord(value) &&
    isString(value.family) &&
    isString(value.fileHash) &&
    (value.styleKey === undefined || isString(value.styleKey))
  );
}

const compilePhases: readonly CompilePhase[] = ["expanding", "typesetting", "fetching", "idle"];

/**
 * Runtime boundary for worker messages. Unknown message types deliberately return null so
 * newer engines remain forward-compatible with older clients.
 */
export function decodeFromEngine(value: unknown): FromEngine | null {
  if (!isRecord(value) || !isString(value.t)) return null;

  switch (value.t) {
    case "ready":
      return isString(value.engineVersion) ? (value as FromEngine) : null;
    case "progress":
      return isNonNegativeInteger(value.epoch) &&
        isString(value.phase) &&
        compilePhases.includes(value.phase as CompilePhase) &&
        (value.detail === undefined || isString(value.detail))
        ? (value as FromEngine)
        : null;
    case "saturated":
      return isNonNegativeInteger(value.queuedDeltas) ? (value as FromEngine) : null;
    case "fontsNeeded":
      return Array.isArray(value.fonts) && value.fonts.every(isFont) ? (value as FromEngine) : null;
    case "patch":
      return isNonNegativeInteger(value.epoch) &&
        Array.isArray(value.pages) &&
        value.pages.every(isPagePatch) &&
        isStringArray(value.removePages) &&
        Array.isArray(value.blocks) &&
        value.blocks.every(isBlockPatch) &&
        Array.isArray(value.removeBlocks) &&
        value.removeBlocks.every(isBlockRemoval) &&
        Array.isArray(value.spans) &&
        value.spans.every(isSourceSpan) &&
        typeof value.final === "boolean"
        ? (value as FromEngine)
        : null;
    case "diagnostics":
      return isNonNegativeInteger(value.epoch) &&
        Array.isArray(value.items) &&
        value.items.every(isDiagnostic)
        ? (value as FromEngine)
        : null;
    case "pdf":
      return isNonNegativeInteger(value.epoch) && isArrayBuffer(value.bytes)
        ? (value as FromEngine)
        : null;
    case "fatal":
      return isString(value.message) ? (value as FromEngine) : null;
    default:
      return null;
  }
}

export function transferablesFor(message: ToEngine | FromEngine): Transferable[] {
  switch (message.t) {
    case "openProject":
      return message.files.map((file) => file.bytes);
    case "edit":
      return [message.insert];
    case "fileAdd":
      return [message.bytes];
    case "patch":
      return message.blocks.map((block) => block.html);
    case "pdf":
      return [message.bytes];
    default:
      return [];
  }
}
