import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  createGroupDelaySourceId,
  getLayout,
  getNodeDefinition,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph flattens groups, preserves group metadata, and rewires control mappings", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-control",
        type: "pulse",
        pos: { x: 0, y: -2 },
        rot: 0,
        params: { param: 7 },
      },
      {
        id: "group-node",
        type: "group",
        groupRef: "group-a",
        pos: { x: 4, y: 0 },
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
        id: "edge-control",
        from: { nodeId: "node-control", portSlot: 0 },
        to: { nodeId: "group-node", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-out",
        from: { nodeId: "group-node", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Grouped Add",
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
              id: "inner-edge",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 0 },
              manualCorners: []
            }
          ]
        },
        "inputs": [],
        "outputs": [
          { "nodeId": "inner-add", "portSlot": 0 }
        ],
        "controls": [
          { "nodeId": "inner-add", "controlSlot": 0 }
        ]
      }
    }
  };
  const delays = new Map([
    [createGroupDelaySourceId("group-a", "inner-edge"), 1.5],
    ["edge-control", 0.75],
    ["edge-out", 2.25],
  ]);

  const result = buildGraph(snapshot, registry, delays);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.nodes.map((node) => node.id),
    [
      "node-control",
      "group-node::node::inner-pulse",
      "group-node::node::inner-add",
      "node-output",
    ],
  );
  assert.deepEqual(
    result.graph.edges.map((edge) => edge.id),
    ["group-node::edge::inner-edge", "edge-control", "edge-out"],
  );
  assert.deepEqual(result.graph.edges[0], {
    id: "group-node::edge::inner-edge",
    from: { nodeId: "group-node::node::inner-pulse", portSlot: 0 },
    to: { nodeId: "group-node::node::inner-add", portSlot: 0 },
    role: "signal",
    delay: 1.5,
  });
  assert.deepEqual(result.graph.edges[1], {
    id: "edge-control",
    from: { nodeId: "node-control", portSlot: 0 },
    to: { nodeId: "group-node::node::inner-add", portSlot: 1 },
    role: "control",
    delay: 0.75,
  });
  assert.deepEqual(result.graph.groupMeta.groupsById.get("group-node"), {
    nodeIds: [
      "group-node::node::inner-pulse",
      "group-node::node::inner-add",
    ],
    edgeIds: ["group-node::edge::inner-edge"],
    externalInputs: [],
    externalOutputs: [
      {
        groupPortSlot: 0,
        nodeId: "group-node::node::inner-add",
        portSlot: 0,
      },
    ],
    controls: [
      {
        groupPortSlot: 0,
        nodeId: "group-node::node::inner-add",
        controlSlot: 0,
        portSlot: 1,
      },
    ],
  });
});

test("buildGraph recursively flattens nested groups and composes child control mappings", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-control",
        type: "pulse",
        pos: { x: 0, y: -2 },
        rot: 0,
        params: { param: 7 },
      },
      {
        id: "group-node",
        type: "group",
        groupRef: "group-b",
        pos: { x: 4, y: 0 },
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
        id: "edge-control",
        from: { nodeId: "node-control", portSlot: 0 },
        to: { nodeId: "group-node", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-out",
        from: { nodeId: "group-node", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Inner Group",
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
              id: "inner-edge",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
        inputs: [],
        outputs: [{ nodeId: "inner-add", portSlot: 0 }],
        controls: [{ nodeId: "inner-add", controlSlot: 0 }],
      },
      "group-b": {
        id: "group-b",
        name: "Outer Group",
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
        controls: [{ nodeId: "inner-group", controlSlot: 0 }],
      },
    },
  };
  const delays = new Map([
    [createGroupDelaySourceId("group-a", "inner-edge"), 1.5],
    ["edge-control", 0.75],
    ["edge-out", 2.25],
  ]);

  const result = buildGraph(snapshot, registry, delays);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.nodes.map((node) => node.id),
    [
      "node-control",
      "group-node::node::inner-group::node::inner-pulse",
      "group-node::node::inner-group::node::inner-add",
      "node-output",
    ],
  );
  assert.deepEqual(
    result.graph.edges.map((edge) => edge.id),
    ["group-node::edge::inner-group::edge::inner-edge", "edge-control", "edge-out"],
  );
  assert.deepEqual(result.graph.edges[1], {
    id: "edge-control",
    from: { nodeId: "node-control", portSlot: 0 },
    to: { nodeId: "group-node::node::inner-group::node::inner-add", portSlot: 1 },
    role: "control",
    delay: 0.75,
  });
  assert.deepEqual(result.graph.groupMeta.groupsById.get("group-node"), {
    nodeIds: [
      "group-node::node::inner-group::node::inner-pulse",
      "group-node::node::inner-group::node::inner-add",
    ],
    edgeIds: ["group-node::edge::inner-group::edge::inner-edge"],
    externalInputs: [],
    externalOutputs: [
      {
        groupPortSlot: 0,
        nodeId: "group-node::node::inner-group::node::inner-add",
        portSlot: 0,
      },
    ],
    controls: [
      {
        groupPortSlot: 0,
        nodeId: "group-node::node::inner-group::node::inner-add",
        controlSlot: 0,
        portSlot: 1,
      },
    ],
  });
});
