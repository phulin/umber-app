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
