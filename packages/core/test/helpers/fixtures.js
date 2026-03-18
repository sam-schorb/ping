import { readFile } from "node:fs/promises";

const FIXTURE_ROOT = new URL("../fixtures/registry/", import.meta.url);

export async function loadRegistryFixture(name) {
  const fixtureText = await readFile(new URL(name, FIXTURE_ROOT), "utf8");
  const definitions = JSON.parse(fixtureText);

  return definitions.map((definition) => ({
    ...definition,
    onSignal: () => ({ outputs: [] }),
  }));
}

export function createBehaviorContext(overrides = {}) {
  const baseContext = {
    tick: 0,
    inPortIndex: 0,
    param: 1,
    state: {},
    nodeId: "node-1",
    rng: () => 0.5,
    pulse: {
      value: 4,
      speed: 2,
      params: {
        decay: 3,
      },
    },
  };

  return {
    ...baseContext,
    ...overrides,
    pulse: {
      ...baseContext.pulse,
      ...(overrides.pulse ?? {}),
    },
  };
}
