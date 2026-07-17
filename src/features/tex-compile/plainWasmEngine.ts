import initWasm, {
  CompilerSession,
  type HtmlFontInput,
  packageVersion,
  type ResourceRequest,
} from "@umber/umber-wasm/low-level";
import plainFormatUrl from "@umber/umber-wasm/plain.fmt?url";
import fontEncodings from "../../assets/fonts/encodings.json";
import cmbx10FontUrl from "../../assets/fonts/umber-cmbx10.woff2?url";
import cmcsc10FontUrl from "../../assets/fonts/umber-cmcsc10.woff2?url";
import cmex10FontUrl from "../../assets/fonts/umber-cmex10.woff2?url";
import cmmi5FontUrl from "../../assets/fonts/umber-cmmi5.woff2?url";
import cmmi7FontUrl from "../../assets/fonts/umber-cmmi7.woff2?url";
import cmmi10FontUrl from "../../assets/fonts/umber-cmmi10.woff2?url";
import cmr5FontUrl from "../../assets/fonts/umber-cmr5.woff2?url";
import cmr7FontUrl from "../../assets/fonts/umber-cmr7.woff2?url";
import cmr10FontUrl from "../../assets/fonts/umber-cmr10.woff2?url";
import cmsl10FontUrl from "../../assets/fonts/umber-cmsl10.woff2?url";
import cmss10FontUrl from "../../assets/fonts/umber-cmss10.woff2?url";
import cmsy5FontUrl from "../../assets/fonts/umber-cmsy5.woff2?url";
import cmsy7FontUrl from "../../assets/fonts/umber-cmsy7.woff2?url";
import cmsy10FontUrl from "../../assets/fonts/umber-cmsy10.woff2?url";
import cmti10FontUrl from "../../assets/fonts/umber-cmti10.woff2?url";
import cmtt10FontUrl from "../../assets/fonts/umber-cmtt10.woff2?url";
import cmbx10TfmUrl from "../../assets/tfm/cmbx10.tfm?url";
import cmcsc10TfmUrl from "../../assets/tfm/cmcsc10.tfm?url";
import cmr10TfmUrl from "../../assets/tfm/cmr10.tfm?url";
import cmsl10TfmUrl from "../../assets/tfm/cmsl10.tfm?url";
import cmss10TfmUrl from "../../assets/tfm/cmss10.tfm?url";
import cmti10TfmUrl from "../../assets/tfm/cmti10.tfm?url";
import cmtt10TfmUrl from "../../assets/tfm/cmtt10.tfm?url";
import {
  FontResourceRouter,
  type TfmResource,
  TfmResourceResolver,
  type Woff2OpenTypeFont,
  Woff2OpenTypeResolver,
} from "./fontResourceResolvers";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";
import type { IncrementalTexEngine } from "./wasmEngineAdapter";

