import type { BundleResolver } from "../resources/bundleResolver";
import type { FromEngine, ToEngine } from "./protocol";

export type EngineHost = {
  resolve(name: string): Promise<string | null>;
  getFile(hash: string): Promise<ArrayBuffer>;
  emit(message: FromEngine): void;
};

export interface IncrementalTexEngine {
  handle(message: ToEngine): void | Promise<void>;
  dispose(): void | Promise<void>;
}

export interface IncrementalTexEngineModule {
  createIncrementalTexEngine(
    host: EngineHost,
  ): IncrementalTexEngine | Promise<IncrementalTexEngine>;
}

type ModuleLoader = (moduleUrl: string) => Promise<unknown>;

const defaultLoader: ModuleLoader = (moduleUrl) => import(/* @vite-ignore */ moduleUrl);

function isEngineModule(value: unknown): value is IncrementalTexEngineModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "createIncrementalTexEngine" in value &&
    typeof value.createIncrementalTexEngine === "function"
  );
}

/** Loads the external Rust/WASM package behind one stable browser-side adapter contract. */
export async function loadWasmEngine(
  moduleUrl: string,
  resolver: BundleResolver,
  emit: (message: FromEngine) => void,
  loader: ModuleLoader = defaultLoader,
): Promise<IncrementalTexEngine> {
  const module = await loader(moduleUrl);
  if (!isEngineModule(module)) {
    throw new Error("Engine module must export createIncrementalTexEngine(host)");
  }
  return module.createIncrementalTexEngine({
    resolve: (name) => resolver.resolve(name),
    getFile: (hash) => resolver.getFile(hash),
    emit,
  });
}
