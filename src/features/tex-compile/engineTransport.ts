import { decodeFromEngine, type FromEngine, type ToEngine } from "./protocol";

export type EngineMessageEvent = { data: unknown };
export type EngineMessageListener = (event: EngineMessageEvent) => void;
export type EngineErrorEvent = { message: string; error?: unknown };
export type EngineErrorListener = (event: EngineErrorEvent) => void;

export interface EngineTransport {
  postMessage(message: ToEngine, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: EngineMessageListener): void;
  removeEventListener(type: "message", listener: EngineMessageListener): void;
  addErrorListener(listener: EngineErrorListener): void;
  removeErrorListener(listener: EngineErrorListener): void;
  terminate(): void;
}

export type FakeEngineStep = {
  afterMessage?: ToEngine["t"];
  emit: unknown;
};

/** Test/demo transport that replays recorded engine messages through the real decode boundary. */
export class FakeEngineTransport implements EngineTransport {
  readonly received: ToEngine[] = [];
  readonly #listeners = new Set<EngineMessageListener>();
  readonly #errorListeners = new Set<EngineErrorListener>();
  readonly #steps: FakeEngineStep[];
  #terminated = false;

  constructor(steps: FakeEngineStep[] = []) {
    this.#steps = [...steps];
  }

  postMessage(message: ToEngine): void {
    if (this.#terminated) return;
    this.received.push(message);

    const ready = this.#steps.filter(
      (step) => step.afterMessage === undefined || step.afterMessage === message.t,
    );
    for (const step of ready) this.#steps.splice(this.#steps.indexOf(step), 1);

    if (ready.length > 0) {
      queueMicrotask(() => {
        for (const step of ready) this.emit(step.emit);
      });
    }
  }

  addEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.delete(listener);
  }

  addErrorListener(listener: EngineErrorListener): void {
    this.#errorListeners.add(listener);
  }

  removeErrorListener(listener: EngineErrorListener): void {
    this.#errorListeners.delete(listener);
  }

  terminate(): void {
    this.#terminated = true;
    this.#listeners.clear();
    this.#errorListeners.clear();
  }

  emit(message: unknown): void {
    if (this.#terminated) return;
    for (const listener of this.#listeners) listener({ data: message });
  }

  emitError(error: unknown): void {
    if (this.#terminated) return;
    const message = error instanceof Error ? error.message : String(error);
    for (const listener of this.#errorListeners) listener({ message, error });
  }
}

export class WorkerEngineTransport implements EngineTransport {
  readonly #worker: Worker;
  readonly #listenerMap = new Map<EngineMessageListener, EventListener>();
  readonly #errorListenerMap = new Map<EngineErrorListener, EventListener>();

  constructor(worker: Worker) {
    this.#worker = worker;
  }

  postMessage(message: ToEngine, transfer: Transferable[] = []): void {
    this.#worker.postMessage(message, transfer);
  }

  addEventListener(_type: "message", listener: EngineMessageListener): void {
    const wrapped: EventListener = (event) => listener(event as MessageEvent<unknown>);
    this.#listenerMap.set(listener, wrapped);
    this.#worker.addEventListener("message", wrapped);
  }

  removeEventListener(_type: "message", listener: EngineMessageListener): void {
    const wrapped = this.#listenerMap.get(listener);
    if (wrapped) this.#worker.removeEventListener("message", wrapped);
    this.#listenerMap.delete(listener);
  }

  addErrorListener(listener: EngineErrorListener): void {
    const wrapped: EventListener = (event) => {
      const errorEvent = event as ErrorEvent;
      listener({ message: errorEvent.message || "Engine worker crashed", error: errorEvent.error });
    };
    this.#errorListenerMap.set(listener, wrapped);
    this.#worker.addEventListener("error", wrapped);
  }

  removeErrorListener(listener: EngineErrorListener): void {
    const wrapped = this.#errorListenerMap.get(listener);
    if (wrapped) this.#worker.removeEventListener("error", wrapped);
    this.#errorListenerMap.delete(listener);
  }

  terminate(): void {
    this.#worker.terminate();
    this.#listenerMap.clear();
    this.#errorListenerMap.clear();
  }
}

export function createWasmWorkerTransport(): WorkerEngineTransport {
  return new WorkerEngineTransport(
    new Worker(new URL("../../workers/engine.worker.ts", import.meta.url), { type: "module" }),
  );
}

const cloneMessage = (message: ToEngine): ToEngine => {
  if (message.t === "openProject") {
    return {
      ...message,
      files: message.files.map((file) => ({ ...file, bytes: file.bytes.slice(0) })),
    };
  }
  return message;
};

const applyProjectMessage = (
  project: Extract<ToEngine, { t: "openProject" }>,
  message: ToEngine,
): void => {
  if (message.t === "edit") {
    const file = project.files.find(({ docId }) => docId === message.docId);
    if (!file) return;
    const current = new Uint8Array(file.bytes);
    const insert = new Uint8Array(message.insert);
    if (message.fromByte > message.toByte || message.toByte > current.byteLength) return;
    const next = new Uint8Array(
      message.fromByte + insert.byteLength + current.byteLength - message.toByte,
    );
    next.set(current.subarray(0, message.fromByte));
    next.set(insert, message.fromByte);
    next.set(current.subarray(message.toByte), message.fromByte + insert.byteLength);
    file.bytes = next.buffer;
  }
  if (message.t === "fileAdd") {
    const file = {
      docId: message.docId,
      path: message.path,
      bytes: message.bytes.slice(0),
    };
    const index = project.files.findIndex(({ docId }) => docId === message.docId);
    if (index >= 0) project.files[index] = file;
    else project.files.push(file);
  }
  if (message.t === "fileRemove") {
    project.files = project.files.filter(({ docId }) => docId !== message.docId);
  }
};

/** Restarts a failed worker and replays the session bootstrap without retaining detached buffers. */
export class RestartableEngineTransport implements EngineTransport {
  readonly #factory: () => EngineTransport;
  readonly #listeners = new Set<EngineMessageListener>();
  readonly #errorListeners = new Set<EngineErrorListener>();
  #transport: EngineTransport;
  #init?: Extract<ToEngine, { t: "init" }>;
  #project?: Extract<ToEngine, { t: "openProject" }>;
  #terminated = false;
  #restartCount = 0;

  constructor(factory: () => EngineTransport) {
    this.#factory = factory;
    this.#transport = factory();
    this.#transport.addEventListener("message", this.#forward);
    this.#transport.addErrorListener(this.#forwardError);
  }

  get restartCount(): number {
    return this.#restartCount;
  }

  postMessage(message: ToEngine, transfer: Transferable[] = []): void {
    if (this.#terminated) return;
    if (message.t === "init") this.#init = cloneMessage(message) as typeof message;
    if (message.t === "openProject") this.#project = cloneMessage(message) as typeof message;
    else if (this.#project) applyProjectMessage(this.#project, message);
    this.#transport.postMessage(message, transfer);
  }

  addEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.delete(listener);
  }

  addErrorListener(listener: EngineErrorListener): void {
    this.#errorListeners.add(listener);
  }

  removeErrorListener(listener: EngineErrorListener): void {
    this.#errorListeners.delete(listener);
  }

  terminate(): void {
    this.#terminated = true;
    this.#transport.removeEventListener("message", this.#forward);
    this.#transport.removeErrorListener(this.#forwardError);
    this.#transport.terminate();
    this.#listeners.clear();
    this.#errorListeners.clear();
  }

  readonly #forward: EngineMessageListener = (event) => {
    for (const listener of this.#listeners) listener(event);
    const message = decodeFromEngine(event.data);
    if (message?.t === "fatal") this.#restart();
  };

  readonly #forwardError: EngineErrorListener = (event) => {
    for (const listener of this.#errorListeners) listener(event);
    const fatal = { t: "fatal", message: event.message } satisfies FromEngine;
    for (const listener of this.#listeners) listener({ data: fatal });
    this.#restart();
  };

  #restart(): void {
    if (this.#terminated) return;
    this.#transport.removeEventListener("message", this.#forward);
    this.#transport.removeErrorListener(this.#forwardError);
    this.#transport.terminate();
    this.#transport = this.#factory();
    this.#transport.addEventListener("message", this.#forward);
    this.#transport.addErrorListener(this.#forwardError);
    this.#restartCount += 1;
    if (this.#init) this.#transport.postMessage(cloneMessage(this.#init));
    if (this.#project) this.#transport.postMessage(cloneMessage(this.#project));
  }
}

export function listenToEngine(
  transport: EngineTransport,
  listener: (message: FromEngine) => void,
): () => void {
  const onMessage: EngineMessageListener = (event) => {
    const message = decodeFromEngine(event.data);
    if (message) listener(message);
  };
  transport.addEventListener("message", onMessage);
  return () => transport.removeEventListener("message", onMessage);
}
