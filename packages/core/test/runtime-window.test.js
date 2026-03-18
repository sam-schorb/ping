import test from "node:test";
import assert from "node:assert/strict";

import {
  createCompiledGraph,
  createRuntime,
  loadRuntimeFixture,
} from "./helpers/runtime-fixtures.js";
import { createRingBufferScheduler } from "../src/index.js";

test("queryWindow drains newly scheduled events inside the current window", async () => {
  const graph = await loadRuntimeFixture("valid-min.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
  assert.equal(runtime.getMetrics().lastTickProcessed, 1);
  assert.equal(runtime.scheduler.peekMinTick(), 1);
});

test("queryWindow is half-open and leaves boundary events for the next call", async () => {
  const graph = await loadRuntimeFixture("valid-min.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 0.5), []);
  assert.deepEqual(runtime.queryWindow(0.5, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
  assert.equal(runtime.getMetrics().lastTickProcessed, 1);
});

test("pulse sources emit on phase-locked fractional grids when a rate multiplier is set", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-pulse",
          type: "pulse",
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
    {
      tick: 0.5 + 1 / 3,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});

test("queryWindow catches up pulse sources when the first window starts in the future", async () => {
  const graph = await loadRuntimeFixture("valid-min.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(1, 2), [
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
  assert.equal(runtime.getMetrics().lastTickProcessed, 2);
  assert.equal(runtime.scheduler.peekMinTick(), 2);
});

test("setGraph clears scheduler state even when the scheduler omits clear()", async () => {
  const graph = await loadRuntimeFixture("valid-min.json");
  const scheduler = createRingBufferScheduler();

  scheduler.clear = undefined;
  scheduler.size = undefined;

  const runtime = createRuntime(graph, { scheduler });

  assert.deepEqual(runtime.queryWindow(0, 0.5), []);

  runtime.setGraph(
    createCompiledGraph({
      nodes: [],
      edges: [],
    }),
  );

  assert.equal(scheduler.peekMinTick(), null);
  assert.deepEqual(runtime.queryWindow(0.5, 1), []);
});
