import test from "node:test";
import assert from "node:assert/strict";

import { GraphModel, getNodeDefinition } from "../src/index.js";

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

test("ports are derived from registry definitions and do not appear in snapshots", () => {
  const model = createModel({
    nodes: [
      {
        id: "node-switch",
        type: "switch",
        pos: { x: 1, y: 1 },
        rot: 180,
        params: {},
      },
    ],
    edges: [],
  });

  const snapshot = model.getSnapshot();
  const indexes = model.getIndexes();

  assert.equal("ports" in snapshot, false);
  assert.equal(indexes.portById.size, 8);
  assert.deepEqual(
    Array.from(indexes.portById.keys()),
    [
      "node-switch:in:0",
      "node-switch:in:1",
      "node-switch:out:0",
      "node-switch:out:1",
      "node-switch:out:2",
      "node-switch:out:3",
      "node-switch:out:4",
      "node-switch:out:5",
    ],
  );
});

test("group node ports are derived from the group library, not stored on the node record", () => {
  const model = createModel({
    nodes: [
      {
        id: "group-node",
        type: "group",
        groupRef: "group-a",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
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
              params: {},
            },
          ],
          edges: [],
        },
        inputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
        outputs: [{ nodeId: "inner-pulse", portSlot: 0 }, { nodeId: "inner-pulse", portSlot: 0 }],
        controls: [{ nodeId: "inner-pulse", paramKey: "param" }],
      },
    },
  });

  const indexes = model.getIndexes();

  assert.deepEqual(
    Array.from(indexes.portById.keys()),
    [
      "group-node:in:0",
      "group-node:in:1",
      "group-node:out:0",
      "group-node:out:1",
    ],
  );
});

test("port slot ids remain stable when a node rotates", () => {
  const model = createModel({
    nodes: [
      {
        id: "node-switch",
        type: "switch",
        pos: { x: 1, y: 1 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
  });

  const before = Array.from(model.getIndexes().portById.keys());

  assert.deepEqual(model.applyOps([
    {
      type: "rotateNode",
      payload: { id: "node-switch", rot: 270 },
    },
  ]), { ok: true, changed: true });

  const after = Array.from(model.getIndexes().portById.keys());

  assert.deepEqual(before, after);
});
