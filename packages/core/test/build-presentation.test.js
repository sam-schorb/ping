import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  createGroupDelaySourceId,
  getLayout,
  getNodeDefinition,
} from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function sortEntries(entries) {
  return [...entries].sort((left, right) => left[0].localeCompare(right[0]));
}

test("buildGraph emits presentation maps for top-level visible nodes and edges", async () => {
  const fixture = await loadBuildFixture("valid-min.json");
  const result = buildGraph(fixture, registry, new Map([["edge-a", 1]]));

  assert.equal(result.ok, true);
  assert.deepEqual(
    sortEntries(Array.from(result.graph.presentation.visibleNodeIdByCompiledNodeId.entries())),
    [
      ["node-output", "node-output"],
      ["node-pulse", "node-pulse"],
    ],
  );
  assert.deepEqual(
    sortEntries(Array.from(result.graph.presentation.visibleEdgeIdByCompiledEdgeId.entries())),
    [["edge-a", "edge-a"]],
  );
  assert.deepEqual(
    sortEntries(
      Array.from(result.graph.presentation.collapsedOwnerNodeIdByCompiledEdgeId.entries()),
    ),
    [],
  );
});

test("buildGraph emits presentation maps for nested grouped activity ownership", () => {
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
  const result = buildGraph(
    snapshot,
    registry,
    new Map([
      [createGroupDelaySourceId("group-a", "inner-edge"), 1.5],
      ["edge-control", 0.75],
      ["edge-out", 2.25],
    ]),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    sortEntries(Array.from(result.graph.presentation.visibleNodeIdByCompiledNodeId.entries())),
    [
      ["group-node::node::inner-group::node::inner-add", "group-node"],
      ["group-node::node::inner-group::node::inner-pulse", "group-node"],
      ["node-control", "node-control"],
      ["node-output", "node-output"],
    ],
  );
  assert.deepEqual(
    sortEntries(Array.from(result.graph.presentation.visibleEdgeIdByCompiledEdgeId.entries())),
    [
      ["edge-control", "edge-control"],
      ["edge-out", "edge-out"],
    ],
  );
  assert.deepEqual(
    sortEntries(
      Array.from(result.graph.presentation.collapsedOwnerNodeIdByCompiledEdgeId.entries()),
    ),
    [["group-node::edge::inner-group::edge::inner-edge", "group-node"]],
  );
});
