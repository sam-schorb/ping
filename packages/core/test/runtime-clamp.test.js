import test from "node:test";
import assert from "node:assert/strict";

import {
  createCompiledGraph,
  createRuntime,
  enqueueRuntimeEvent,
  loadRuntimeFixture,
} from "./helpers/runtime-fixtures.js";
import { RUNTIME_WARNING_CODES } from "../src/index.js";

test("runtime enforces minDelayTicks when an edge delay is zero", () => {
  const graph = createCompiledGraph({
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
        delay: 0,
      },
    ],
  });
  const runtime = createRuntime(graph, { minDelayTicks: 0.25 });

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.25,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});

test("speed modifies downstream effective delay without changing the pulse value", async () => {
  const graph = await loadRuntimeFixture("valid-speed.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 6), [
    {
      tick: 5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-b",
    },
  ]);
});

test("runtime clamps invalid event payloads and warns instead of throwing", () => {
  const graph = createCompiledGraph({
    nodes: [
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
        id: "edge-in",
        from: { nodeId: "node-external", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });
  const runtime = createRuntime(graph);

  enqueueRuntimeEvent(runtime, {
    tick: 0.5,
    nodeId: "node-output",
    edgeId: "edge-in",
    role: "signal",
    value: 99,
    speed: 99,
    params: { decay: 99, bad: Number.NaN },
    emitTime: 0,
  });

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 8,
      params: { decay: 8 },
      nodeId: "node-output",
      edgeId: "edge-in",
    },
  ]);
  assert.ok(
    runtime.warnings.some((warning) => warning.code === RUNTIME_WARNING_CODES.INVALID_VALUE),
  );
});
