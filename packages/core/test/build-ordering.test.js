import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, getLayout, getNodeDefinition } from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph preserves node order, edge order, and adjacency order", () => {
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
        id: "node-mux",
        type: "mux",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-b",
        type: "output",
        pos: { x: 8, y: -2 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-a",
        type: "output",
        pos: { x: 8, y: 2 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-b",
        from: { nodeId: "node-mux", portSlot: 1 },
        to: { nodeId: "node-output-b", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-mux", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-c",
        from: { nodeId: "node-mux", portSlot: 0 },
        to: { nodeId: "node-output-a", portSlot: 0 },
        manualCorners: [],
      },
    ],
  };
  const result = buildGraph(
    snapshot,
    registry,
    new Map([
      ["edge-a", 1],
      ["edge-b", 2],
      ["edge-c", 3],
    ]),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.nodes.map((node) => node.id),
    ["node-pulse", "node-mux", "node-output-b", "node-output-a"],
  );
  assert.deepEqual(
    result.graph.edges.map((edge) => edge.id),
    ["edge-b", "edge-a", "edge-c"],
  );
  assert.deepEqual(result.graph.edgesByNodeId.get("node-mux"), [
    "edge-b",
    "edge-a",
    "edge-c",
  ]);
});
