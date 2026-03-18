import { readFile } from "node:fs/promises";

const ALLOWED_ASSETS = Object.freeze({
  "dough.js": "application/javascript; charset=utf-8",
  "dough.wasm": "application/wasm",
});

export async function GET(_request, context) {
  const { asset } = await context.params;
  const contentType = ALLOWED_ASSETS[asset];

  if (!contentType) {
    return new Response("Not found.", { status: 404 });
  }

  const file = await readFile(new URL(`../../../../../dough/${asset}`, import.meta.url));

  return new Response(file, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