const plainFontAssets = {
  cmbx10: {
    url: cmbx10FontUrl,
    tfmContentHash: "06aff5c4e3836465b7ccf9ca03e956f3445e21c705c99a10d084cfb38c63a450",
    sha256: "d08140bf2e7c5db22bec1c40ef967c1aa03e10a8447830663762407ceb5fd974",
    source: "cmu",
  },
  cmcsc10: {
    url: cmcsc10FontUrl,
    tfmContentHash: "582c4da9bc3fc34d63199758881686f9a779b651d73e4cb5aaced37eed818872",
    sha256: "4549208774204c8e57a75398d887d62739e5d2f88792dd1c38f815961f2bcae2",
    source: "cmu",
  },
  cmr10: {
    url: cmr10FontUrl,
    tfmContentHash: "b5aae7453493c924123050ddf8e85ab3395b46099e44f4fa6f39c55bb526b89e",
    sha256: "13279262f0c17ee798af7c581c1e4acd2c317e30000279c3985d8e343af977dd",
    source: "cmu",
  },
  cmr7: {
    url: cmr7FontUrl,
    tfmContentHash: "3b2be343f00c1b8bb50c817b6e8687009b8925c17f9156c333ebfcf09c620a8e",
    sha256: "417bc403521c2f174f7ee903e6e3657f8e12587f69fb5c62272ac4d8897e8b3a",
    source: "cmu",
  },
  cmr5: {
    url: cmr5FontUrl,
    tfmContentHash: "e863cad4a7654e909cd4b3cf7b9b9c40a3be72d2c14c3f533ad86e37811b1463",
    sha256: "c862527cd6b58a375edd4e6739f7bc537e9eb3c03565853fd051aa066b0f88a3",
    source: "cmu",
  },
  cmmi10: {
    url: cmmi10FontUrl,
    tfmContentHash: "e4cb492dd7cf8cf673a47439db3635bd4b257d74aee12d3a2c1d1407eab1d0d6",
    sha256: "a552d56d5c883f0b3d5120111cc279fa61204c7e0307cc03fea552e20060e851",
    source: "ams",
  },
  cmmi7: {
    url: cmmi7FontUrl,
    tfmContentHash: "eb08a7381c9f9d23035e6ae91d6252e34036595272f2cb1fd5bb8c8ac9902981",
    sha256: "2d5d778d9112cf3b88b1c3fbbbe2b3bd8f499eb3fab3f42317363888bec40cfb",
    source: "ams",
  },
  cmmi5: {
    url: cmmi5FontUrl,
    tfmContentHash: "bd5205eddec6aa8ea6adc314a7d0b4792d918075eccbff89e9c74a20fe93dbeb",
    sha256: "5b7c2914f9f005f9c416564ab9b3aa08cd2c53c96eee893e9a235f32e35b632e",
    source: "ams",
  },
  cmsy10: {
    url: cmsy10FontUrl,
    tfmContentHash: "585ad2f2bbd3e8471de6b1af83a8cabcc21cd874f545ca3da9a0e6afd4873a59",
    sha256: "66f14d36d5dffbee155be0578671c11ff995fe22a6fe0d8afbe02d12d8725b90",
    source: "ams",
  },
  cmsy7: {
    url: cmsy7FontUrl,
    tfmContentHash: "2b7d8a1dffcb2b1fd72270caf8ca7c013f89e389f710dd963394c9dbb3f26d43",
    sha256: "4609c1f12e55a75702b276e52936819d33a387ca6abd0cf6a2337ea42337b472",
    source: "ams",
  },
  cmsy5: {
    url: cmsy5FontUrl,
    tfmContentHash: "a67a6d62bcc83ec51ee918ebb4da69b8bdac229b502e28c812b54524828b0691",
    sha256: "6702b4829c5c50ffd554782adc4028c8db550365b2901f7ac0ed1eb7036668f9",
    source: "ams",
  },
  cmex10: {
    url: cmex10FontUrl,
    tfmContentHash: "5a970fbe0d95cf8f27aaf9a8a64a0b6f33d53719c512f0e4bcb1bbc93e1ca799",
    sha256: "6dc0d0a4e45f188b20b1ab5b07ea507849b8fad8369dc972805a519813d72006",
    source: "ams",
  },
  cmss10: {
    url: cmss10FontUrl,
    tfmContentHash: "e7dfd2d5819e1ee9f40ea4101caee6c7c72bbb174c7a43f7703d609a3ecd31ad",
    sha256: "030044d4f9231be9aff5f80f3cee86cad6abfdc749196d8b0a356a204a077d6e",
    source: "cmu",
  },
  cmsl10: {
    url: cmsl10FontUrl,
    tfmContentHash: "85590e7d62adfdb92a9bdb41423238b0291d86655af7ee79fa4c4bf03b24ab9e",
    sha256: "a415f06695f8e2a617ff525ab65cfac42d3c1fff39783e25dd58e6db0a9c4045",
    source: "cmu",
  },
  cmti10: {
    url: cmti10FontUrl,
    tfmContentHash: "4aef58b6c92d599d3106aaa3b5b6cb74c62870e88dab66cfc1449cd7968d3391",
    sha256: "0b8372cdad7af2ee15d0f38003e3de8e8894d4210ff124bab0a78d9fb8e41cdc",
    source: "cmu",
  },
  cmtt10: {
    url: cmtt10FontUrl,
    tfmContentHash: "a6046ee8cbd073ca93ca3f1d99c01beaf63e483d61bc9e5bfa103433340d4909",
    sha256: "247d2a8eeaf5f1481a43554c33e9907172571d474ee697bd9d3389f2707dd551",
    source: "cmu",
  },
} as const;

