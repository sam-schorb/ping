import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  getLayout,
  getNodeDefinition,
  routeProjectGraph,
} from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph preserves raw float delays from routing output", async () => {
  const fixture = await loadBuildFixture("valid-min.json");
  const result = buildGraph(fixture, registry, new Map([["edge-a", 3.75]]));

  assert.equal(result.ok, true);
  assert.equal(result.graph.edges[0].delay, 3.75);
});

test("routeProjectGraph merges instantiated group-internal delays needed by buildGraph", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-group",
        type: "group",
        groupRef: "group-a",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output",
        type: "output",
        pos: { x: 8, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-out",
        from: { nodeId: "node-group", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [
            {
              id: "inner-pulse",
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: { param: 3 },
            },
            {
              id: "inner-add",
              type: "add",
              pos: { x: 4, y: 0 },
              rot: 0,
              params: { param: 2 },
            },
          ],
          edges: [
            {
              id: "inner-edge",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
        inputs: [],
        outputs: [
          { nodeId: "inner-add", portSlot: 0 },
        ],
        controls: [],
      },
    },
  };

  const routed = routeProjectGraph(snapshot, registry);
  const result = buildGraph(snapshot, registry, routed.edgeDelays);

  assert.equal(routed.edgeDelays.has("inner-edge"), true);
  assert.equal(routed.edgeDelays.has("edge-out"), true);
  assert.equal(result.ok, true);
});
