import test from "node:test";
import assert from "node:assert/strict";

import { buildGraph, getLayout, getNodeDefinition } from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("buildGraph merges snapshot params with registry defaults and initState", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-block",
        type: "block",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-add",
        type: "add",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: { param: 6 },
      },
    ],
    edges: [],
  };
  const result = buildGraph(snapshot, registry, new Map());

  assert.equal(result.ok, true);
  assert.deepEqual(result.graph.nodes, [
    {
      id: "node-block",
      type: "block",
      param: 1,
      state: { allow: true },
      inputs: 1,
      outputs: 1,
      controlPorts: 1,
    },
    {
      id: "node-add",
      type: "add",
      param: 6,
      state: {},
      inputs: 1,
      outputs: 1,
      controlPorts: 1,
    },
  ]);
});
