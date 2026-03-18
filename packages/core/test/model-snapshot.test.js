import test from "node:test";
import assert from "node:assert/strict";

import { GraphModel, getNodeDefinition } from "../src/index.js";
import { loadModelFixture } from "./helpers/model-fixtures.js";

test("constructor load defaults missing rot and params on valid snapshots", async () => {
  const snapshot = await loadModelFixture("valid-min.json");
  const model = new GraphModel({ getNodeDefinition, snapshot });

  assert.deepEqual(model.getSnapshot(), {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 2, y: 3 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
  });
});

for (const [fixtureName, expectedCode] of [
  ["invalid-unknown-type.json", "MODEL_UNKNOWN_NODE_TYPE"],
  ["invalid-non-integer-pos.json", "MODEL_INVALID_POSITION"],
  ["invalid-edge-direction.json", "MODEL_EDGE_DIRECTION_INVALID"],
  ["invalid-port-slot.json", "MODEL_PORT_INVALID"],
]) {
  test(`${fixtureName} fails load with ${expectedCode}`, async () => {
    const snapshot = await loadModelFixture(fixtureName);

    assert.throws(
      () => new GraphModel({ getNodeDefinition, snapshot }),
      (error) => error.name === "GraphModelLoadError" && error.code === expectedCode,
    );
  });
}

test("load rejects missing group refs for group nodes", () => {
  assert.throws(
    () =>
      new GraphModel({
        getNodeDefinition,
        snapshot: {
          nodes: [
            {
              id: "group-node",
              type: "group",
              groupRef: "missing-group",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [],
        },
      }),
    (error) =>
      error.name === "GraphModelLoadError" &&
      error.code === "MODEL_GROUP_REF_INVALID",
  );
});

test("load treats missing required fields as fatal", () => {
  assert.throws(
    () =>
      new GraphModel({
        getNodeDefinition,
        snapshot: {
          nodes: [
            {
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [],
        },
      }),
    (error) =>
      error.name === "GraphModelLoadError" &&
      error.code === "MODEL_INVALID_OPERATION",
  );
});

test("snapshots preserve insertion order and remain stable across equivalent builds", () => {
  const ops = [
    {
      type: "addNode",
      payload: {
        node: {
          id: "node-a",
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
          id: "node-b",
          type: "output",
          pos: { x: 5, y: 0 },
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
          from: { nodeId: "node-a", portSlot: 0 },
          to: { nodeId: "node-b", portSlot: 0 },
          manualCorners: [{ x: 2, y: 0 }],
        },
      },
    },
  ];

  const modelA = new GraphModel({ getNodeDefinition });
  const modelB = new GraphModel({ getNodeDefinition });

  assert.deepEqual(modelA.applyOps(ops), { ok: true, changed: true });
  assert.deepEqual(modelB.applyOps(ops), { ok: true, changed: true });
  assert.deepEqual(modelA.getSnapshot(), modelB.getSnapshot());
  assert.deepEqual(modelA.getSnapshot().nodes.map((node) => node.id), ["node-a", "node-b"]);
  assert.deepEqual(modelA.getSnapshot().edges.map((edge) => edge.id), ["edge-a"]);
});
