import test from "node:test";
import assert from "node:assert/strict";

import { createCompiledGraph, createRuntime, loadRuntimeFixture } from "./helpers/runtime-fixtures.js";

test("runtime applies control events before signals at the same node and tick", async () => {
  const graph = await loadRuntimeFixture("valid-control-first.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.75,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
  ]);
  assert.equal(runtime.graph.nodes[runtime.graph.nodeIndex.get("node-counter")].param, 2);
  assert.equal(
    runtime.graph.nodes[runtime.graph.nodeIndex.get("node-counter")].state.count,
    1,
  );
});

test("same-tick signal ordering stays deterministic for identical runs", () => {
  const graph = createCompiledGraph({
    nodes: [
      {
        id: "node-a",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "node-b",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "node-output",
        type: "out",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 0,
        controlPorts: 0,
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
      {
        id: "edge-b",
        from: { nodeId: "node-b", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });

  const first = createRuntime(graph);
  const second = createRuntime(graph);
  const firstOutputs = first.queryWindow(0, 1);

  assert.deepEqual(firstOutputs, [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-b",
    },
  ]);
  assert.deepEqual(second.queryWindow(0, 1), firstOutputs);
});

test("pulse rate multipliers stay phase-locked on shared master-clock downbeats", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-a",
          type: "pulse",
          param: 3,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-b",
          type: "pulse",
          param: 5,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-output",
          type: "out",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 0,
          controlPorts: 0,
        },
      ],
      edges: [
        {
          id: "edge-a",
          from: { nodeId: "node-a", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
        {
          id: "edge-b",
          from: { nodeId: "node-b", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  const outputs = runtime.queryWindow(0, 2.2);

  assert.deepEqual(
    outputs.filter((event) => event.tick === 0.5),
    [
      {
        tick: 0.5,
        value: 1,
        nodeId: "node-output",
        edgeId: "edge-a",
      },
      {
        tick: 0.5,
        value: 1,
        nodeId: "node-output",
        edgeId: "edge-b",
      },
    ],
  );
  assert.deepEqual(
    outputs.filter((event) => event.tick === 1.5),
    [
      {
        tick: 1.5,
        value: 1,
        nodeId: "node-output",
        edgeId: "edge-a",
      },
      {
        tick: 1.5,
        value: 1,
        nodeId: "node-output",
        edgeId: "edge-b",
      },
    ],
  );
});

test("control changes on pulse nodes snap the next pulse to the future rate lattice", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-rate-source",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-pulse",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-rate",
          type: "set",
          param: 3,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-output",
          type: "out",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 0,
          controlPorts: 0,
        },
      ],
      edges: [
        {
          id: "edge-rate-source",
          from: { nodeId: "node-rate-source", portSlot: 0 },
          to: { nodeId: "node-rate", portSlot: 0 },
          role: "signal",
          delay: 0,
        },
        {
          id: "edge-out",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
        {
          id: "edge-control",
          from: { nodeId: "node-rate", portSlot: 0 },
          to: { nodeId: "node-pulse", portSlot: 1 },
          role: "control",
          delay: 1.1,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 3), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
    {
      tick: 1.8333333333333333,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
    {
      tick: 2.166666666666667,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
    {
      tick: 2.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
    {
      tick: 2.8333333333333335,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
  ]);
  assert.equal(
    runtime.graph.nodes[runtime.graph.nodeIndex.get("node-pulse")].param,
    3,
  );
});

test("control edges targeting real control ports invoke onControl handlers", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-control",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-pulse",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
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
          id: "node-output",
          type: "out",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 0,
          controlPorts: 0,
        },
      ],
      edges: [
        {
          id: "edge-signal",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-block", portSlot: 0 },
          role: "signal",
          delay: 1,
        },
        {
          id: "edge-control",
          from: { nodeId: "node-control", portSlot: 0 },
          to: { nodeId: "node-block", portSlot: 1 },
          role: "control",
          delay: 0.5,
        },
        {
          id: "edge-out",
          from: { nodeId: "node-block", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.queryWindow(1, 2), []);
  assert.deepEqual(
    runtime.graph.nodes[runtime.graph.nodeIndex.get("node-block")].state,
    { allow: false },
  );
});
