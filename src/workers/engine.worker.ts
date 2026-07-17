import { BundleResolver } from "../features/resources/bundleResolver";
import { scanTexDependencies } from "../features/resources/dependencyScanner";
import { createResourceCache, type ResourceCache } from "../features/resources/resourceCache";
import { WorkerSyncResourceCache } from "../features/resources/syncResourceCache";
import { createDistributionWasmEngine } from "../features/tex-compile/distributionWasmEngine";
import {
  decodeToEngine,
  type FromEngine,
  type ToEngine,
  transferablesFor,
} from "../features/tex-compile/protocol";
import {
  type IncrementalTexEngine,
  loadWasmEngine,
} from "../features/tex-compile/wasmEngineAdapter";

type WorkerScope = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: FromEngine, transfer: Transferable[]): void;
};

type EngineInitOptions = {
  moduleUrl: string;
  bundleBaseUrl: string;
};

const scope = globalThis as unknown as WorkerScope;
let engine: IncrementalTexEngine | undefined;
let activeResolver: BundleResolver | undefined;
let messageQueue = Promise.resolve();

const emit = (message: FromEngine) => scope.postMessage(message, transferablesFor(message));

const initOptions = (message: Extract<ToEngine, { t: "init" }>): EngineInitOptions => {
  const { moduleUrl, bundleBaseUrl } = message.engineOpts;
  if (typeof moduleUrl !== "string" || typeof bundleBaseUrl !== "string") {
    throw new Error("Engine init requires moduleUrl and bundleBaseUrl");
  }
  return { moduleUrl, bundleBaseUrl };
};

async function createWorkerCache(bundleDigest: string): Promise<ResourceCache> {
  try {
    return await WorkerSyncResourceCache.create(bundleDigest);
  } catch {
    return createResourceCache(bundleDigest);
  }
}

async function boot(message: Extract<ToEngine, { t: "init" }>): Promise<void> {
  await engine?.dispose();
  if (message.engineOpts.mode === "plain-demo") {
    activeResolver = undefined;
    engine = await createDistributionWasmEngine(emit);
    await engine.handle(message);
    return;
  }
  const options = initOptions(message);
  const cache = await createWorkerCache(message.bundleDigest);
  const resolver = new BundleResolver({
    bundleDigest: message.bundleDigest,
    baseUrl: options.bundleBaseUrl,
    cache,
    onMetric: (metric) => emit({ t: "telemetry", metric }),
  });
  await resolver.init();
  activeResolver = resolver;
  engine = await loadWasmEngine(options.moduleUrl, resolver, emit);
  await engine.handle(message);
}

async function handle(message: ToEngine): Promise<void> {
  if (message.t === "init") {
    await boot(message);
    return;
  }
  if (!engine) throw new Error("Engine received a command before init");
  if (message.t === "openProject" && activeResolver) {
    const decoder = new TextDecoder();
    const dependencies = message.files.flatMap((file) =>
      /\.(tex|sty|cls)$/i.test(file.path) ? scanTexDependencies(decoder.decode(file.bytes)) : [],
    );
    void activeResolver.prefetch(dependencies);
  }
  await engine.handle(message);
}

scope.onmessage = (event) => {
  const message = decodeToEngine(event.data);
  if (!message) return;
  if (message.t === "cancel" && engine) {
    void engine.handle(message);
    return;
  }
  messageQueue = messageQueue
    .then(() => handle(message))
    .catch((error: unknown) => {
      emit({ t: "fatal", message: error instanceof Error ? error.message : String(error) });
    });
};
