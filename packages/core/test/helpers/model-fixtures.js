import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../fixtures/model/", import.meta.url);

export async function loadModelFixture(name) {
  const fixtureText = await readFile(new URL(name, FIXTURE_ROOT), "utf8");
  return JSON.parse(fixtureText);
}

export function createGraphModel(getNodeDefinition, snapshot) {
  return new globalThis.__PING_GRAPH_MODEL_CLASS__({
    getNodeDefinition,
    snapshot,
  });
}
