import initWasm, {
  CompilerSession,
  type HtmlFontInput,
  packageVersion,
  type ResourceRequest,
} from "@umber/umber-wasm/low-level";
import plainFormatUrl from "@umber/umber-wasm/plain.fmt?url";
import fontEncodings from "../../assets/fonts/encodings.json";
import cmex10FontUrl from "../../assets/fonts/umber-cmex10.woff2?url";
import cmmi5FontUrl from "../../assets/fonts/umber-cmmi5.woff2?url";
import cmmi7FontUrl from "../../assets/fonts/umber-cmmi7.woff2?url";
import cmmi10FontUrl from "../../assets/fonts/umber-cmmi10.woff2?url";
import cmr5FontUrl from "../../assets/fonts/umber-cmr5.woff2?url";
import cmr7FontUrl from "../../assets/fonts/umber-cmr7.woff2?url";
import cmr10FontUrl from "../../assets/fonts/umber-cmr10.woff2?url";
import cmsy5FontUrl from "../../assets/fonts/umber-cmsy5.woff2?url";
import cmsy7FontUrl from "../../assets/fonts/umber-cmsy7.woff2?url";
import cmsy10FontUrl from "../../assets/fonts/umber-cmsy10.woff2?url";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";
import type { IncrementalTexEngine } from "./wasmEngineAdapter";

const plainFontAssets = {
  cmr10: {
    url: cmr10FontUrl,
    tfmContentHash: "b5aae7453493c924123050ddf8e85ab3395b46099e44f4fa6f39c55bb526b89e",
    sha256: "0b9773b781bc686919dea8708a3c8960de03732d7a8c3fabd93b8b2fc7ba004e",
  },
  cmr7: {
    url: cmr7FontUrl,
    tfmContentHash: "3b2be343f00c1b8bb50c817b6e8687009b8925c17f9156c333ebfcf09c620a8e",
    sha256: "6e9d5eb5aae685d362607e48add0cba11899dfa7b3cf066664cccd396e71475f",
  },
  cmr5: {
    url: cmr5FontUrl,
    tfmContentHash: "e863cad4a7654e909cd4b3cf7b9b9c40a3be72d2c14c3f533ad86e37811b1463",
    sha256: "8f1f955020ca98457e9364365e16da0023dda39550d34f46b7c7868c3d58c4e6",
  },
  cmmi10: {
    url: cmmi10FontUrl,
    tfmContentHash: "e4cb492dd7cf8cf673a47439db3635bd4b257d74aee12d3a2c1d1407eab1d0d6",
    sha256: "758a5b65770f1b40a40ca7a51a3c5aa735d21bb814a4d24497849e0c6570e4e4",
  },
  cmmi7: {
    url: cmmi7FontUrl,
    tfmContentHash: "eb08a7381c9f9d23035e6ae91d6252e34036595272f2cb1fd5bb8c8ac9902981",
    sha256: "6a5c575b5902e915f897818777d211e28e2f47ea6b432f311c7614d4e1fc98f5",
  },
  cmmi5: {
    url: cmmi5FontUrl,
    tfmContentHash: "bd5205eddec6aa8ea6adc314a7d0b4792d918075eccbff89e9c74a20fe93dbeb",
    sha256: "51f9008a05c20bda3d3d4296ab2e3534466818215eb36f8ae3845cf703fb3445",
  },
  cmsy10: {
    url: cmsy10FontUrl,
    tfmContentHash: "585ad2f2bbd3e8471de6b1af83a8cabcc21cd874f545ca3da9a0e6afd4873a59",
    sha256: "f4063bb0111469e22519f0a5396183c26ed98d2e8722eca92a098f14688b1f5b",
  },
  cmsy7: {
    url: cmsy7FontUrl,
    tfmContentHash: "2b7d8a1dffcb2b1fd72270caf8ca7c013f89e389f710dd963394c9dbb3f26d43",
    sha256: "61db117f829d84528263a6bbdcb1c6955b2e443e448c54792fc6c117254c5222",
  },
  cmsy5: {
    url: cmsy5FontUrl,
    tfmContentHash: "a67a6d62bcc83ec51ee918ebb4da69b8bdac229b502e28c812b54524828b0691",
    sha256: "a02b63a902739e89ed102f4e9bbfe802e97ccb393d98d0feb5ffa0044dd08f96",
  },
  cmex10: {
    url: cmex10FontUrl,
    tfmContentHash: "5a970fbe0d95cf8f27aaf9a8a64a0b6f33d53719c512f0e4bcb1bbc93e1ca799",
    sha256: "3d5725384248283ddc39691028aac1d665e2bb13638c0207329a55f2e2bf6b9a",
  },
} as const;

async function loadPlainWebFonts(): Promise<HtmlFontInput[]> {
  return Promise.all(
    Object.entries(plainFontAssets).map(async ([name, asset]) => {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Plain ${name} font request failed: ${response.status}`);
      return {
        name,
        tfmContentHash: asset.tfmContentHash,
        woff2: new Uint8Array(await response.arrayBuffer()),
        sha256: asset.sha256,
        encoding: fontEncodings[name as keyof typeof fontEncodings],
        provenance: "AMS Computer Modern Type1 fonts converted under SIL OFL 1.1",
        embeddable: true,
      };
    }),
  );
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
      if (message.t === "renderedSource") {
        const location = session?.renderedSourceLocation(message.page, message.event, message.unit);
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
