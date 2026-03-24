import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  createGroupDelaySourceId,
  getLayout,
  getNodeDefinition,
  routeProjectGraph,
} from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createGroupedDelaySnapshot(preserveInternalCableDelays = false) {
  return {
    nodes: [
      {
        id: "node-group",
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
        preserveInternalCableDelays,
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
        outputs: [
          { nodeId: "inner-add", portSlot: 0 },
        ],
        controls: [],
      },
    },
  };
}

function createNestedGroupedDelaySnapshot({
  parentPreserveInternalCableDelays = false,
  childPreserveInternalCableDelays = false,
} = {}) {
  return {
    nodes: [
      {
        id: "node-group",
        type: "group",
        groupRef: "group-b",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output",
        type: "out",
        pos: { x: 10, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
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
        name: "Inner Group",
        preserveInternalCableDelays: childPreserveInternalCableDelays,
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
            {
              id: "inner-input",
              type: "add",
              pos: { x: 4, y: 2 },
              rot: 0,
              params: { param: 2 },
            },
          ],
          edges: [
            {
              id: "child-edge",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
        inputs: [{ nodeId: "inner-input", portSlot: 0 }],
        outputs: [{ nodeId: "inner-add", portSlot: 0 }],
        controls: [],
      },
      "group-b": {
        id: "group-b",
        name: "Outer Group",
        preserveInternalCableDelays: parentPreserveInternalCableDelays,
        graph: {
          nodes: [
            {
              id: "parent-pulse",
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: { param: 2 },
            },
            {
              id: "child-group",
              type: "group",
              groupRef: "group-a",
              pos: { x: 4, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [
            {
              id: "parent-edge",
              from: { nodeId: "parent-pulse", portSlot: 0 },
              to: { nodeId: "child-group", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
        inputs: [],
        outputs: [{ nodeId: "child-group", portSlot: 0 }],
        controls: [],
      },
    },
  };
}

test("buildGraph preserves raw float delays from routing output", async () => {
  const fixture = await loadBuildFixture("valid-min.json");
  const result = buildGraph(fixture, registry, new Map([["edge-a", 3.75]]));

  assert.equal(result.ok, true);
  assert.equal(result.graph.edges[0].delay, 3.75);
});

test("routeProjectGraph merges instantiated group-internal delays needed by buildGraph", () => {
  const snapshot = createGroupedDelaySnapshot(false);
  const innerDelaySourceId = createGroupDelaySourceId("group-a", "inner-edge");

  const routed = routeProjectGraph(snapshot, registry);
  const result = buildGraph(snapshot, registry, routed.edgeDelays);

  assert.equal(routed.edgeDelays.has(innerDelaySourceId), true);
  assert.equal(routed.edgeDelays.has("edge-out"), true);
  assert.equal(routed.edgeDelays.get(innerDelaySourceId), 0);
  assert.equal(result.ok, true);
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "node-group::edge::inner-edge")?.delay,
    0,
  );
});

test("routeProjectGraph preserves grouped internal delays when requested", () => {
  const snapshot = createGroupedDelaySnapshot(true);
  const innerDelaySourceId = createGroupDelaySourceId("group-a", "inner-edge");

  const routed = routeProjectGraph(snapshot, registry);
  const result = buildGraph(snapshot, registry, routed.edgeDelays);

  assert.equal(routed.edgeDelays.has(innerDelaySourceId), true);
  assert.ok(routed.edgeDelays.get(innerDelaySourceId) > 0);
  assert.equal(result.ok, true);
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "node-group::edge::inner-edge")?.delay,
    routed.edgeDelays.get(innerDelaySourceId),
  );
});

test("routeProjectGraph composes nested group delays using each owning group's preserve flag", () => {
  const snapshot = createNestedGroupedDelaySnapshot({
    parentPreserveInternalCableDelays: false,
    childPreserveInternalCableDelays: true,
  });
  const childDelaySourceId = createGroupDelaySourceId("group-a", "child-edge");
  const parentDelaySourceId = createGroupDelaySourceId("group-b", "parent-edge");

  const routed = routeProjectGraph(snapshot, registry);
  const result = buildGraph(snapshot, registry, routed.edgeDelays);

  assert.equal(routed.errors, undefined);
  assert.ok(routed.edgeDelays.get(childDelaySourceId) > 0);
  assert.equal(routed.edgeDelays.get(parentDelaySourceId), 0);
  assert.equal(result.ok, true);
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "node-group::edge::child-group::edge::child-edge")?.delay,
    routed.edgeDelays.get(childDelaySourceId),
  );
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "node-group::edge::parent-edge")?.delay,
    0,
  );
});

test("group-internal delay keys do not overwrite top-level edge delays when ids collide", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-group",
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
        id: "edge-1",
        from: { nodeId: "node-group", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [{ x: 6, y: 0 }],
      },
    ],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        preserveInternalCableDelays: false,
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
              pos: { x: 4, y: 0 },
              rot: 0,
              params: { param: 3 },
            },
          ],
          edges: [
            {
              id: "edge-1",
              from: { nodeId: "inner-pulse", portSlot: 0 },
              to: { nodeId: "inner-add", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
        inputs: [],
        outputs: [{ nodeId: "inner-add", portSlot: 0 }],
        controls: [],
      },
    },
  };
  const innerDelaySourceId = createGroupDelaySourceId("group-a", "edge-1");

  const routed = routeProjectGraph(snapshot, registry);
  const result = buildGraph(snapshot, registry, routed.edgeDelays);

  assert.equal(routed.edgeDelays.get("edge-1") > 0, true);
  assert.equal(routed.edgeDelays.get(innerDelaySourceId), 0);
  assert.equal(result.ok, true);
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "edge-1")?.delay,
    routed.edgeDelays.get("edge-1"),
  );
  assert.equal(
    result.graph.edges.find((edge) => edge.id === "node-group::edge::edge-1")?.delay,
    0,
  );
});
