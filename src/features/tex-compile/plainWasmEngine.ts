import { loadComputerModernTextFont } from "@umber/umber-wasm/cm-fonts";
import initWasm, {
  CompilerSession,
  packageVersion,
  type ResourceRequest,
} from "@umber/umber-wasm/low-level";
import plainFormatUrl from "@umber/umber-wasm/plain.fmt?url";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";
import type { IncrementalTexEngine } from "./wasmEngineAdapter";

const cmr10TfmContentHash = "b5aae7453493c924123050ddf8e85ab3395b46099e44f4fa6f39c55bb526b89e";

export async function createPlainWasmEngine(
  emit: (message: FromEngine) => void,
): Promise<IncrementalTexEngine> {
  await initWasm();
  const [formatResponse, font] = await Promise.all([
    fetch(plainFormatUrl),
    loadComputerModernTextFont("cmr10", cmr10TfmContentHash),
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
    session.addHtmlFont(font);
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
