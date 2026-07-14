import initWasm, {
  CompilerSession,
  type HtmlFontInput,
  packageVersion,
  type ResourceRequest,
} from "@umber/umber-wasm/low-level";
import plainFormatUrl from "@umber/umber-wasm/plain.fmt?url";
import mainFontUrl from "katex/dist/fonts/KaTeX_Main-Regular.woff2?url";
import mathItalicFontUrl from "katex/dist/fonts/KaTeX_Math-Italic.woff2?url";
import sizeFontUrl from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?url";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";
import type { IncrementalTexEngine } from "./wasmEngineAdapter";

const plainFontIdentities = {
  cmr10: "b5aae7453493c924123050ddf8e85ab3395b46099e44f4fa6f39c55bb526b89e",
  cmr7: "3b2be343f00c1b8bb50c817b6e8687009b8925c17f9156c333ebfcf09c620a8e",
  cmr5: "e863cad4a7654e909cd4b3cf7b9b9c40a3be72d2c14c3f533ad86e37811b1463",
  cmmi10: "e4cb492dd7cf8cf673a47439db3635bd4b257d74aee12d3a2c1d1407eab1d0d6",
  cmmi7: "eb08a7381c9f9d23035e6ae91d6252e34036595272f2cb1fd5bb8c8ac9902981",
  cmmi5: "bd5205eddec6aa8ea6adc314a7d0b4792d918075eccbff89e9c74a20fe93dbeb",
  cmsy10: "585ad2f2bbd3e8471de6b1af83a8cabcc21cd874f545ca3da9a0e6afd4873a59",
  cmsy7: "2b7d8a1dffcb2b1fd72270caf8ca7c013f89e389f710dd963394c9dbb3f26d43",
  cmsy5: "a67a6d62bcc83ec51ee918ebb4da69b8bdac229b502e28c812b54524828b0691",
  cmex10: "5a970fbe0d95cf8f27aaf9a8a64a0b6f33d53719c512f0e4bcb1bbc93e1ca799",
} as const;

const makeEncoding = (characters: Record<number, string>): Array<string | null> =>
  Object.assign(Array<string | null>(256).fill(null), characters);

const asciiEncoding = () => {
  const characters: Record<number, string> = {};
  for (let code = 32; code <= 126; code += 1) characters[code] = String.fromCodePoint(code);
  delete characters[96];
  return makeEncoding(characters);
};

const alphabet = (firstCode: number, firstCharacter: number) =>
  Object.fromEntries(
    Array.from({ length: 26 }, (_, index) => [
      firstCode + index,
      String.fromCodePoint(firstCharacter + index),
    ]),
  );

const mathItalicEncoding = () =>
  makeEncoding({
    0: "Γ",
    1: "Δ",
    2: "Θ",
    3: "Λ",
    4: "Ξ",
    5: "Π",
    6: "Σ",
    7: "Υ",
    8: "Φ",
    9: "Ψ",
    10: "Ω",
    11: "α",
    12: "β",
    13: "γ",
    14: "δ",
    15: "ε",
    16: "ζ",
    17: "η",
    18: "θ",
    19: "ι",
    20: "κ",
    21: "λ",
    22: "μ",
    23: "ν",
    24: "ξ",
    25: "π",
    26: "ρ",
    27: "σ",
    28: "τ",
    29: "υ",
    30: "φ",
    31: "χ",
    32: "ψ",
    33: "ω",
    58: " ",
    59: " ",
    60: " ",
    61: " ",
    62: " ",
    63: " ",
    64: "\ue131",
    ...alphabet(65, 65),
    96: "\ue237",
    ...alphabet(97, 97),
  });

