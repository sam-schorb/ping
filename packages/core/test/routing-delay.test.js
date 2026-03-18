import test from "node:test";
import assert from "node:assert/strict";

import { getLayout, getNodeDefinition, routeGraph } from "../src/index.js";
import { loadRoutingFixture } from "./helpers/routing-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("routeGraph derives edge delays from route length and ticksPerGrid", async () => {
  const fixture = await loadRoutingFixture("valid-multi-corner.json");
  const result = routeGraph(fixture, registry, {
    ticksPerGrid: 2.5,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.equal(result.errors, undefined);
  assert.equal(result.edgeRoutes.get("edge-corner").totalLength, 7);
  assert.equal(result.edgeDelays.get("edge-corner"), 17.5);
});

test("routing allows zero base delay when anchors coincide", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output",
        type: "output",
        pos: { x: 3, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-zero",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
  };
  const result = routeGraph(snapshot, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.equal(result.edgeRoutes.get("edge-zero").totalLength, 0);
  assert.equal(result.edgeDelays.get("edge-zero"), 0);
});
