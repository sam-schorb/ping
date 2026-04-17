import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../fixtures/build/", import.meta.url);

export async function loadBuildFixture(name) {
  const fixtureText = await readFile(new URL(name, FIXTURE_ROOT), "utf8");
  return JSON.parse(fixtureText);
}
