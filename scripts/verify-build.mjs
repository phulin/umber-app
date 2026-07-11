import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url);
const assets = new URL("assets/", dist);
const assetNames = await readdir(assets);
const javascript = assetNames.filter((name) => name.endsWith(".js"));

if (!javascript.some((name) => name.startsWith("engine.worker-"))) {
  throw new Error("Production build did not emit the engine worker asset");
}

for (const name of javascript) {
  const bytes = (await stat(new URL(name, assets))).size;
  if (bytes > 600_000) throw new Error(`${name} exceeds the 600 kB launch budget (${bytes} bytes)`);
}

const headers = await readFile(new URL("_headers", dist), "utf8");
if (!headers.includes("application/wasm") || !headers.includes("immutable")) {
  throw new Error("Production build is missing WASM MIME or immutable cache policy");
}

const redirects = await readFile(new URL("_redirects", dist), "utf8");
if (!redirects.includes("/index.html 200")) {
  throw new Error("Production build is missing the SPA fallback");
}

console.log(`verified ${javascript.length} JavaScript assets in ${join(dist.pathname, "assets")}`);
