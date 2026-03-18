import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, getLayout, getNodeDefinition } from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph assigns edge roles from registry-defined input roles", () => {
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
        id: "node-switch",
        type: "switch",
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
        id: "edge-control",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-switch", portSlot: 1 },
        manualCorners: [],
      },
      {
        id: "edge-signal",
        from: { nodeId: "node-switch", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
  };
  const result = buildGraph(
    snapshot,
    registry,
    new Map([
      ["edge-control", 1],
      ["edge-signal", 2],
    ]),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.edges.map((edge) => [edge.id, edge.role]),
    [
      ["edge-control", "control"],
      ["edge-signal", "signal"],
    ],
  );
});