const plainFontProvenance = {
  cmu: "Computer Modern Unicode 0.7.0 converted under SIL OFL 1.1",
  ams: "AMS Computer Modern Type1 fonts converted under SIL OFL 1.1",
} as const;

const plainTfmAssetUrls = {
  "cmbx10.tfm": cmbx10TfmUrl,
  "cmcsc10.tfm": cmcsc10TfmUrl,
  "cmr10.tfm": cmr10TfmUrl,
  "cmss10.tfm": cmss10TfmUrl,
  "cmsl10.tfm": cmsl10TfmUrl,
  "cmti10.tfm": cmti10TfmUrl,
  "cmtt10.tfm": cmtt10TfmUrl,
} as const;

type LoadedPlainFont = {
  openType: Woff2OpenTypeFont;
  html: HtmlFontInput;
};

async function loadPlainFonts(): Promise<LoadedPlainFont[]> {
  return Promise.all(
    Object.entries(plainFontAssets).map(async ([name, asset]) => {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Plain ${name} font request failed: ${response.status}`);
      const woff2 = new Uint8Array(await response.arrayBuffer());
      const provenance = plainFontProvenance[asset.source];
      return {
        openType: {
          logicalName: name,
          woff2,
          objectSha256: asset.sha256,
          provenance,
        },
        html: {
          name,
          tfmContentHash: asset.tfmContentHash,
          woff2,
          sha256: asset.sha256,
          encoding: fontEncodings[name as keyof typeof fontEncodings],
          provenance,
          embeddable: true,
        },
      };
    }),
  );
}

async function loadPlainTfms(): Promise<TfmResource[]> {
  return Promise.all(
    Object.entries(plainTfmAssetUrls).map(async ([name, url]) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Plain ${name} request failed: ${response.status}`);
      return {
        name,
        virtualPath: `/texlive/fonts/tfm/${name}`,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    }),
  );
}

export async function createPlainWasmEngine(
  emit: (message: FromEngine) => void,
): Promise<IncrementalTexEngine> {
  await initWasm();
  const [formatResponse, fonts, tfms] = await Promise.all([
    fetch(plainFormatUrl),
    loadPlainFonts(),
    loadPlainTfms(),
  ]);
  if (!formatResponse.ok) throw new Error(`Plain format request failed: ${formatResponse.status}`);
  const format = new Uint8Array(await formatResponse.arrayBuffer());
  const htmlFonts = fonts.map((font) => font.html);
  const fontResources = new FontResourceRouter(
    new TfmResourceResolver(tfms),
    new Woff2OpenTypeResolver(fonts.map((font) => font.openType)),
  );
  let session: CompilerSession | undefined;
  let entry = "main.tex";
  let mainDocId = "main";
  let projectFiles: ProjectFile[] = [];
  let needsColdStart = false;
  let renderedSourceIdentity: { output: string; revision: number } | undefined;

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
    let result = session.advance();
    while (result.kind === "need-resources") {
      const { responses, missing } = fontResources.resolve(result.required);
      if (missing.length > 0) {
        const names = missing.map(resourceName).join(", ");
        diagnostic(epoch, `The quick Plain demo does not bundle resource: ${names}`);
        return false;
      }
      session.provideResources(responses);
      result = session.advance();
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
    renderedSourceIdentity = readRenderedSourceIdentity(html);
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
      if (message.t === "renderedSource") {
        const identity = renderedSourceIdentity;
        const result =
          session && identity
            ? session.renderedSourceLocation(
                message.page,
                message.event,
                message.unit,
                identity.output,
                identity.revision,
              )
            : undefined;
        const location =
          result?.kind === "current" && identity
            ? {
                revision: identity.revision,
                path: result.path,
                start: result.start,
                end: result.end,
                line: result.line,
                column: result.column,
              }
            : undefined;
        emit({ t: "renderedSource", requestId: message.requestId, location });
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

function readRenderedSourceIdentity(
  html: Uint8Array,
): { output: string; revision: number } | undefined {
  const text = new TextDecoder().decode(html);
  const output = /data-umber-output="([0-9a-f]{32})"/.exec(text)?.[1];
  const revisionText = /data-umber-revision="(\d+)"/.exec(text)?.[1];
  if (!output || !revisionText) return undefined;
  const revision = Number(revisionText);
  return Number.isSafeInteger(revision) && revision >= 1 ? { output, revision } : undefined;
}