const mathSymbolEncoding = () =>
  makeEncoding({
    0: "−",
    1: "⋅",
    2: "×",
    3: "∗",
    4: "÷",
    5: "⋄",
    6: "±",
    7: "∓",
    8: "⊕",
    9: "⊖",
    10: "⊗",
    11: "⊘",
    12: "⊙",
    16: "≍",
    17: "≡",
    20: "≤",
    21: "≥",
    24: "∼",
    28: "≪",
    29: "≫",
    32: "←",
    33: "→",
    34: "↑",
    35: "↓",
    36: "↔",
    40: "≃",
    41: "⇐",
    42: "⇒",
    43: "⇑",
    44: "⇓",
    45: "⇔",
    47: "∝",
    48: "′",
    49: "∞",
    50: "∈",
    51: "∋",
    56: "∀",
    57: "∃",
    58: "¬",
    59: "∅",
    63: "⊥",
    91: "∪",
    92: "∩",
    94: "∧",
    95: "∨",
    106: "∖",
    112: "√",
    114: "∇",
    115: "∫",
  });

const mathExtensionEncoding = () =>
  makeEncoding({
    0: "(",
    1: ")",
    2: "[",
    3: "]",
    4: "⌊",
    5: "⌋",
    6: "⌈",
    7: "⌉",
    8: "{",
    9: "}",
    10: "⟨",
    11: "⟩",
    68: "∮",
    76: "∑",
    77: "∏",
    78: "∫",
    81: "⋃",
    82: "⋀",
    83: "⋁",
    84: "∑",
    85: "∏",
    86: "∫",
    87: "⋃",
    88: "∑",
    89: "⋃",
    90: "⋀",
    91: "⋁",
    92: "∐",
    93: "∐",
  });

const webFontAssets = {
  roman: {
    url: mainFontUrl,
    sha256: "c2342cd8b869e01752a9321dc17213fc40d4d04c79688c1d43f2cf316abd7866",
  },
  mathItalic: {
    url: mathItalicFontUrl,
    sha256: "7af58c5ec8f132a2ddde9027c6d7814decce4d3b822a11192a42a20e2e973264",
  },
  mathSymbol: {
    url: mainFontUrl,
    sha256: "c2342cd8b869e01752a9321dc17213fc40d4d04c79688c1d43f2cf316abd7866",
  },
  mathExtension: {
    url: sizeFontUrl,
    sha256: "d04c54219f9eaec6d4d4fd42dfb28785975a4794d6b2fc71e566b9cd6db842dd",
  },
} as const;

type WebFontRole = keyof typeof webFontAssets;

const roleForFont = (name: string): WebFontRole => {
  if (name.startsWith("cmmi")) return "mathItalic";
  if (name.startsWith("cmsy")) return "mathSymbol";
  if (name === "cmex10") return "mathExtension";
  return "roman";
};

const encodingForRole = (role: WebFontRole): Array<string | null> => {
  if (role === "mathItalic") return mathItalicEncoding();
  if (role === "mathSymbol") return mathSymbolEncoding();
  if (role === "mathExtension") return mathExtensionEncoding();
  return asciiEncoding();
};

