import { readFile } from "node:fs/promises";

const ALLOWED_ASSETS = Object.freeze({
  "dough.js": {
    contentType: "application/javascript; charset=utf-8",
    file: new URL("../../../../../dough/dough.js", import.meta.url),
  },
  "dough.wasm": {
    contentType: "application/wasm",
    file: new URL("../../../../../dough/dough.wasm", import.meta.url),
  },
});

export async function GET(_request, context) {
  const { asset } = await context.params;
  const entry = ALLOWED_ASSETS[asset];

  if (!entry) {
    return new Response("Not found.", { status: 404 });
  }

  const file = await readFile(entry.file);

  return new Response(file, {
    headers: {
      "Content-Type": entry.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
