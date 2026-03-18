import test from "node:test";
import assert from "node:assert/strict";

import { GraphModel, getNodeDefinition } from "../src/index.js";

globalThis.__PING_GRAPH_MODEL_CLASS__ = GraphModel;

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

test("applyOps supports the full graph op set and emits change events as ops only", () => {
  const model = createModel();
  const events = [];
  const unsubscribe = model.onChange((event) => events.push(event));

  assert.deepEqual(model.applyOps([
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-pulse",
          type: "pulse",
          pos: { x: 0, y: 0 },
          rot: 0,
          params: {},
        },
      },
    },
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-output",
          type: "output",
          pos: { x: 4, y: 0 },
          rot: 0,
          params: {},
        },
      },
    },
    {
      type: "addEdge",
      payload: {
        edge: {
          id: "edge-a",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          manualCorners: [],
        },
      },
    },
    {
      type: "addCorner",
      payload: {
        edgeId: "edge-a",
        index: 0,
        point: { x: 2, y: 1 },
      },
    },
    {
      type: "moveCorner",
      payload: {
        edgeId: "edge-a",
        index: 0,
        point: { x: 2, y: 2 },
      },
    },
    {
      type: "moveNode",
      payload: {
        id: "node-output",
        pos: { x: 5, y: 0 },
      },
    },
    {
      type: "rotateNode",
      payload: {
        id: "node-pulse",
        rot: 90,
      },
    },
    {
      type: "setParam",
      payload: {
        id: "node-pulse",
        param: 7,
      },
    },
    {
      type: "renameNode",
      payload: {
        id: "node-output",
        name: "Main Out",
      },
    },
    {
      type: "removeCorner",
      payload: {
        edgeId: "edge-a",
        index: 0,
      },
    },
  ]), { ok: true, changed: true });

  const snapshot = model.getSnapshot();

  assert.equal(snapshot.nodes.length, 2);
  assert.equal(snapshot.edges.length, 1);
  assert.equal(snapshot.nodes[0].rot, 90);
  assert.equal(snapshot.nodes[0].params.param, 7);
  assert.equal(snapshot.nodes[1].name, "Main Out");
  assert.deepEqual(snapshot.edges[0].manualCorners, []);
  assert.equal(events.length, 1);
  assert.equal(Array.isArray(events[0].ops), true);
  assert.equal(events[0].ops[0].type, "addNode");

  assert.deepEqual(model.applyOps([{ type: "removeEdge", payload: { id: "edge-a" } }]), {
    ok: true,
    changed: true,
  });
  assert.deepEqual(model.applyOps([{ type: "removeNode", payload: { id: "node-output" } }]), {
    ok: true,
    changed: true,
  });

  unsubscribe();

  assert.deepEqual(model.getSnapshot(), {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 90,
        params: { param: 7 },
      },
    ],
    edges: [],
  });
});

test("invalid transactions reject without partially mutating the model", () => {
  const model = createModel();
  const result = model.applyOps([
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-pulse",
          type: "pulse",
          pos: { x: 0, y: 0 },
          rot: 0,
          params: {},
        },
      },
    },
    {
      type: "addEdge",
      payload: {
        edge: {
          id: "edge-invalid",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "missing-node", portSlot: 0 },
          manualCorners: [],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.errors[0].code, "MODEL_EDGE_DANGLING_ENDPOINT");
  assert.deepEqual(model.getSnapshot(), { nodes: [], edges: [] });
});

test("invalid addNode and rotateNode ops report model errors without mutating state", () => {
  const model = createModel({
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
  });

  const unknownType = model.applyOps([
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-bad",
          type: "unknown-type",
          pos: { x: 1, y: 0 },
          rot: 0,
          params: {},
        },
      },
    },
  ]);
  const invalidRotation = model.applyOps([
    {
      type: "rotateNode",
      payload: {
        id: "node-pulse",
        rot: 45,
      },
    },
  ]);

  assert.equal(unknownType.ok, false);
  assert.equal(unknownType.errors[0].code, "MODEL_UNKNOWN_NODE_TYPE");
  assert.equal(invalidRotation.ok, false);
  assert.equal(invalidRotation.errors[0].code, "MODEL_INVALID_ROTATION");
  assert.deepEqual(model.getSnapshot(), {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
  });
});

test("addNode does not auto-fill missing params on ops", () => {
  const model = createModel();
  const result = model.applyOps([
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-pulse",
          type: "pulse",
          pos: { x: 0, y: 0 },
          rot: 0,
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_INVALID_OPERATION");
  assert.deepEqual(model.getSnapshot(), { nodes: [], edges: [] });
});

test("removing a node automatically removes connected edges", () => {
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
        type: "output",
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

  const result = model.applyOps([{ type: "removeNode", payload: { id: "node-pulse" } }]);

  assert.deepEqual(result, { ok: true, changed: true });
  assert.deepEqual(model.getSnapshot(), {
    nodes: [
      {
        id: "node-output",
        type: "output",
        pos: { x: 3, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
  });
});

test("non-integer corner coordinates are rejected", () => {
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
        type: "output",
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

  const result = model.applyOps([
    {
      type: "addCorner",
      payload: {
        edgeId: "edge-a",
        index: 0,
        point: { x: 1.5, y: 0 },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_INVALID_POSITION");
  assert.deepEqual(model.getSnapshot().edges[0].manualCorners, []);
});