async function loadPlainWebFonts(): Promise<HtmlFontInput[]> {
  const loaded = new Map<WebFontRole, Uint8Array>();
  await Promise.all(
    Object.entries(webFontAssets).map(async ([role, asset]) => {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Plain ${role} font request failed: ${response.status}`);
      loaded.set(role as WebFontRole, new Uint8Array(await response.arrayBuffer()));
    }),
  );
  return Object.entries(plainFontIdentities).map(([name, tfmContentHash]) => {
    const role = roleForFont(name);
    const woff2 = loaded.get(role);
    if (!woff2) throw new Error(`Plain ${role} font was not loaded`);
    return {
      name,
      tfmContentHash,
      woff2,
      sha256: webFontAssets[role].sha256,
      encoding: encodingForRole(role),
      provenance: "KaTeX 0.17.0 fonts, SIL Open Font License 1.1",
      embeddable: true,
    };
  });
}

export async function createPlainWasmEngine(
  emit: (message: FromEngine) => void,
): Promise<IncrementalTexEngine> {
  await initWasm();
  const [formatResponse, htmlFonts] = await Promise.all([
    fetch(plainFormatUrl),
    loadPlainWebFonts(),
  ]);
  if (!formatResponse.ok) throw new Error(`Plain format request failed: ${formatResponse.status}`);
  const format = new Uint8Array(await formatResponse.arrayBuffer());
  let session: CompilerSession | undefined;
  let entry = "main.tex";
  let mainDocId = "main";
  let projectFiles: ProjectFile[] = [];
  let needsColdStart = false;

  const diagnostic = (epoch: number, message: string) => {
    emit({
      t: "diagnostics",
      epoch,
      items: [{ severity: "error", docId: mainDocId, byteStart: 0, byteEnd: 0, message }],
    });
    emit({ t: "progress", epoch, phase: "idle" });
  };

  const advance = (epoch: number): boolean => {
    if (!session) return false;
    emit({ t: "progress", epoch, phase: "typesetting" });
    const result = session.advance();
    if (result.kind === "need-resources") {
      const names = result.required.map(resourceName).join(", ");
      diagnostic(epoch, `The quick Plain demo does not bundle resource: ${names}`);
      return false;
    }
    if (result.kind === "error") {
      diagnostic(epoch, result.diagnostic.message);
      return false;
    }
    const html = result.output.html;
    if (!html) {
      diagnostic(epoch, "Umber returned no HTML preview");
      return false;
    }
    const bytes = html.slice().buffer;
    emit({ t: "diagnostics", epoch, items: [] });
    emit({ t: "document", epoch, html: bytes });
    emit({ t: "progress", epoch, phase: "idle" });
    return true;
  };

  const createSession = () => {
    session?.dispose();
    session = new CompilerSession({
      mainPath: entry,
      format,
      html: { fonts: [] },
    });
    for (const font of htmlFonts) session.addHtmlFont(font);
    for (const file of projectFiles) session.addUserFile(file.path, new Uint8Array(file.bytes));
  };

  const open = (files: ProjectFile[], nextEntry: string) => {
    entry = nextEntry;
    mainDocId = files.find((file) => file.path === entry)?.docId ?? files[0]?.docId ?? "main";
    projectFiles = files.map((file) => ({ ...file, bytes: file.bytes.slice(0) }));
    createSession();
    needsColdStart = !advance(0);
  };

  const updateMainSource = (fromByte: number, toByte: number, insert: ArrayBuffer) => {
    const file = projectFiles.find(({ docId }) => docId === mainDocId);
    if (!file) throw new Error("The main TeX source is missing");
    const current = new Uint8Array(file.bytes);
    if (fromByte > toByte || toByte > current.byteLength) {
      throw new RangeError(`Invalid source edit: ${fromByte}..${toByte}`);
    }
    const replacement = new Uint8Array(insert);
    const next = new Uint8Array(fromByte + replacement.byteLength + current.byteLength - toByte);
    next.set(current.subarray(0, fromByte));
    next.set(replacement, fromByte);
    next.set(current.subarray(toByte), fromByte + replacement.byteLength);
    file.bytes = next.buffer;
  };

  emit({ t: "ready", engineVersion: packageVersion() });
  return {
    handle(message: ToEngine) {
      if (message.t === "init" || message.t === "cancel") return;
      if (message.t === "openProject") {
        open(message.files, message.entry);
        return;
      }
      if (message.t === "edit") {
        if (!session || message.docId !== mainDocId) {
          diagnostic(message.epoch, "This quick demo only edits the main TeX file");
          return;
        }
        emit({ t: "saturated", queuedDeltas: 0 });
        const revision = session.revision;
        const expectedHash = session.contentHash;
        updateMainSource(message.fromByte, message.toByte, message.insert);
        if (needsColdStart || revision === undefined || expectedHash === undefined) {
          createSession();
        } else {
          try {
            session.applyPatch({
              nextRevision: revision + 1,
              baseRevision: revision,
              expectedHash,
              start: message.fromByte,
              end: message.toByte,
              replacement: new TextDecoder().decode(message.insert),
            });
          } catch {
            createSession();
          }
        }
        needsColdStart = !advance(message.epoch);
      }
    },
    dispose() {
      session?.dispose();
      session = undefined;
    },
  };
}

function resourceName(request: ResourceRequest): string {
  return request.type === "font" ? request.logicalName : request.name;
}
