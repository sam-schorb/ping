import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, getLayout, getNodeDefinition } from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function serialiseCompiledGraph(graph) {
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    edgesByNodeId: Array.from(graph.edgesByNodeId.entries()),
    edgesByPortId: Array.from(graph.edgesByPortId.entries()),
    nodeIndex: Array.from(graph.nodeIndex.entries()),
    edgeIndex: Array.from(graph.edgeIndex.entries()),
    groupMeta:
      graph.groupMeta &&
      Array.from(graph.groupMeta.groupsById.entries()),
    debug:
      graph.debug && {
        nodeIdToSourceId: Array.from(graph.debug.nodeIdToSourceId.entries()),
        edgeIdToSourceId: Array.from(graph.debug.edgeIdToSourceId.entries()),
      },
  };
}

test("buildGraph compiles a valid graph into a stable runtime-ready graph", async () => {
  const fixture = await loadBuildFixture("valid-min.json");
  const delays = new Map([["edge-a", 2.5]]);

  const first = buildGraph(fixture, registry, delays);
  const second = buildGraph(fixture, registry, delays);

  assert.equal(first.ok, true);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(serialiseCompiledGraph(first.graph), serialiseCompiledGraph(second.graph));
  assert.deepEqual(first.graph.nodes, [
    {
      id: "node-pulse",
      type: "pulse",
      param: 5,
      state: {},
      inputs: 1,
      outputs: 1,
      controlPorts: 1,
    },
    {
      id: "node-output",
      type: "output",
      param: 1,
      state: {},
      inputs: 1,
      outputs: 0,
      controlPorts: 0,
    },
  ]);
  assert.deepEqual(first.graph.edges, [
    {
      id: "edge-a",
      from: { nodeId: "node-pulse", portSlot: 0 },
      to: { nodeId: "node-output", portSlot: 0 },
      role: "signal",
      delay: 2.5,
    },
  ]);
});
