import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../fixtures/serialisation/", import.meta.url);

export async function loadSerialisationFixtureText(name) {
  return readFile(new URL(name, FIXTURE_ROOT), "utf8");
}

export async function loadSerialisationFixtureJSON(name) {
  const text = await loadSerialisationFixtureText(name);

  return JSON.parse(text);
}
