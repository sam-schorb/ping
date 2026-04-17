import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../fixtures/routing/", import.meta.url);

export async function loadRoutingFixture(name) {
  const fixtureText = await readFile(new URL(name, FIXTURE_ROOT), "utf8");

  return JSON.parse(fixtureText);
}
