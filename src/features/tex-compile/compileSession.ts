import { type EngineTransport, listenToEngine } from "./engineTransport";
import {
  type Diagnostic,
  type EditMessage,
  type FromEngine,
  type ToEngine,
  transferablesFor,
} from "./protocol";

type SessionListener = (message: FromEngine) => void;

/**
 * Owns epoch ordering at the worker boundary. Rendering remains downstream; this class guarantees
 * that it never receives patches or diagnostics older than the latest accepted epoch.
 */
export class CompileSession {
  readonly #transport: EngineTransport;
  readonly #listeners = new Set<SessionListener>();
  readonly #stopListening: () => void;
  #editEpoch = 0;
  #latestAppliedEpoch = 0;

  constructor(transport: EngineTransport) {
    this.#transport = transport;
    this.#stopListening = listenToEngine(transport, (message) => this.#receive(message));
  }

  get editEpoch(): number {
    return this.#editEpoch;
  }

  get latestAppliedEpoch(): number {
    return this.#latestAppliedEpoch;
  }

  send(message: ToEngine): void {
    this.#transport.postMessage(message, transferablesFor(message));
  }

  edit(docId: string, fromByte: number, toByte: number, insertedText: string): number {
    const epoch = ++this.#editEpoch;
    this.editAtEpoch(epoch, docId, fromByte, toByte, insertedText);
    return epoch;
  }

  editAtEpoch(
    epoch: number,
    docId: string,
    fromByte: number,
    toByte: number,
    insertedText: string,
  ): void {
    if (!Number.isSafeInteger(epoch) || epoch <= 0)
      throw new RangeError(`Invalid edit epoch: ${epoch}`);
    this.#editEpoch = Math.max(this.#editEpoch, epoch);
    const cancel: ToEngine = { t: "cancel", beforeEpoch: epoch };
    const edit: EditMessage = {
      t: "edit",
      epoch,
      docId,
      fromByte,
      toByte,
      insert: new TextEncoder().encode(insertedText).buffer,
    };
    this.send(cancel);
    this.send(edit);
  }

  subscribe(listener: SessionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#stopListening();
    this.#listeners.clear();
    this.#transport.terminate();
  }

  #receive(message: FromEngine): void {
    if (message.t === "patch") {
      if (message.epoch < this.#latestAppliedEpoch) return;
      this.#latestAppliedEpoch = message.epoch;
    } else if (message.t === "diagnostics" || message.t === "pdf") {
      if (message.epoch < this.#latestAppliedEpoch) return;
    } else if (message.t === "progress" && message.epoch < this.#latestAppliedEpoch) {
      return;
    }

    for (const listener of this.#listeners) listener(message);
  }
}

export function diagnosticsFrom(message: FromEngine): Diagnostic[] {
  return message.t === "diagnostics" ? message.items : [];
}
