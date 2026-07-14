import type { EditorDelta } from "../editor/CodeEditor";
import { Utf8OffsetMap } from "../editor/utf8OffsetMap";
import { CompileSession } from "./compileSession";
import type { EngineTransport } from "./engineTransport";
import type { FromEngine, ProjectFile, ToEngine } from "./protocol";

type OrchestratorListener = (message: FromEngine) => void;

type DocumentState = {
  engineText: string;
  localText: string;
  pendingEpoch?: number;
};

export class CompileOrchestrator {
  readonly #session: CompileSession;
  readonly #documents = new Map<string, DocumentState>();
  readonly #listeners = new Set<OrchestratorListener>();
  readonly #unsubscribe: () => void;
  #saturated = false;
  #editEpoch = 0;

  constructor(transport: EngineTransport) {
    this.#session = new CompileSession(transport);
    this.#unsubscribe = this.#session.subscribe((message) => this.#receive(message));
  }

  get editEpoch(): number {
    return this.#editEpoch;
  }

  get saturated(): boolean {
    return this.#saturated;
  }

  initialize(
    init: Extract<ToEngine, { t: "init" }>,
    project: { files: ProjectFile[]; entry: string; editableDocIds?: ReadonlySet<string> },
  ): void {
    const decoder = new TextDecoder();
    for (const file of project.files) {
      if (project.editableDocIds && !project.editableDocIds.has(file.docId)) continue;
      const text = decoder.decode(file.bytes);
      this.#documents.set(file.docId, { engineText: text, localText: text });
    }
    const retainedFiles = project.files.map((file) => ({ ...file, bytes: file.bytes.slice(0) }));
    this.#session.send(init);
    this.#session.send({ t: "openProject", entry: project.entry, files: retainedFiles });
  }

  submitEdit(delta: EditorDelta): void {
    const epoch = ++this.#editEpoch;
    const document = this.#documents.get(delta.docId);
    if (!document) throw new Error(`Unknown document: ${delta.docId}`);
    const localOffsets = new Utf8OffsetMap(document.localText);
    const fromUtf16 = localOffsets.byteToUtf16(delta.fromByte);
    const toUtf16 = localOffsets.byteToUtf16(delta.toByte);
    localOffsets.applyChange(fromUtf16, toUtf16, delta.insertedText);
    document.localText = localOffsets.text;

    if (this.#saturated) {
      document.pendingEpoch = epoch;
      return;
    }
    this.#saturated = true;
    this.#session.editAtEpoch(epoch, delta.docId, delta.fromByte, delta.toByte, delta.insertedText);
    document.engineText = document.localText;
  }

  subscribe(listener: OrchestratorListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#unsubscribe();
    this.#listeners.clear();
    this.#session.dispose();
  }

  #receive(message: FromEngine): void {
    if (message.t === "saturated") this.#saturated = true;
    if (message.t === "progress" && message.phase === "idle") {
      this.#saturated = false;
      this.#flushPending();
    }
    if (
      (message.t === "diagnostics" || message.t === "progress" || message.t === "pdf") &&
      message.epoch < this.#editEpoch
    ) {
      return;
    }
    for (const listener of this.#listeners) listener(message);
  }

  #flushPending(): void {
    const pending = [...this.#documents.entries()]
      .filter(([, document]) => document.pendingEpoch !== undefined)
      .sort((left, right) => (left[1].pendingEpoch ?? 0) - (right[1].pendingEpoch ?? 0));
    for (const [docId, document] of pending) {
      if (document.engineText === document.localText) {
        document.pendingEpoch = undefined;
        continue;
      }
      const offsets = new Utf8OffsetMap(document.engineText);
      const delta = offsets.replaceWith(document.localText);
      if (!delta) continue;
      this.#session.editAtEpoch(
        document.pendingEpoch ?? this.#editEpoch,
        docId,
        delta.fromByte,
        delta.toByte,
        delta.insertedText,
      );
      this.#saturated = true;
      document.engineText = document.localText;
      document.pendingEpoch = undefined;
    }
  }
}
