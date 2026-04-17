import test from "node:test";
import assert from "node:assert/strict";

import { getLayout, getNodeDefinition, routeEdge } from "../src/index.js";
import { loadRoutingFixture } from "./helpers/routing-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("route length equals the sum of orthogonal segment lengths", async () => {
  const fixture = await loadRoutingFixture("valid-min.json");
  const route = routeEdge("edge-a", fixture, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(route.points, [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ]);
  assert.equal(route.totalLength, 1);
});
