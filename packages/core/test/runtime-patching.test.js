import test from "node:test";
import assert from "node:assert/strict";

import { createCompiledGraphPatch } from "../src/index.js";
import { createCompiledGraph, createRuntime } from "./helpers/runtime-fixtures.js";

function createPulseToOutputGraph(delay = 3, rate = 1) {
  return createCompiledGraph({
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        param: rate,
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
        delay,
      },
    ],
  });
}

function createOrderSensitivePatchGraphs() {
  return {
    previousGraph: createCompiledGraph({
      nodes: [
        {
          id: "node-control-old",
          type: "pulse",
          param: 7,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-signal",
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
          id: "edge-control-old",
          from: { nodeId: "node-control-old", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 1 },
          role: "control",
          delay: 2,
        },
        {
          id: "edge-signal",
          from: { nodeId: "node-signal", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 0 },
          role: "signal",
          delay: 3,
        },
        {
          id: "edge-out",
          from: { nodeId: "node-add", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
    nextGraph: createCompiledGraph({
      nodes: [
        {
          id: "node-control-new",
          type: "pulse",
          param: 3,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-control-old",
          type: "pulse",
          param: 7,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-signal",
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
          id: "edge-control-new",
          from: { nodeId: "node-control-new", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 2 },
          role: "control",
          delay: 2,
        },
        {
          id: "edge-control-old",
          from: { nodeId: "node-control-old", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 1 },
          role: "control",
          delay: 2,
        },
        {
          id: "edge-signal",
          from: { nodeId: "node-signal", portSlot: 0 },
          to: { nodeId: "node-add", portSlot: 0 },
          role: "signal",
          delay: 3,
        },
        {
          id: "edge-out",
          from: { nodeId: "node-add", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  };
}

test("createCompiledGraphPatch captures incremental node and edge changes", () => {
  const previousGraph = createCompiledGraph({
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
        to: { nodeId: "node-add", portSlot: 0 },
        role: "signal",
        delay: 3,
      },
      {
        id: "edge-b",
        from: { nodeId: "node-add", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });
  const nextGraph = createCompiledGraph({
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
        id: "node-add",
        type: "add",
        param: 4,
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
        delay: 5,
      },
      {
        id: "edge-c",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 1,
      },
    ],
  });

  assert.deepEqual(createCompiledGraphPatch(previousGraph, nextGraph), {
    removedNodes: [],
    removedEdges: ["edge-b"],
    addedNodes: [],
    addedEdges: [
      {
        id: "edge-c",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 1,
      },
    ],
    updatedEdges: [{ edgeId: "edge-a", delay: 5 }],
    updatedParams: [
      { nodeId: "node-pulse", param: 3 },
      { nodeId: "node-add", param: 4 },
    ],
    nodeOrder: ["node-pulse", "node-add", "node-output"],
    edgeOrder: ["edge-a", "edge-c"],
  });
});

test("createCompiledGraphPatch re-adds an edge when the previous endpoint node was removed but the edge id is reused", () => {
  const previousGraph = createCompiledGraph({
    nodes: [
      {
        id: "group-node::node::pulse",
        type: "pulse",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "group-node::node::out",
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
        id: "group-node::edge::inner",
        from: { nodeId: "group-node::node::pulse", portSlot: 0 },
        to: { nodeId: "group-node::node::out", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
    ],
  });
  const nextGraph = createCompiledGraph({
    nodes: [
      {
        id: "group-node::node::pulse",
        type: "pulse",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "group-node::node::every",
        type: "every",
        param: 2,
        state: { count: 1 },
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    edges: [
      {
        id: "group-node::edge::inner",
        from: { nodeId: "group-node::node::pulse", portSlot: 0 },
        to: { nodeId: "group-node::node::every", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
    ],
  });

  assert.deepEqual(createCompiledGraphPatch(previousGraph, nextGraph), {
    removedNodes: ["group-node::node::out"],
    removedEdges: ["group-node::edge::inner"],
    addedNodes: [
      {
        id: "group-node::node::every",
        type: "every",
        param: 2,
        state: { count: 1 },
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    addedEdges: [
      {
        id: "group-node::edge::inner",
        from: { nodeId: "group-node::node::pulse", portSlot: 0 },
        to: { nodeId: "group-node::node::every", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
    ],
    updatedEdges: [],
    updatedParams: [],
    nodeOrder: ["group-node::node::pulse", "group-node::node::every"],
    edgeOrder: ["group-node::edge::inner"],
  });
});

test("updated edge delays reschedule pending events outside the protected window", () => {
  const runtime = createRuntime(createPulseToOutputGraph(3));

  assert.deepEqual(runtime.queryWindow(0, 1), []);

  runtime.applyPatch({
    updatedEdges: [{ edgeId: "edge-a", delay: 5 }],
  });

  assert.deepEqual(runtime.queryWindow(1, 5), []);
  assert.deepEqual(runtime.queryWindow(5, 6), [
    {
      tick: 5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});

test("applyPatch preserves outlet-emission pulses for ordinary grouped nodes after replacing an internal sink with an outlet path", () => {
  const previousGraph = createCompiledGraph({
    nodes: [
      {
        id: "group-node::node::pulse",
        type: "pulse",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "group-node::node::out",
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
        id: "group-node::edge::inner",
        from: { nodeId: "group-node::node::pulse", portSlot: 0 },
        to: { nodeId: "group-node::node::out", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
    ],
    groupMeta: {
      groupsById: [
        [
          "group-node",
          {
            nodeIds: ["group-node::node::pulse", "group-node::node::out"],
            edgeIds: ["group-node::edge::inner"],
            externalInputs: [],
            externalOutputs: [],
            controls: [],
          },
        ],
      ],
    },
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["group-node::node::pulse", "group-node"],
        ["group-node::node::out", "group-node"],
      ],
      visibleEdgeIdByCompiledEdgeId: [],
      collapsedOwnerNodeIdByCompiledEdgeId: [["group-node::edge::inner", "group-node"]],
    },
  });
  const nextGraph = createCompiledGraph({
    nodes: [
      {
        id: "group-node::node::pulse",
        type: "pulse",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "group-node::node::every",
        type: "every",
        param: 2,
        state: { count: 1 },
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    edges: [
      {
        id: "group-node::edge::inner",
        from: { nodeId: "group-node::node::pulse", portSlot: 0 },
        to: { nodeId: "group-node::node::every", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
    ],
    groupMeta: {
      groupsById: [
        [
          "group-node",
          {
            nodeIds: ["group-node::node::pulse", "group-node::node::every"],
            edgeIds: ["group-node::edge::inner"],
            externalInputs: [],
            externalOutputs: [
              {
                groupPortSlot: 0,
                nodeId: "group-node::node::every",
                portSlot: 0,
              },
            ],
            controls: [],
          },
        ],
      ],
    },
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["group-node::node::pulse", "group-node"],
        ["group-node::node::every", "group-node"],
      ],
      visibleEdgeIdByCompiledEdgeId: [],
      collapsedOwnerNodeIdByCompiledEdgeId: [["group-node::edge::inner", "group-node"]],
    },
  });

  const runtime = createRuntime(previousGraph);

  runtime.applyPatch(createCompiledGraphPatch(previousGraph, nextGraph));
  runtime.queryWindow(0, 1);

  assert.deepEqual(runtime.getPresentedActivity(1, 1), {
    thumbs: [],
    nodePulseStates: [],
    collapsedEdgeActivityOwners: [],
  });
});

test("updated params affect already-scheduled events when they are processed", () => {
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
        id: "node-add",
        type: "add",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 0,
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
        delay: 3,
      },
      {
        id: "edge-b",
        from: { nodeId: "node-add", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });
  const runtime = createRuntime(graph);

  assert.deepEqual(runtime.queryWindow(0, 1), []);

  runtime.applyPatch({
    updatedParams: [{ nodeId: "node-add", param: 4 }],
  });

  assert.deepEqual(runtime.queryWindow(1, 4), [
    {
      tick: 3.5,
      value: 5,
      nodeId: "node-output",
      edgeId: "edge-b",
    },
  ]);
});

test("updated pulse params reschedule future pulse seeds onto the new master-clock lattice", () => {
  const previousGraph = createPulseToOutputGraph(0.5, 1);
  const nextGraph = createPulseToOutputGraph(0.5, 3);
  const runtime = createRuntime(previousGraph);

  assert.deepEqual(runtime.queryWindow(0, 1.2), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);

  runtime.applyPatch(createCompiledGraphPatch(previousGraph, nextGraph));

  assert.deepEqual(runtime.queryWindow(1.2, 2.3), [
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
    {
      tick: 1.8333333333333333,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
    {
      tick: 2.166666666666667,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});

test("adding a pulse node through applyPatch seeds it immediately", () => {
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
      edges: [],
    }),
  );

  runtime.applyPatch({
    addedNodes: [
      {
        id: "node-pulse",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    addedEdges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});

test("adding a pulse node through applyPatch inherits the global pulse phase", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-pulse-a",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-output-a",
          type: "out",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 0,
          controlPorts: 0,
        },
        {
          id: "node-output-b",
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
          from: { nodeId: "node-pulse-a", portSlot: 0 },
          to: { nodeId: "node-output-a", portSlot: 0 },
          role: "signal",
          delay: 0.5,
        },
      ],
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1.2), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output-a",
      edgeId: "edge-a",
    },
  ]);

  runtime.applyPatch({
    addedNodes: [
      {
        id: "node-pulse-b",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    addedEdges: [
      {
        id: "edge-b",
        from: { nodeId: "node-pulse-b", portSlot: 0 },
        to: { nodeId: "node-output-b", portSlot: 0 },
        role: "signal",
        delay: 0.5,
      },
    ],
  });

  assert.deepEqual(runtime.queryWindow(1.2, 2), [
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output-a",
      edgeId: "edge-a",
    },
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output-b",
      edgeId: "edge-b",
    },
  ]);
  assert.deepEqual(runtime.warnings, []);
});

test("applyPatch preserves next compiled node order for same-tick control precedence", () => {
  const { previousGraph, nextGraph } = createOrderSensitivePatchGraphs();
  const patch = createCompiledGraphPatch(previousGraph, nextGraph);
  const patchedRuntime = createRuntime(previousGraph);
  const replacedRuntime = createRuntime(nextGraph);

  patchedRuntime.applyPatch(patch);

  assert.deepEqual(patchedRuntime.queryWindow(0, 4), replacedRuntime.queryWindow(0, 4));
});

test("removing a node drops pending events targeting that node or its edges", () => {
  const runtime = createRuntime(createPulseToOutputGraph(3));

  assert.deepEqual(runtime.queryWindow(0, 1), []);

  runtime.applyPatch({
    removedNodes: ["node-output"],
  });

  assert.deepEqual(runtime.queryWindow(1, 4), []);
});

test("resetPulses clears in-flight work and re-seeds pulse nodes at the current cursor", () => {
  const runtime = createRuntime(createPulseToOutputGraph(0.5));

  assert.deepEqual(runtime.queryWindow(0, 1), [
    {
      tick: 0.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);

  runtime.resetPulses();

  assert.deepEqual(runtime.queryWindow(1, 2), [
    {
      tick: 1.5,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-a",
    },
  ]);
});
