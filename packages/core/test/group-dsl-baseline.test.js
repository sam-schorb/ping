import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  getLayout,
  getNodeDefinition,
  parseProject,
  routeProjectGraph,
  serialiseProject,
} from "../src/index.js";
import { createRuntime } from "./helpers/runtime-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createSimpleGroupedProject() {
  return {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: "node-control-source",
          type: "pulse",
          pos: { x: -4, y: -2 },
          rot: 0,
          params: {},
        },
        {
          id: "node-control",
          type: "set",
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
          id: "edge-control-source",
          from: { nodeId: "node-control-source", portSlot: 0 },
          to: { nodeId: "node-control", portSlot: 0 },
          manualCorners: [],
        },
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
                manualCorners: [],
              },
            ],
          },
          inputs: [],
          outputs: [{ nodeId: "inner-add", portSlot: 0 }],
          controls: [{ label: "amount", nodeId: "inner-add", paramKey: "param" }],
        },
      },
    },
  };
}

function createNestedGroupedProject() {
  return {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: "node-control-source",
          type: "pulse",
          pos: { x: -4, y: -2 },
          rot: 0,
          params: {},
        },
        {
          id: "node-control",
          type: "set",
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
          id: "edge-control-source",
          from: { nodeId: "node-control-source", portSlot: 0 },
          to: { nodeId: "node-control", portSlot: 0 },
          manualCorners: [],
        },
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
          controls: [{ label: "amount", nodeId: "inner-add", paramKey: "param" }],
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
          controls: [{ label: "amount", nodeId: "inner-group", controlSlot: 0 }],
        },
      },
    },
  };
}

function parseCanonicalProject(project) {
  const parsed = parseProject(project);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);

  const canonical = serialiseProject(parsed.project);
  return { parsed, canonical };
}

test("phase 2 canonicalizes legacy simple grouped controls onto controlSlot and real control inputs", () => {
  const { canonical } = parseCanonicalProject(createSimpleGroupedProject());

  assert.deepEqual(canonical.graph.groups["group-a"].controls, [
    { label: "amount", nodeId: "inner-add", controlSlot: 0 },
  ]);

  const routes = routeProjectGraph(canonical.graph, registry);

  assert.deepEqual(routes.errors ?? [], []);

  const result = buildGraph(canonical.graph, registry, routes.edgeDelays);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.nodes.map((node) => node.id),
    [
      "node-control-source",
      "node-control",
      "group-node::node::inner-pulse",
      "group-node::node::inner-add",
      "node-output",
    ],
  );

  const groupMeta = result.graph.groupMeta.groupsById.get("group-node");

  assert.deepEqual(groupMeta.externalOutputs, [
    {
      groupPortSlot: 0,
      nodeId: "group-node::node::inner-add",
      portSlot: 0,
    },
  ]);
  assert.deepEqual(groupMeta.controls, [
    {
      groupPortSlot: 0,
      nodeId: "group-node::node::inner-add",
      controlSlot: 0,
      portSlot: 1,
    },
  ]);
  assert.deepEqual(
    result.graph.edges.find((edge) => edge.id === "edge-control"),
    {
      id: "edge-control",
      from: { nodeId: "node-control", portSlot: 0 },
      to: { nodeId: "group-node::node::inner-add", portSlot: 1 },
      role: "control",
      delay: routes.edgeDelays.get("edge-control"),
    },
  );
});

test("phase 2 canonicalizes legacy nested grouped controls onto forwarded real control inputs", () => {
  const { canonical } = parseCanonicalProject(createNestedGroupedProject());

  assert.deepEqual(canonical.graph.groups["group-b"].controls, [
    { label: "amount", nodeId: "inner-group", controlSlot: 0 },
  ]);

  const routes = routeProjectGraph(canonical.graph, registry);

  assert.deepEqual(routes.errors ?? [], []);

  const result = buildGraph(canonical.graph, registry, routes.edgeDelays);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.graph.nodes.map((node) => node.id),
    [
      "node-control-source",
      "node-control",
      "group-node::node::inner-group::node::inner-pulse",
      "group-node::node::inner-group::node::inner-add",
      "node-output",
    ],
  );

  const groupMeta = result.graph.groupMeta.groupsById.get("group-node");

  assert.deepEqual(groupMeta.controls, [
    {
      groupPortSlot: 0,
      nodeId: "group-node::node::inner-group::node::inner-add",
      controlSlot: 0,
      portSlot: 1,
    },
  ]);
  assert.deepEqual(
    result.graph.edges.find((edge) => edge.id === "edge-control"),
    {
      id: "edge-control",
      from: { nodeId: "node-control", portSlot: 0 },
      to: { nodeId: "group-node::node::inner-group::node::inner-add", portSlot: 1 },
      role: "control",
      delay: routes.edgeDelays.get("edge-control"),
    },
  );
});

function createGroupedBlockProject() {
  return {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: "node-control-source",
          type: "pulse",
          pos: { x: -4, y: -4 },
          rot: 0,
          params: {},
        },
        {
          id: "node-control",
          type: "set",
          pos: { x: 0, y: -4 },
          rot: 0,
          params: { param: 1 },
        },
        {
          id: "node-pulse",
          type: "pulse",
          pos: { x: -4, y: 0 },
          rot: 0,
          params: {},
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
          id: "edge-control-source",
          from: { nodeId: "node-control-source", portSlot: 0 },
          to: { nodeId: "node-control", portSlot: 0 },
          manualCorners: [],
        },
        {
          id: "edge-control",
          from: { nodeId: "node-control", portSlot: 0 },
          to: { nodeId: "group-node", portSlot: 1 },
          manualCorners: [],
        },
        {
          id: "edge-signal",
          from: { nodeId: "node-pulse", portSlot: 0 },
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
          name: "Grouped Block",
          graph: {
            nodes: [
              {
                id: "inner-block",
                type: "block",
                pos: { x: 0, y: 0 },
                rot: 0,
                params: {},
              },
            ],
            edges: [],
          },
          inputs: [{ label: "in", nodeId: "inner-block", portSlot: 0 }],
          outputs: [{ label: "out", nodeId: "inner-block", portSlot: 0 }],
          controls: [{ label: "gate", nodeId: "inner-block", controlSlot: 0 }],
        },
      },
    },
  };
}

test("phase 2 grouped control routing/build/runtime goes through real control inputs end to end", () => {
  const { canonical } = parseCanonicalProject(createGroupedBlockProject());
  const routes = routeProjectGraph(canonical.graph, registry);

  assert.deepEqual(routes.errors ?? [], []);

  const built = buildGraph(canonical.graph, registry, routes.edgeDelays);

  assert.equal(built.ok, true);
  assert.deepEqual(
    built.graph.edges.find((edge) => edge.id === "edge-control"),
    {
      id: "edge-control",
      from: { nodeId: "node-control", portSlot: 0 },
      to: { nodeId: "group-node::node::inner-block", portSlot: 1 },
      role: "control",
      delay: routes.edgeDelays.get("edge-control"),
    },
  );

  const runtime = createRuntime(built.graph);

  const outputs = runtime.queryWindow(0, 30);

  assert.equal(outputs.length > 0, true);
  assert.deepEqual(
    runtime.graph.nodes[runtime.graph.nodeIndex.get("group-node::node::inner-block")].state,
    { allow: false },
  );
});
