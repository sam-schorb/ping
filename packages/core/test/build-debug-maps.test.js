import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, getLayout, getNodeDefinition } from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph includes debug maps by default and omits them when disabled", async () => {
  const fixture = await loadBuildFixture("valid-min.json");
  const withDebug = buildGraph(fixture, registry, new Map([["edge-a", 1]]));
  const withoutDebug = buildGraph(
    fixture,
    registry,
    new Map([["edge-a", 1]]),
    { includeDebugMaps: false },
  );

  assert.equal(withDebug.ok, true);
  assert.deepEqual(Array.from(withDebug.graph.debug.nodeIdToSourceId.entries()), [
    ["node-pulse", "node-pulse"],
    ["node-output", "node-output"],
  ]);
  assert.deepEqual(Array.from(withDebug.graph.debug.edgeIdToSourceId.entries()), [
    ["edge-a", "edge-a"],
  ]);
  assert.equal(withoutDebug.ok, true);
  assert.equal(withoutDebug.graph.debug, undefined);
});
