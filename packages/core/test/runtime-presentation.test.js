import test from "node:test";
import assert from "node:assert/strict";

import {
  createCompiledGraphPatch,
  projectNodePulseState,
  projectRuntimeActivity,
  projectThumbState,
} from "../src/index.js";
import { createCompiledGraph, createRuntime } from "./helpers/runtime-fixtures.js";

test("projectNodePulseState maps internal compiled node pulses onto the owning collapsed node", () => {
  const graph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::inner-pulse",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    edges: [],
    groupMeta: {
      groupsById: [
        [
          "node-code",
          {
            nodeIds: ["node-code::node::inner-pulse"],
            externalInputs: [],
            externalOutputs: [],
            controls: [],
          },
        ],
      ],
    },
  });

  assert.deepEqual(
    projectNodePulseState(graph, [
      {
        nodeId: "node-code::node::inner-pulse",
        progress: 0.25,
        receivedTick: 12,
      },
    ]),
    [
      {
        nodeId: "node-code",
        progress: 0.25,
        receivedTick: 12,
      },
    ],
  );
});

test("projectNodePulseState prefers the most recent internal pulse when multiple compiled nodes collapse to one owner", () => {
  const graph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::inner-a",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "node-code::node::inner-b",
        type: "every",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
    ],
    edges: [],
    groupMeta: {
      groupsById: [
        [
          "node-code",
          {
            nodeIds: [
              "node-code::node::inner-a",
              "node-code::node::inner-b",
            ],
            externalInputs: [],
            externalOutputs: [],
            controls: [],
          },
        ],
      ],
    },
  });

  assert.deepEqual(
    projectNodePulseState(graph, [
      {
        nodeId: "node-code::node::inner-a",
        progress: 0.7,
        receivedTick: 10,
      },
      {
        nodeId: "node-code::node::inner-b",
        progress: 0.1,
        receivedTick: 11,
      },
    ]),
    [
      {
        nodeId: "node-code",
        progress: 0.1,
        receivedTick: 11,
      },
    ],
  );
});

test("runtime exposes projected node pulse state for collapsed code nodes", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-code::node::inner-pulse",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
      ],
      edges: [],
      presentation: {
        visibleNodeIdByCompiledNodeId: [
          ["node-code::node::inner-pulse", "node-code"],
        ],
        visibleEdgeIdByCompiledEdgeId: [],
        collapsedOwnerNodeIdByCompiledEdgeId: [],
      },
      groupMeta: {
        groupsById: [
          [
            "node-code",
            {
              nodeIds: ["node-code::node::inner-pulse"],
              externalInputs: [],
              externalOutputs: [],
              controls: [],
            },
          ],
        ],
      },
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 0.1), []);
  assert.deepEqual(runtime.getNodePulseState(0.1, 1), [
    {
      nodeId: "node-code::node::inner-pulse",
      progress: 0.1,
      receivedTick: 0,
    },
  ]);
  assert.deepEqual(runtime.getProjectedNodePulseState(0.1, 1), [
    {
      nodeId: "node-code",
      progress: 0.1,
      receivedTick: 0,
    },
  ]);
});

test("runtime patching refreshes group metadata so projected pulse state works after live code edits", () => {
  const previousGraph = createCompiledGraph({
    nodes: [],
    edges: [],
    groupMeta: {
      groupsById: [
        [
          "node-code",
          {
            nodeIds: [],
            externalInputs: [],
            externalOutputs: [],
            controls: [],
          },
        ],
      ],
    },
    presentation: {
      visibleNodeIdByCompiledNodeId: [],
      visibleEdgeIdByCompiledEdgeId: [],
      collapsedOwnerNodeIdByCompiledEdgeId: [],
    },
  });
  const nextGraph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::inner-pulse",
        type: "pulse",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      ],
      edges: [],
      presentation: {
        visibleNodeIdByCompiledNodeId: [
          ["node-code::node::inner-pulse", "node-code"],
        ],
        visibleEdgeIdByCompiledEdgeId: [],
        collapsedOwnerNodeIdByCompiledEdgeId: [],
      },
      groupMeta: {
        groupsById: [
        [
          "node-code",
          {
            nodeIds: ["node-code::node::inner-pulse"],
            externalInputs: [],
            externalOutputs: [],
            controls: [],
          },
        ],
      ],
    },
  });
  const runtime = createRuntime(previousGraph);

  runtime.applyPatch(createCompiledGraphPatch(previousGraph, nextGraph));

  assert.deepEqual(runtime.queryWindow(0, 0.1), []);
  assert.deepEqual(runtime.getProjectedNodePulseState(0.1, 1), [
    {
      nodeId: "node-code",
      progress: 0.1,
      receivedTick: 0,
    },
  ]);
});

