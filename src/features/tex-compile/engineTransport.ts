import { decodeFromEngine, type FromEngine, type ToEngine } from "./protocol";

export type EngineMessageEvent = { data: unknown };
export type EngineMessageListener = (event: EngineMessageEvent) => void;

export interface EngineTransport {
  postMessage(message: ToEngine, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: EngineMessageListener): void;
  removeEventListener(type: "message", listener: EngineMessageListener): void;
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

  terminate(): void {
    this.#terminated = true;
    this.#listeners.clear();
  }

  emit(message: unknown): void {
    if (this.#terminated) return;
    for (const listener of this.#listeners) listener({ data: message });
  }
}

export class WorkerEngineTransport implements EngineTransport {
  readonly #worker: Worker;
  readonly #listenerMap = new Map<EngineMessageListener, EventListener>();

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

  terminate(): void {
    this.#worker.terminate();
    this.#listenerMap.clear();
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

/** Restarts a failed worker and replays the session bootstrap without retaining detached buffers. */
export class RestartableEngineTransport implements EngineTransport {
  readonly #factory: () => EngineTransport;
  readonly #listeners = new Set<EngineMessageListener>();
  #transport: EngineTransport;
  #init?: Extract<ToEngine, { t: "init" }>;
  #project?: Extract<ToEngine, { t: "openProject" }>;
  #terminated = false;
  #restartCount = 0;

  constructor(factory: () => EngineTransport) {
    this.#factory = factory;
    this.#transport = factory();
    this.#transport.addEventListener("message", this.#forward);
  }

  get restartCount(): number {
    return this.#restartCount;
  }

  postMessage(message: ToEngine, transfer: Transferable[] = []): void {
    if (this.#terminated) return;
    if (message.t === "init") this.#init = cloneMessage(message) as typeof message;
    if (message.t === "openProject") this.#project = cloneMessage(message) as typeof message;
    this.#transport.postMessage(message, transfer);
  }

  addEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: EngineMessageListener): void {
    this.#listeners.delete(listener);
  }

  terminate(): void {
    this.#terminated = true;
    this.#transport.removeEventListener("message", this.#forward);
    this.#transport.terminate();
    this.#listeners.clear();
  }

  readonly #forward: EngineMessageListener = (event) => {
    for (const listener of this.#listeners) listener(event);
    const message = decodeFromEngine(event.data);
    if (message?.t === "fatal") this.#restart();
  };

  #restart(): void {
    if (this.#terminated) return;
    this.#transport.removeEventListener("message", this.#forward);
    this.#transport.terminate();
    this.#transport = this.#factory();
    this.#transport.addEventListener("message", this.#forward);
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
