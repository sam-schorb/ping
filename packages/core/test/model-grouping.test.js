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
          rot: 0,
          params: {},
        },
      ],
      edges: [],
    },
    inputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
    outputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
    controls: [{ nodeId: "inner-pulse", controlSlot: 0 }],
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

test("addGroup accepts nested group references when the dependency graph stays acyclic", () => {
  const model = createModel({
    nodes: [],
    edges: [],
    groups: {
      "group-a": createGroupDefinition(),
    },
  });

  const result = model.applyOps([
    {
      type: "addGroup",
      payload: {
        group: {
          id: "group-b",
          name: "Group B",
          graph: {
            nodes: [
              {
                id: "inner-group",
                type: "group",
                groupRef: "group-a",
                pos: { x: 0, y: 0 },
                rot: 0,
                params: {},
              },
            ],
            edges: [],
          },
          inputs: [{ nodeId: "inner-group", portSlot: 0 }],
          outputs: [{ nodeId: "inner-group", portSlot: 0 }],
          controls: [{ nodeId: "inner-group", controlSlot: 0 }],
        },
      },
    },
  ]);

  assert.deepEqual(result, { ok: true, changed: true });
  assert.equal(model.getSnapshot().groups["group-b"].controls[0].controlSlot, 0);
});

test("group ops reject legacy paramKey control mappings on canonical op paths", () => {
  const model = createModel();

  const result = model.applyOps([
    {
      type: "addGroup",
      payload: {
        group: {
          ...createGroupDefinition(),
          controls: [{ nodeId: "inner-pulse", paramKey: "param" }],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_INVALID_OPERATION");
});

test("addGroup rejects control mappings that target an already-connected internal control input", () => {
  const model = createModel();

  const result = model.applyOps([
    {
      type: "addGroup",
      payload: {
        group: {
          id: "group-invalid-control",
          name: "Group Invalid Control",
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
                id: "edge-signal",
                from: { nodeId: "inner-pulse", portSlot: 0 },
                to: { nodeId: "inner-add", portSlot: 0 },
                manualCorners: [],
              },
              {
                id: "edge-control",
                from: { nodeId: "inner-pulse", portSlot: 0 },
                to: { nodeId: "inner-add", portSlot: 1 },
                manualCorners: [],
              },
            ],
          },
          inputs: [],
          outputs: [{ nodeId: "inner-add", portSlot: 0 }],
          controls: [{ nodeId: "inner-add", controlSlot: 0 }],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_PORT_ALREADY_CONNECTED");
  assert.match(result.errors[0].message, /already connected inside the group/i);
});

test("addGroup rejects self-referential group cycles", () => {
  const model = createModel();

  const result = model.applyOps([
    {
      type: "addGroup",
      payload: {
        group: {
          id: "group-a",
          name: "Group A",
          graph: {
            nodes: [
              {
                id: "inner-group",
                type: "group",
                groupRef: "group-a",
                pos: { x: 0, y: 0 },
                rot: 0,
                params: {},
              },
            ],
            edges: [],
          },
          inputs: [],
          outputs: [{ nodeId: "inner-group", portSlot: 0 }],
          controls: [],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_GROUP_CYCLE");
  assert.equal(model.getSnapshot().groups, undefined);
});

test("updateGroup rejects mutual group dependency cycles", () => {
  const model = createModel({
    nodes: [],
    edges: [],
    groups: {
      "group-a": createGroupDefinition(),
      "group-b": {
        id: "group-b",
        name: "Group B",
        graph: {
          nodes: [
            {
              id: "inner-group",
              type: "group",
              groupRef: "group-a",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [],
        },
        inputs: [{ nodeId: "inner-group", portSlot: 0 }],
        outputs: [{ nodeId: "inner-group", portSlot: 0 }],
        controls: [{ nodeId: "inner-group", controlSlot: 0 }],
      },
    },
  });

  const result = model.applyOps([
    {
      type: "updateGroup",
      payload: {
        group: {
          id: "group-a",
          name: "Group A",
          graph: {
            nodes: [
              {
                id: "inner-group",
                type: "group",
                groupRef: "group-b",
                pos: { x: 0, y: 0 },
                rot: 0,
                params: {},
              },
            ],
            edges: [],
          },
          inputs: [{ nodeId: "inner-group", portSlot: 0 }],
          outputs: [{ nodeId: "inner-group", portSlot: 0 }],
          controls: [{ nodeId: "inner-group", controlSlot: 0 }],
        },
      },
    },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "MODEL_GROUP_CYCLE");
  assert.equal(model.getSnapshot().groups["group-a"].graph.nodes[0].type, "pulse");
});