test("projectThumbState keeps visible thumbs and omits internal-only compiled edges", () => {
  const graph = createCompiledGraph({
    nodes: [],
    edges: [],
    presentation: {
      visibleNodeIdByCompiledNodeId: [],
      visibleEdgeIdByCompiledEdgeId: [["edge-visible", "edge-visible"]],
      collapsedOwnerNodeIdByCompiledEdgeId: [["group-node::edge::inner", "group-node"]],
    },
  });

  assert.deepEqual(
    projectThumbState(graph, [
      { edgeId: "group-node::edge::inner", progress: 0.5, speed: 1, emitTick: 0 },
      { edgeId: "edge-visible", progress: 0.25, speed: 1, emitTick: 1 },
    ]),
    [{ edgeId: "edge-visible", progress: 0.25, speed: 1, emitTick: 1 }],
  );
  assert.deepEqual(
    projectRuntimeActivity(graph, {
      thumbs: [
        { edgeId: "group-node::edge::inner", progress: 0.5, speed: 1, emitTick: 0 },
        { edgeId: "edge-visible", progress: 0.25, speed: 1, emitTick: 1 },
      ],
      nodePulseStates: [],
    }),
    {
      thumbs: [{ edgeId: "edge-visible", progress: 0.25, speed: 1, emitTick: 1 }],
      nodePulseStates: [],
      collapsedEdgeActivityOwners: ["group-node"],
    },
  );
});

test("runtime exposes presented activity through the generic compiled-to-visible projection layer", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-code::node::inner-pulse",
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
          id: "edge-out",
          from: { nodeId: "node-code::node::inner-pulse", portSlot: 0 },
          to: { nodeId: "node-output", portSlot: 0 },
          role: "signal",
          delay: 2,
        },
      ],
      presentation: {
        visibleNodeIdByCompiledNodeId: [
          ["node-code::node::inner-pulse", "node-code"],
          ["node-output", "node-output"],
        ],
        visibleEdgeIdByCompiledEdgeId: [["edge-out", "edge-out"]],
        collapsedOwnerNodeIdByCompiledEdgeId: [],
      },
      groupMeta: {
        groupsById: [
          [
            "node-code",
            {
              nodeIds: ["node-code::node::inner-pulse"],
              edgeIds: [],
              externalInputs: [],
              externalOutputs: [
                {
                  groupPortSlot: 0,
                  nodeId: "node-code::node::inner-pulse",
                  portSlot: 0,
                },
              ],
              controls: [],
            },
          ],
        ],
      },
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.getPresentedActivity(1, 1), {
    thumbs: [{ edgeId: "edge-out", progress: 0.5, speed: 1, emitTick: 0 }],
    nodePulseStates: [{ nodeId: "node-code", progress: 1, receivedTick: 0 }],
    collapsedEdgeActivityOwners: [],
  });
});

