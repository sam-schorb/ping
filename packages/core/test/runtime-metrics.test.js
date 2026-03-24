import test from "node:test";
import assert from "node:assert/strict";

import { createCompiledGraph, createRuntime, loadRuntimeFixture } from "./helpers/runtime-fixtures.js";

test("runtime metrics track processed events, scheduled events, queue size, and last tick", async () => {
  const graph = await loadRuntimeFixture("valid-min.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.getMetrics(), {
    eventsProcessed: 0,
    eventsScheduled: 1,
    queueSize: 1,
    lastTickProcessed: 0,
  });

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
  assert.deepEqual(runtime.getMetrics(), {
    eventsProcessed: 2,
    eventsScheduled: 3,
    queueSize: 1,
    lastTickProcessed: 1,
  });
});

test("thumb state reflects in-flight edge progress and excludes internal pulse seeds", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
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
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 2,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.getThumbState(1), [
    {
      edgeId: "edge-a",
      progress: 0.5,
      speed: 1,
      emitTick: 0,
    },
  ]);
});

test("node pulse state tracks recent signal receipts on the pulse input", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
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
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
  assert.deepEqual(runtime.getNodePulseState(0.6, 1), [
    {
      nodeId: "node-output",
      progress: 0.09999999999999998,
      receivedTick: 0.5,
    },
    {
      nodeId: "node-pulse",
      progress: 0.6,
      receivedTick: 0,
    },
  ]);
  assert.deepEqual(runtime.getNodePulseState(0.6, 0.4), [
    {
      nodeId: "node-output",
      progress: 0.24999999999999994,
      receivedTick: 0.5,
    },
  ]);
});

test("presented node pulse state tracks emitters on output and sinks on consumption", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
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
          id: "node-add",
          type: "add",
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
          id: "edge-a",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
        {
          id: "edge-b",
          from: { nodeId: "node-add", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 0.6), []);
  assert.deepEqual(runtime.getPresentedNodePulseState(0.6, 1), [
    {
      nodeId: "node-add",
      progress: 0.09999999999999998,
      receivedTick: 0.5,
    },
    {
      nodeId: "node-pulse",
      progress: 0.6,
      receivedTick: 0,
    },
  ]);

  assert.deepEqual(runtime.queryWindow(0.6, 1.1), [
    {
      tick: 1,
      value: 4,
      nodeId: "node-output",
      edgeId: "edge-b",
    },
  ]);
  assert.deepEqual(runtime.getPresentedNodePulseState(1.1, 1), [
    {
      nodeId: "node-add",
      progress: 0.6000000000000001,
      receivedTick: 0.5,
    },
    {
      nodeId: "node-output",
      progress: 0.10000000000000009,
      receivedTick: 1,
    },
    {
      nodeId: "node-pulse",
      progress: 0.10000000000000009,
      receivedTick: 1,
    },
  ]);
});

test("presented node pulse state does not pulse filtering nodes when they drop an input", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
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
          id: "node-every",
          type: "every",
          param: 2,
          state: { count: 1 },
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
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-every", portSlot: 0 },
          role: "signal",
          delay: 0,
        },
        {
          id: "edge-b",
          from: { nodeId: "node-every", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.getPresentedNodePulseState(1, 1), [
    {
      nodeId: "node-pulse",
      progress: 1,
      receivedTick: 0,
    },
  ]);

  assert.deepEqual(runtime.queryWindow(1, 1.1), []);
  assert.deepEqual(runtime.getPresentedNodePulseState(1.1, 1), [
    {
      nodeId: "node-every",
      progress: 0.0990000000000002,
      receivedTick: 1.001,
    },
    {
      nodeId: "node-pulse",
      progress: 0.10000000000000009,
      receivedTick: 1,
    },
  ]);
});
