import test from "node:test";
import assert from "node:assert/strict";

import { getLayout, getNodeDefinition, routeEdge, routeGraph } from "../src/index.js";
import { loadRoutingFixture } from "./helpers/routing-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("invalid routing fixtures surface the expected ROUTE_* diagnostics", async () => {
  const missingNode = await loadRoutingFixture("invalid-missing-node.json");
  const invalidPort = await loadRoutingFixture("invalid-invalid-port.json");

  const missingNodeResult = routeGraph(missingNode, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });
  const invalidPortResult = routeGraph(invalidPort, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(
    missingNodeResult.errors?.map((issue) => issue.code),
    ["ROUTE_MISSING_NODE"],
  );
  assert.deepEqual(
    invalidPortResult.errors?.map((issue) => issue.code),
    ["ROUTE_INVALID_PORT"],
  );
});

test("unknown node layouts surface ROUTE_ANCHOR_FAIL", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-unknown",
        type: "does-not-exist",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output",
        type: "output",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-anchor",
        from: { nodeId: "node-unknown", portSlot: 0 },
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

  assert.deepEqual(result.errors?.map((issue) => issue.code), [
    "ROUTE_ANCHOR_FAIL",
  ]);
});

test("routeEdge throws an explicit error when the edge is missing", async () => {
  const fixture = await loadRoutingFixture("valid-min.json");

  assert.throws(
    () =>
      routeEdge("missing-edge", fixture, registry, {
        ticksPerGrid: 1,
        stubLength: 1,
        bendPreference: "horizontal-first",
      }),
    (error) => error?.name === "RoutingError" && error?.code === "ROUTE_MISSING_EDGE",
  );
});

test("invalid routing config surfaces ROUTE_INTERNAL_ERROR", async () => {
  const fixture = await loadRoutingFixture("valid-min.json");
  const result = routeGraph(fixture, registry, {
    ticksPerGrid: 1,
    stubLength: -1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(result.errors?.map((issue) => issue.code), [
    "ROUTE_INTERNAL_ERROR",
  ]);
});
