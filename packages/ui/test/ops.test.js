import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistryIndex,
  getLayout,
  getNodeDefinition,
} from "@ping/core";
import {
  buildGroupCandidates,
  buildCreateGroupOps,
  buildUpdateGroupOps,
  canCreateEdge,
  createClipboardSubgraph,
  createDeleteNodeSetOps,
  createDeleteSelectionOps,
  createMoveNodeSetOps,
  createNodeRecord,
  instantiateClipboardSubgraph,
  normalizeEdgeEndpoints,
} from "../src/index.js";

const REGISTRY_INDEX = buildRegistryIndex();
const REGISTRY = {
  getNodeDefinition(type) {
    return getNodeDefinition(type, REGISTRY_INDEX);
  },
  getLayout,
};

test("delete selection removes connected edges before nodes", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "out", pos: { x: 4, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };

  assert.deepEqual(createDeleteSelectionOps(snapshot, { kind: "node", nodeId: "node-a" }), [
    { type: "removeEdge", payload: { id: "edge-a" } },
    { type: "removeNode", payload: { id: "node-a" } },
  ]);
});

test("delete node set removes all touched edges once before removing every selected node", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
      { id: "node-c", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-b",
        from: { nodeId: "node-b", portSlot: 0 },
        to: { nodeId: "node-c", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-c",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-c", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };

  assert.deepEqual(createDeleteNodeSetOps(snapshot, ["node-a", "node-b"]), [
    { type: "removeEdge", payload: { id: "edge-a" } },
    { type: "removeEdge", payload: { id: "edge-b" } },
    { type: "removeEdge", payload: { id: "edge-c" } },
    { type: "removeNode", payload: { id: "node-a" } },
    { type: "removeNode", payload: { id: "node-b" } },
  ]);
});

test("move node set only emits operations for nodes whose snapped positions changed", () => {
  assert.deepEqual(
    createMoveNodeSetOps(
      {
        "node-a": { x: 2, y: 2 },
        "node-b": { x: 6, y: 2 },
      },
      {
        "node-a": { x: 4, y: 3 },
        "node-b": { x: 6, y: 2 },
      },
    ),
    [
      {
        type: "moveNode",
        payload: {
          id: "node-a",
          pos: { x: 4, y: 3 },
        },
      },
    ],
  );
});

test("clipboard subgraph keeps only selected nodes, internal edges, and referenced groups", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "group", groupRef: "group-a", pos: { x: 6, y: 2 }, rot: 0, params: {} },
      { id: "node-c", type: "out", pos: { x: 10, y: 2 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-internal",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [{ x: 4, y: 2 }],
      },
      {
        id: "edge-external",
        from: { nodeId: "node-b", portSlot: 0 },
        to: { nodeId: "node-c", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [],
      },
    },
  };

  assert.deepEqual(createClipboardSubgraph(snapshot, ["node-a", "node-b"]), {
    schemaVersion: 1,
    bounds: {
      minX: 2,
      minY: 2,
      width: 4,
      height: 0,
    },
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "group", groupRef: "group-a", pos: { x: 6, y: 2 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-internal",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [{ x: 4, y: 2 }],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [],
      },
    },
  });
});

test("clipboard subgraph includes transitive nested group dependencies", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "group", groupRef: "group-b", pos: { x: 2, y: 2 }, rot: 0, params: {} },
    ],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Child Group",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [{ nodeId: "inner-a", paramKey: "param" }],
      },
      "group-b": {
        id: "group-b",
        name: "Parent Group",
        graph: {
          nodes: [{ id: "inner-group", type: "group", groupRef: "group-a", pos: { x: 0, y: 0 }, rot: 0, params: {} }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-group", portSlot: 0 }],
        outputs: [{ nodeId: "inner-group", portSlot: 0 }],
        controls: [{ nodeId: "inner-group", controlSlot: 0 }],
      },
    },
  };

  const payload = createClipboardSubgraph(snapshot, ["node-a"]);

  assert.deepEqual(Object.keys(payload.groups), ["group-a", "group-b"]);
  assert.equal(payload.groups["group-b"].graph.nodes[0].groupRef, "group-a");
});

