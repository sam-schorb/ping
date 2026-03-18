import test from "node:test";
import assert from "node:assert/strict";

import { GraphModel, getNodeDefinition } from "../src/index.js";

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

test("indexes stay correct for nodes, edges, and connected derived ports", () => {
  const model = createModel({
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
        type: "out",
        pos: { x: 3, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
  });

  const indexes = model.getIndexes();

  assert.equal(indexes.nodeById.size, 2);
  assert.equal(indexes.edgeById.size, 1);
  assert.equal(indexes.portById.size, 4);
  assert.equal(indexes.edgeByPortId.size, 2);
  assert.deepEqual(Array.from(indexes.edgesByNodeId.get("node-pulse")), ["edge-a"]);
  assert.deepEqual(Array.from(indexes.edgesByNodeId.get("node-output")), ["edge-a"]);
  assert.equal(indexes.portById.get("node-pulse:out:0").connectedEdgeId, "edge-a");
  assert.equal(indexes.portById.get("node-output:in:0").connectedEdgeId, "edge-a");
  assert.equal(indexes.portById.get("node-pulse:in:0").connectedEdgeId, undefined);
  assert.equal(indexes.portById.get("node-pulse:in:1").connectedEdgeId, undefined);
});

test("one cable per port is enforced through the indexes", () => {
  const model = createModel({
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-a",
        type: "out",
        pos: { x: 3, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-b",
        type: "out",
        pos: { x: 3, y: 2 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output-a", portSlot: 0 },
        manualCorners: [],
      },
    ],
  });

  const result = model.applyOps([
    {
      type: "addEdge",
      payload: {
        edge: {
          id: "edge-b",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-output-b", portSlot: 0 },
          manualCorners: [],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_PORT_ALREADY_CONNECTED");
});
