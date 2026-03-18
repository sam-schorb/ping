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
          type: "output",
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