test("clipboard paste remaps ids, offsets positions, and reuses matching groups", () => {
  const payload = {
    schemaVersion: 1,
    bounds: { minX: 2, minY: 2, width: 4, height: 0 },
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "group", groupRef: "group-a", pos: { x: 6, y: 2 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [{ x: 4, y: 2 }],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [],
      },
    },
  };
  const snapshot = {
    nodes: [],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [],
      },
    },
  };
  const counters = { node: 1, edge: 1, group: 1 };

  const result = instantiateClipboardSubgraph({
    snapshot,
    payload,
    targetPosition: { x: 10, y: 12 },
    createId(prefix) {
      const nextId = `${prefix}-${counters[prefix]}`;
      counters[prefix] += 1;
      return nextId;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.pastedNodeIds, ["node-1", "node-2"]);
  assert.deepEqual(result.ops, [
    {
      type: "addNode",
      payload: {
        node: { id: "node-1", type: "pulse", pos: { x: 10, y: 12 }, rot: 0, params: { param: 1 } },
      },
    },
    {
      type: "addNode",
      payload: {
        node: { id: "node-2", type: "group", groupRef: "group-a", pos: { x: 14, y: 12 }, rot: 0, params: {} },
      },
    },
    {
      type: "addEdge",
      payload: {
        edge: {
          id: "edge-1",
          from: { nodeId: "node-1", portSlot: 0 },
          to: { nodeId: "node-2", portSlot: 0 },
          manualCorners: [{ x: 4, y: 2 }],
        },
      },
    },
  ]);
});

test("clipboard paste imports conflicting group definitions under a fresh id", () => {
  const payload = {
    schemaVersion: 1,
    bounds: { minX: 0, minY: 0, width: 0, height: 0 },
    nodes: [{ id: "node-a", type: "group", groupRef: "group-a", pos: { x: 0, y: 0 }, rot: 0, params: {} }],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Clipboard Group",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [],
      },
    },
  };
  const snapshot = {
    nodes: [],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Existing Group",
        graph: {
          nodes: [{ id: "inner-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } }],
          edges: [],
        },
        inputs: [],
        outputs: [],
        controls: [],
      },
    },
  };
  const counters = { node: 1, edge: 1, group: 1 };

  const result = instantiateClipboardSubgraph({
    snapshot,
    payload,
    targetPosition: { x: 0, y: 0 },
    createId(prefix) {
      const nextId = `${prefix}-${counters[prefix]}`;
      counters[prefix] += 1;
      return nextId;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ops[0].type, "addGroup");
  assert.equal(result.ops[0].payload.group.id, "group-1");
  assert.equal(result.ops[1].payload.node.groupRef, "group-1");
});

