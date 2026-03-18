import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));

const ASSETS = [
  {
    source: require.resolve("dough-synth/dough.js"),
    target: resolve(scriptDir, "../public/dough/dough.js"),
  },
  {
    source: require.resolve("dough-synth/dough.wasm"),
    target: resolve(scriptDir, "../public/dough/dough.wasm"),
  },
];

async function syncAssets() {
  for (const asset of ASSETS) {
    await mkdir(dirname(asset.target), { recursive: true });
    await copyFile(asset.source, asset.target);
  }
}

await syncAssets();
