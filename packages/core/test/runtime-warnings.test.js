import test from "node:test";
import assert from "node:assert/strict";

import {
  createCompiledGraph,
  createRuntime,
  enqueueRuntimeEvent,
  loadRuntimeFixture,
} from "./helpers/runtime-fixtures.js";
import { RUNTIME_WARNING_CODES } from "../src/index.js";

test("missing target nodes are dropped with RUNTIME_MISSING_NODE warnings", async () => {
  const graph = await loadRuntimeFixture("invalid-missing-node.json");
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.warnings.map((warning) => warning.code), [
    RUNTIME_WARNING_CODES.MISSING_NODE,
  ]);
});

test("missing edges and missing node types warn without hard-failing performance", () => {
  const runtime = createRuntime(
    createCompiledGraph({
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
        {
          id: "node-weird",
          type: "missing-type",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 0,
        },
      ],
      edges: [
        {
          id: "edge-type",
          from: { nodeId: "node-external", portSlot: 0 },
          to: { nodeId: "node-weird", portSlot: 0 },
          role: "signal",
          delay: 0.25,
        },
      ],
    }),
  );

  enqueueRuntimeEvent(runtime, {
    tick: 0.25,
    nodeId: "node-output",
    edgeId: "missing-edge",
    role: "signal",
    value: 4,
    speed: 1,
    emitTime: 0,
  });
  enqueueRuntimeEvent(runtime, {
    tick: 0.5,
    nodeId: "node-weird",
    edgeId: "edge-type",
    role: "signal",
    value: 4,
    speed: 1,
    emitTime: 0,
  });

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.ok(
    runtime.warnings.some((warning) => warning.code === RUNTIME_WARNING_CODES.MISSING_EDGE),
  );
  assert.ok(
    runtime.warnings.some((warning) => warning.code === RUNTIME_WARNING_CODES.MISSING_TYPE),
  );
});

test("late events are dropped with RUNTIME_LATE_EVENT warnings", () => {
  const runtime = createRuntime(
    createCompiledGraph({
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
    }),
  );

  enqueueRuntimeEvent(runtime, {
    tick: 0.5,
    nodeId: "node-output",
    edgeId: "edge-in",
    role: "signal",
    value: 3,
    speed: 1,
    emitTime: 0,
  });

  assert.deepEqual(runtime.queryWindow(1, 2), []);
  assert.ok(
    runtime.warnings.some((warning) => warning.code === RUNTIME_WARNING_CODES.LATE_EVENT),
  );
});

test("queue overflow emits warnings instead of throwing", () => {
  const runtime = createRuntime(
    createCompiledGraph({
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
          param: 2,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
      ],
      edges: [],
    }),
    {
      schedulerOptions: { maxEvents: 1 },
    },
  );

  assert.ok(
    runtime.warnings.some((warning) => warning.code === RUNTIME_WARNING_CODES.QUEUE_OVERFLOW),
  );
  assert.equal(runtime.getMetrics().queueSize, 1);
});
