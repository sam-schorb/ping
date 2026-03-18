import test from "node:test";
import assert from "node:assert/strict";

import { GraphModel, getNodeDefinition } from "../src/index.js";

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

function createGroupDefinition() {
  return {
    id: "group-a",
    name: "Group A",
    graph: {
      nodes: [
        {
          id: "inner-pulse",
          type: "pulse",
          pos: { x: 0, y: 0 },
        },
      ],
      edges: [],
    },
    inputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
    outputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
    controls: [{ nodeId: "inner-pulse", paramKey: "param" }],
  };
}

test("composed grouping ops can add a group and a referencing group node instance", () => {
  const model = createModel();
  const result = model.applyOps([
    {
      type: "addGroup",
      payload: {
        group: createGroupDefinition(),
      },
    },
    {
      type: "addNode",
      payload: {
        node: {
          id: "group-node",
          type: "group",
          groupRef: "group-a",
          pos: { x: 2, y: 2 },
          rot: 0,
          params: {},
        },
      },
    },
  ]);

  const snapshot = model.getSnapshot();
  const indexes = model.getIndexes();

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(snapshot.groups["group-a"].graph.nodes[0].rot, 0);
  assert.deepEqual(snapshot.groups["group-a"].graph.nodes[0].params, {});
  assert.equal(indexes.portById.size, 3);
});

test("removeGroup rejects when the group is still referenced by nodes", () => {
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
      "group-a": createGroupDefinition(),
    },
  });

  const result = model.applyOps([
    {
      type: "removeGroup",
      payload: { groupId: "group-a" },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_GROUP_REF_INVALID");
  assert.ok(model.getSnapshot().groups["group-a"]);
});

test("updateGroup replaces an existing group definition while keeping references intact", () => {
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
      "group-a": createGroupDefinition(),
    },
  });

  const result = model.applyOps([
    {
      type: "updateGroup",
      payload: {
        group: {
          ...createGroupDefinition(),
          name: "Edited Group",
          outputs: [],
        },
      },
    },
  ]);

  const snapshot = model.getSnapshot();

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(snapshot.groups["group-a"].name, "Edited Group");
  assert.deepEqual(snapshot.groups["group-a"].outputs, []);
  assert.equal(snapshot.nodes[0].groupRef, "group-a");
});
