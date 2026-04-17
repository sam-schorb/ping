import test from "node:test";
import assert from "node:assert/strict";

import {
  GraphModel,
  Runtime,
  buildGraph,
  createCodeNodeGroupId,
  getLayout,
  getNodeDefinition,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

function createCodeNodeRecord(id) {
  return {
    id,
    type: "code",
    pos: { x: 0, y: 0 },
    rot: 0,
    params: {},
  };
}

function createBackingGroup(groupId, overrides = {}) {
  return {
    id: groupId,
    name: `Code ${groupId}`,
    preserveInternalCableDelays: false,
    graph: {
      nodes: [],
      edges: [],
    },
    inputs: [],
    outputs: [],
    controls: [],
    ...(overrides.dsl ? { dsl: { ...overrides.dsl } } : {}),
    ...overrides,
  };
}

test("addNode auto-creates a deterministic private backing group for code nodes", () => {
  const model = createModel();

  assert.deepEqual(
    model.applyOps([
      {
        type: "addNode",
        payload: {
          node: createCodeNodeRecord("node-code"),
        },
      },
    ]),
    { ok: true, changed: true },
  );

  const snapshot = model.getSnapshot();
  const groupId = createCodeNodeGroupId("node-code");

  assert.equal(snapshot.nodes[0].groupRef, groupId);
  assert.ok(snapshot.groups?.[groupId]);
  assert.equal(snapshot.groups[groupId].id, groupId);
  assert.equal(snapshot.groups[groupId].name, "Code node-code");
  assert.equal(snapshot.groups[groupId].dsl?.source, "");
  assert.equal(snapshot.groups[groupId].dsl?.mode, "authored");
  assert.equal(snapshot.groups[groupId].dsl?.syncStatus, "in-sync");
  assert.ok(snapshot.groups[groupId].dsl?.lastAppliedSemanticHash.length > 0);
});

test("code node ports derive from its private backing group", () => {
  const model = createModel();
  const groupId = createCodeNodeGroupId("node-code");

  assert.deepEqual(
    model.applyOps([
      {
        type: "addNode",
        payload: {
          node: createCodeNodeRecord("node-code"),
        },
      },
      {
        type: "updateGroup",
        payload: {
          group: createBackingGroup(groupId, {
            graph: {
              nodes: [
                {
                  id: "inner-pulse",
                  type: "pulse",
                  pos: { x: 0, y: 0 },
                  rot: 0,
                  params: { param: 1 },
                },
                {
                  id: "inner-add",
                  type: "add",
                  pos: { x: 8, y: 0 },
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
            inputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
            outputs: [{ nodeId: "inner-add", portSlot: 0 }],
            controls: [{ nodeId: "inner-add", controlSlot: 0 }],
          }),
        },
      },
    ]),
    { ok: true, changed: true },
  );

  assert.deepEqual(
    Array.from(model.getIndexes().portById.keys()),
    [
      "node-code:in:0",
      "node-code:in:1",
      "node-code:out:0",
    ],
  );
});

test("buildGraph and runtime treat code nodes through the normal group-expansion path", () => {
  const groupId = createCodeNodeGroupId("node-code");
  const snapshot = {
    nodes: [
      {
        id: "node-code",
        type: "code",
        groupRef: groupId,
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output",
        type: "out",
        pos: { x: 8, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-out",
        from: { nodeId: "node-code", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      [groupId]: createBackingGroup(groupId, {
        graph: {
          nodes: [
            {
              id: "inner-pulse",
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: { param: 1 },
            },
          ],
          edges: [],
        },
        outputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
      }),
    },
  };
  const built = buildGraph(snapshot, registry, new Map([["edge-out", 0.5]]));

  assert.equal(built.ok, true);
  assert.deepEqual(
    built.graph.nodes.map((node) => node.id),
    [
      "node-code::node::inner-pulse",
      "node-output",
    ],
  );
  assert.deepEqual(
    built.graph.groupMeta.groupsById.get("node-code"),
    {
      nodeIds: ["node-code::node::inner-pulse"],
      edgeIds: [],
      externalInputs: [],
      externalOutputs: [
        {
          groupPortSlot: 0,
          nodeId: "node-code::node::inner-pulse",
          portSlot: 0,
        },
      ],
      controls: [],
    },
  );

  const runtime = new Runtime({
    registry: { getNodeDefinition },
  });
  runtime.setGraph(built.graph);

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
  ]);
});

test("one code node owns one private backing group and removing the node removes only that group", () => {
  const model = createModel();

  assert.deepEqual(
    model.applyOps([
      {
        type: "addNode",
        payload: { node: createCodeNodeRecord("node-code-a") },
      },
      {
        type: "addNode",
        payload: { node: createCodeNodeRecord("node-code-b") },
      },
    ]),
    { ok: true, changed: true },
  );

  let snapshot = model.getSnapshot();

  assert.deepEqual(
    Object.keys(snapshot.groups ?? {}).sort(),
    [
      createCodeNodeGroupId("node-code-a"),
      createCodeNodeGroupId("node-code-b"),
    ],
  );

  assert.deepEqual(
    model.applyOps([
      {
        type: "removeNode",
        payload: { id: "node-code-a" },
      },
    ]),
    { ok: true, changed: true },
  );

  snapshot = model.getSnapshot();

  assert.deepEqual(
    Object.keys(snapshot.groups ?? {}),
    [createCodeNodeGroupId("node-code-b")],
  );
  assert.equal(snapshot.nodes[0].id, "node-code-b");
  assert.equal(snapshot.nodes[0].groupRef, createCodeNodeGroupId("node-code-b"));
});
