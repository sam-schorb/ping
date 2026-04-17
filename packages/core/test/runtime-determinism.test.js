import test from "node:test";
import assert from "node:assert/strict";

import { createRuntime, loadRuntimeFixture } from "./helpers/runtime-fixtures.js";

test("per-node RNG is deterministic for the same seed and diverges for a different seed", async () => {
  const graph = await loadRuntimeFixture("valid-random-seed.json");

  const first = createRuntime(graph, { rngSeed: 1234 });
  const second = createRuntime(graph, { rngSeed: 1234 });
  const third = createRuntime(graph, { rngSeed: 9876 });

  const firstOutputs = first.queryWindow(0, 5);
  const secondOutputs = second.queryWindow(0, 5);
  const thirdOutputs = third.queryWindow(0, 5);

  assert.equal(firstOutputs.length, 5);
  assert.deepEqual(secondOutputs, firstOutputs);
  assert.notDeepEqual(thirdOutputs, firstOutputs);
});