test("clipboard paste rewrites nested internal group refs when conflicting groups are renamed", () => {
  const payload = {
    schemaVersion: 1,
    bounds: { minX: 0, minY: 0, width: 0, height: 0 },
    nodes: [{ id: "node-a", type: "group", groupRef: "group-b", pos: { x: 0, y: 0 }, rot: 0, params: {} }],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Clipboard Child",
        graph: {
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [{ nodeId: "inner-a", paramKey: "param" }],
      },
      "group-b": {
        id: "group-b",
        name: "Clipboard Parent",
        graph: {
          nodes: [{ id: "inner-group", type: "group", groupRef: "group-a", pos: { x: 0, y: 0 }, rot: 0, params: {} }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-group", portSlot: 0 }],
        outputs: [{ nodeId: "inner-group", portSlot: 0 }],
        controls: [{ nodeId: "inner-group", controlSlot: 0 }],
      },
    },
  };
  const snapshot = {
    nodes: [],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Existing Child",
        graph: {
          nodes: [{ id: "inner-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } }],
          edges: [],
        },
        inputs: [],
        outputs: [],
        controls: [],
      },
      "group-b": {
        id: "group-b",
        name: "Existing Parent",
        graph: {
          nodes: [{ id: "inner-b", type: "out", pos: { x: 0, y: 0 }, rot: 0, params: {} }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-b", portSlot: 0 }],
        outputs: [],
        controls: [],
      },
    },
  };
  const counters = { node: 1, edge: 1, group: 1 };

  const result = instantiateClipboardSubgraph({
    snapshot,
    payload,
    targetPosition: { x: 0, y: 0 },
    createId(prefix) {
      const nextId = `${prefix}-${counters[prefix]}`;
      counters[prefix] += 1;
      return nextId;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ops[0].payload.group.id, "group-1");
  assert.equal(result.ops[1].payload.group.id, "group-2");
  assert.equal(result.ops[1].payload.group.graph.nodes[0].groupRef, "group-1");
  assert.equal(result.ops[2].payload.node.groupRef, "group-2");
});

test("createNodeRecord clamps params into the 1..8 range", () => {
  const definition = REGISTRY.getNodeDefinition("add");
  const node = createNodeRecord("node-a", { ...definition, defaultParam: 12 }, { x: 2.4, y: 3.6 });

  assert.equal(node.params.param, 8);
  assert.deepEqual(node.pos, { x: 2, y: 4 });
});

test("pulse node creation still uses the single public param for rate", () => {
  const definition = REGISTRY.getNodeDefinition("pulse");
  const node = createNodeRecord("node-a", { ...definition, defaultParam: 12 }, { x: 2.4, y: 3.6 });

  assert.deepEqual(node.params, { param: 8 });
});

test("edge normalization accepts either drag direction but preserves out-to-in graph edges", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "out", pos: { x: 4, y: 0 }, rot: 0, params: {} },
    ],
    edges: [],
    groups: {},
  };

  assert.deepEqual(
    normalizeEdgeEndpoints(
      { nodeId: "node-b", portSlot: 0, direction: "in" },
      { nodeId: "node-a", portSlot: 0, direction: "out" },
    ),
    {
      from: { nodeId: "node-a", portSlot: 0, direction: "out" },
      to: { nodeId: "node-b", portSlot: 0, direction: "in" },
    },
  );
  assert.equal(
    canCreateEdge(
      snapshot,
      REGISTRY,
      { nodeId: "node-b", portSlot: 0, direction: "in" },
      { nodeId: "node-a", portSlot: 0, direction: "out" },
    ),
    true,
  );
});

test("group bundle order and rewiring follow the spec", () => {
  const snapshot = {
    nodes: [
      { id: "node-in", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-mid", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
      { id: "node-out", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-internal",
        from: { nodeId: "node-in", portSlot: 0 },
        to: { nodeId: "node-mid", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-external",
        from: { nodeId: "node-mid", portSlot: 0 },
        to: { nodeId: "node-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };

  const result = buildCreateGroupOps({
    snapshot,
    registry: REGISTRY,
    groupSelection: { nodeIds: ["node-in", "node-mid"] },
    groupId: "group-a",
    groupName: "Group A",
    groupNodeId: "node-group",
    groupPosition: { x: 4, y: 2 },
    preserveInternalCableDelays: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.group.preserveInternalCableDelays, true);
  assert.deepEqual(
    result.ops.map((op) => op.type),
    ["addGroup", "addNode", "removeEdge", "removeEdge", "removeNode", "removeNode", "addEdge"],
  );
  assert.equal(result.ops.at(-1).payload.edge.from.nodeId, "node-group");
  assert.equal(result.ops.at(-1).payload.edge.to.nodeId, "node-out");
});

test("group updates shift connected control edges when signal inputs move", () => {
  const snapshot = {
    nodes: [
      { id: "node-source", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 0 }, rot: 0, params: {} },
      { id: "node-out", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-control",
        from: { nodeId: "node-source", portSlot: 0 },
        to: { nodeId: "node-group", portSlot: 2 },
        manualCorners: [],
      },
      {
        id: "edge-out",
        from: { nodeId: "node-group", portSlot: 0 },
        to: { nodeId: "node-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-add", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [
          { label: "Signal A", nodeId: "inner-add", portSlot: 0 },
          { label: "Signal B", nodeId: "inner-add", portSlot: 1 },
        ],
        outputs: [{ label: "Output", nodeId: "inner-add", portSlot: 0 }],
        controls: [{ label: "Param", nodeId: "inner-add", paramKey: "param" }],
      },
    },
  };

  const result = buildUpdateGroupOps({
    snapshot,
    groupId: "group-a",
    groupName: "Group A",
    preserveInternalCableDelays: false,
    mappings: {
      inputs: [{ label: "Signal A", nodeId: "inner-add", portSlot: 0 }],
      outputs: [{ label: "Output", nodeId: "inner-add", portSlot: 0 }],
      controls: [{ label: "Param", nodeId: "inner-add", paramKey: "param" }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.group.preserveInternalCableDelays, false);
  assert.deepEqual(result.ops.map((op) => op.type), ["removeEdge", "updateGroup", "addEdge"]);
  assert.equal(result.ops[0].payload.id, "edge-control");
  assert.equal(result.ops[2].payload.edge.id, "edge-control");
  assert.equal(result.ops[2].payload.edge.to.portSlot, 1);
});

test("group creation exposes child group control ports and rewires external control edges", () => {
  const snapshot = {
    nodes: [
      { id: "node-control", type: "pulse", pos: { x: 0, y: -2 }, rot: 0, params: { param: 1 } },
      { id: "node-input", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } },
      { id: "node-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 0 }, rot: 0, params: {} },
      { id: "node-output", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-internal",
        from: { nodeId: "node-input", portSlot: 0 },
        to: { nodeId: "node-group", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-control",
        from: { nodeId: "node-control", portSlot: 0 },
        to: { nodeId: "node-group", portSlot: 1 },
        manualCorners: [],
      },
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
          nodes: [{ id: "inner-a", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ nodeId: "inner-a", portSlot: 0 }],
        outputs: [{ nodeId: "inner-a", portSlot: 0 }],
        controls: [{ nodeId: "inner-a", paramKey: "param" }],
      },
    },
  };

  const result = buildCreateGroupOps({
    snapshot,
    registry: REGISTRY,
    groupSelection: { nodeIds: ["node-input", "node-group"] },
    groupId: "group-b",
    groupName: "Group B",
    groupNodeId: "node-parent-group",
    groupPosition: { x: 4, y: 0 },
  });

  assert.equal(result.ok, true);
  const nestedControlIndex = result.group.controls.findIndex(
    (entry) => entry.nodeId === "node-group" && entry.controlSlot === 0,
  );
  assert.ok(nestedControlIndex >= 0);
  const rewiredControlEdge = result.ops.find((op) => op.type === "addEdge" && op.payload.edge.id === "edge-control:group-control");
  assert.ok(rewiredControlEdge);
  assert.equal(rewiredControlEdge.payload.edge.to.nodeId, "node-parent-group");
  assert.equal(
    rewiredControlEdge.payload.edge.to.portSlot,
    result.group.inputs.length + nestedControlIndex,
  );
});

test("group creation does not expose internal control inputs that are already connected", () => {
  const snapshot = {
    nodes: [
      { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-add", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
      { id: "node-out", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-control",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-add", portSlot: 1 },
        manualCorners: [],
      },
      {
        id: "edge-out",
        from: { nodeId: "node-add", portSlot: 0 },
        to: { nodeId: "node-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };

  const result = buildCreateGroupOps({
    snapshot,
    registry: REGISTRY,
    groupSelection: { nodeIds: ["node-pulse", "node-add"] },
    groupId: "group-control-filter",
    groupName: "Group Control Filter",
    groupNodeId: "node-group",
    groupPosition: { x: 4, y: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.group.controls.some(
      (entry) => entry.nodeId === "node-add" && entry.controlSlot === 0,
    ),
    false,
  );

  const candidates = buildGroupCandidates(
    snapshot,
    { nodeIds: ["node-pulse", "node-add"] },
    REGISTRY,
  );
  assert.equal(candidates.controls.some((entry) => entry.nodeId === "node-add"), false);
  assert.equal(candidates.unavailable.controls.length, 1);
  assert.equal(candidates.unavailable.controls[0].nodeId, "node-add");
  assert.equal(candidates.unavailable.controls[0].controlSlot, 0);
  assert.equal(candidates.unavailable.controls[0].displaceInternalEdgeId, "edge-control");
  assert.equal(candidates.unavailable.controls[0].unavailableReason, "already driven internally");
});

test("group creation can explicitly expose a blocked control by displacing the internal control edge", () => {
  const snapshot = {
    nodes: [
      { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
      { id: "node-add", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
      { id: "node-out", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-control",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-add", portSlot: 1 },
        manualCorners: [],
      },
      {
        id: "edge-out",
        from: { nodeId: "node-add", portSlot: 0 },
        to: { nodeId: "node-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };

  const result = buildCreateGroupOps({
    snapshot,
    registry: REGISTRY,
    groupSelection: { nodeIds: ["node-pulse", "node-add"] },
    groupId: "group-control-displace",
    groupName: "Group Control Displace",
    groupNodeId: "node-group",
    groupPosition: { x: 4, y: 0 },
    mappings: {
      inputs: [],
      outputs: [{ id: "output:node-add:0", label: "Add output 1", nodeId: "node-add", portSlot: 0 }],
      controls: [
        {
          id: "control:node-add:slot:0",
          label: "Add param",
          nodeId: "node-add",
          controlSlot: 0,
          targetPortSlot: 1,
          displaceInternalEdgeId: "edge-control",
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.group.controls, [{ label: "Add param", nodeId: "node-add", controlSlot: 0 }]);
  assert.equal(result.group.graph.edges.some((edge) => edge.id === "edge-control"), false);
});

test("group updates can explicitly expose a blocked control by displacing the internal control edge", () => {
  const snapshot = {
    nodes: [],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [
            { id: "inner-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
            { id: "inner-add", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
          ],
          edges: [
            {
              id: "edge-control",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 1 },
              manualCorners: [],
            },
          ],
        },
        inputs: [],
        outputs: [{ label: "Output", nodeId: "inner-add", portSlot: 0 }],
        controls: [],
      },
    },
  };

  const result = buildUpdateGroupOps({
    snapshot,
    groupId: "group-a",
    groupName: "Group A",
    mappings: {
      inputs: [],
      outputs: [{ label: "Output", nodeId: "inner-add", portSlot: 0 }],
      controls: [
        {
          id: "control:inner-add:slot:0",
          label: "Add param",
          nodeId: "inner-add",
          controlSlot: 0,
          targetPortSlot: 1,
          displaceInternalEdgeId: "edge-control",
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.group.controls, [{ label: "Add param", nodeId: "inner-add", controlSlot: 0 }]);
  assert.equal(result.group.graph.edges.some((edge) => edge.id === "edge-control"), false);
});

test("group updates reject removing a slot that an instance edge still uses", () => {
  const snapshot = {
    nodes: [
      { id: "node-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 0 }, rot: 0, params: {} },
      { id: "node-out", type: "out", pos: { x: 8, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-out",
        from: { nodeId: "node-group", portSlot: 0 },
        to: { nodeId: "node-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [{ id: "inner-add", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } }],
          edges: [],
        },
        inputs: [{ label: "Signal A", nodeId: "inner-add", portSlot: 0 }],
        outputs: [{ label: "Output", nodeId: "inner-add", portSlot: 0 }],
        controls: [{ label: "Param", nodeId: "inner-add", paramKey: "param" }],
      },
    },
  };

  const result = buildUpdateGroupOps({
    snapshot,
    groupId: "group-a",
    groupName: "Group A",
    mappings: {
      inputs: [{ label: "Signal A", nodeId: "inner-add", portSlot: 0 }],
      outputs: [],
      controls: [{ label: "Param", nodeId: "inner-add", paramKey: "param" }],
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /removed slot/i);
});