test("collapsed code owners stay quiet when an internal mapped outlet emits but no visible external edge event is scheduled", () => {
  const runtime = createRuntime(
    createCompiledGraph({
      nodes: [
        {
          id: "node-code::node::inner-pulse",
          type: "pulse",
          param: 1,
          state: {},
          inputs: 1,
          outputs: 1,
          controlPorts: 1,
        },
        {
          id: "node-code::node::inner-every",
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
          id: "node-code::edge::inner-edge",
          from: { nodeId: "node-code::node::inner-pulse", portSlot: 0 },
          to: { nodeId: "node-code::node::inner-every", portSlot: 0 },
          role: "signal",
          delay: 0,
        },
      ],
      groupMeta: {
        groupsById: [
          [
            "node-code",
            {
              nodeIds: [
                "node-code::node::inner-pulse",
                "node-code::node::inner-every",
              ],
              edgeIds: ["node-code::edge::inner-edge"],
              externalInputs: [],
              externalOutputs: [
                {
                  groupPortSlot: 0,
                  nodeId: "node-code::node::inner-every",
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
          ["node-code::node::inner-pulse", "node-code"],
          ["node-code::node::inner-every", "node-code"],
        ],
        visibleEdgeIdByCompiledEdgeId: [],
        collapsedOwnerNodeIdByCompiledEdgeId: [["node-code::edge::inner-edge", "node-code"]],
      },
    }),
  );

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.deepEqual(runtime.getPresentedActivity(1, 1), {
    thumbs: [],
    nodePulseStates: [],
    collapsedEdgeActivityOwners: [],
  });

  assert.deepEqual(runtime.queryWindow(1, 1.1), []);
  assert.deepEqual(runtime.getPresentedActivity(1.1, 1), {
    thumbs: [],
    nodePulseStates: [],
    collapsedEdgeActivityOwners: [],
  });
});

test("runtime patching preserves in-flight visible cable thumbs when a visible edge is rewired to a new internal source", () => {
  const previousGraph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::a",
        type: "pulse",
        param: 2,
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
        id: "edge-out",
        from: { nodeId: "node-code::node::a", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 6,
      },
    ],
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["node-code::node::a", "node-code"],
        ["node-output", "node-output"],
      ],
      visibleEdgeIdByCompiledEdgeId: [["edge-out", "edge-out"]],
      collapsedOwnerNodeIdByCompiledEdgeId: [],
    },
  });
  const nextGraph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::a",
        type: "pulse",
        param: 2,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "node-code::node::b",
        type: "every",
        param: 2,
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
        id: "node-code::edge::edge-inner",
        from: { nodeId: "node-code::node::a", portSlot: 0 },
        to: { nodeId: "node-code::node::b", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
      {
        id: "edge-out",
        from: { nodeId: "node-code::node::b", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 6,
      },
    ],
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["node-code::node::a", "node-code"],
        ["node-code::node::b", "node-code"],
        ["node-output", "node-output"],
      ],
      visibleEdgeIdByCompiledEdgeId: [["edge-out", "edge-out"]],
      collapsedOwnerNodeIdByCompiledEdgeId: [["node-code::edge::edge-inner", "node-code"]],
    },
  });
  const runtime = createRuntime(previousGraph);

  assert.deepEqual(runtime.queryWindow(0, 1), []);
  assert.equal(runtime.getPresentedActivity(1, 1).thumbs.length > 0, true);

  runtime.applyPatch(createCompiledGraphPatch(previousGraph, nextGraph));

  assert.equal(runtime.getPresentedActivity(1, 1).thumbs.length > 0, true);
});

test("runtime patching lets preserved visible-edge events arrive and clear instead of sticking at the outlet", () => {
  const previousGraph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::a",
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
        id: "edge-out",
        from: { nodeId: "node-code::node::a", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 6,
      },
    ],
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["node-code::node::a", "node-code"],
        ["node-output", "node-output"],
      ],
      visibleEdgeIdByCompiledEdgeId: [["edge-out", "edge-out"]],
      collapsedOwnerNodeIdByCompiledEdgeId: [],
    },
  });
  const nextGraph = createCompiledGraph({
    nodes: [
      {
        id: "node-code::node::a",
        type: "add",
        param: 1,
        state: {},
        inputs: 1,
        outputs: 1,
        controlPorts: 1,
      },
      {
        id: "node-code::node::b",
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
        id: "node-code::edge::edge-inner",
        from: { nodeId: "node-code::node::a", portSlot: 0 },
        to: { nodeId: "node-code::node::b", portSlot: 0 },
        role: "signal",
        delay: 0,
      },
      {
        id: "edge-out",
        from: { nodeId: "node-code::node::b", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        role: "signal",
        delay: 6,
      },
    ],
    presentation: {
      visibleNodeIdByCompiledNodeId: [
        ["node-code::node::a", "node-code"],
        ["node-code::node::b", "node-code"],
        ["node-output", "node-output"],
      ],
      visibleEdgeIdByCompiledEdgeId: [["edge-out", "edge-out"]],
      collapsedOwnerNodeIdByCompiledEdgeId: [["node-code::edge::edge-inner", "node-code"]],
    },
  });
  const runtime = createRuntime(previousGraph);

  runtime.enqueueEvent({
    tick: 6,
    nodeId: "node-output",
    edgeId: "edge-out",
    role: "signal",
    value: 1,
    speed: 1,
    params: {},
    emitTime: 0,
    __seq: 999,
  });

  runtime.applyPatch(createCompiledGraphPatch(previousGraph, nextGraph));

  assert.equal(runtime.getPresentedActivity(1, 1).thumbs.length > 0, true);
  assert.deepEqual(runtime.queryWindow(0, 7), [
    {
      tick: 6,
      value: 1,
      nodeId: "node-output",
      edgeId: "edge-out",
    },
  ]);
  assert.equal(runtime.getPresentedActivity(7, 1).thumbs.length, 0);
});
