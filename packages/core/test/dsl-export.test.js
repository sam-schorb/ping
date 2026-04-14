import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSemanticGroupIR,
  exportGroupDsl,
  getLayout,
  getNodeDefinition,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createGroupDefinition({
  id,
  name = id,
  nodes,
  edges = [],
  inputs = [],
  outputs = [],
  controls = [],
  preserveInternalCableDelays = false,
}) {
  return {
    id,
    name,
    preserveInternalCableDelays,
    graph: {
      nodes,
      edges,
    },
    inputs,
    outputs,
    controls,
  };
}

function createNode({
  id,
  type,
  x,
  y,
  param,
  name,
  groupRef,
}) {
  return {
    id,
    type,
    pos: { x, y },
    rot: 0,
    params:
      typeof param === "number"
        ? { param }
        : {},
    ...(name ? { name } : {}),
    ...(groupRef ? { groupRef } : {}),
  };
}

function createEdge(id, fromNodeId, fromPortSlot, toNodeId, toPortSlot) {
  return {
    id,
    from: { nodeId: fromNodeId, portSlot: fromPortSlot },
    to: { nodeId: toNodeId, portSlot: toPortSlot },
    manualCorners: [],
  };
}

function assertDsl(groupDefinition, expectedText, options = {}) {
  const result = exportGroupDsl(groupDefinition, registry, options);

  assert.equal(result.ok, true);
  assert.equal(result.text, expectedText);
}

test("exportGroupDsl renders a simple chain in canonical outlet form", () => {
  const group = createGroupDefinition({
    id: "group-simple-chain",
    nodes: [
      createNode({ id: "node-every", type: "every", x: 0, y: 0, param: 2 }),
      createNode({ id: "node-count", type: "count", x: 4, y: 0, param: 4 }),
    ],
    edges: [createEdge("edge-every-count", "node-every", 0, "node-count", 0)],
    inputs: [{ nodeId: "node-every", portSlot: 0 }],
    outputs: [{ nodeId: "node-count", portSlot: 0 }],
  });

  assertDsl(group, "$0.every(2).count(4).outlet(0)");
});

test("exportGroupDsl renders drop as a canonical single-stream chain node", () => {
  const group = createGroupDefinition({
    id: "group-drop",
    nodes: [createNode({ id: "node-drop", type: "drop", x: 0, y: 0, param: 3 })],
    inputs: [{ nodeId: "node-drop", portSlot: 0 }],
    outputs: [{ nodeId: "node-drop", portSlot: 0 }],
  });

  assertDsl(group, "$0.drop(3).outlet(0)");
});

test("exportGroupDsl renders step as a canonical single-stream chain node", () => {
  const group = createGroupDefinition({
    id: "group-step",
    nodes: [createNode({ id: "node-step", type: "step", x: 0, y: 0, param: 3 })],
    inputs: [{ nodeId: "node-step", portSlot: 0 }],
    outputs: [{ nodeId: "node-step", portSlot: 0 }],
  });

  assertDsl(group, "$0.step(3).outlet(0)");
});

test("exportGroupDsl renders control-only boundary inputs as braced control clauses", () => {
  const group = createGroupDefinition({
    id: "group-control-inlet",
    nodes: [
      createNode({ id: "node-pulse", type: "pulse", x: 0, y: 0, param: 3 }),
      createNode({ id: "node-every", type: "every", x: 4, y: 0, param: 2 }),
      createNode({ id: "node-out", type: "out", x: 8, y: 0 }),
    ],
    edges: [
      createEdge("edge-pulse-every", "node-pulse", 0, "node-every", 0),
      createEdge("edge-every-out", "node-every", 0, "node-out", 0),
    ],
    controls: [{ nodeId: "node-every", controlSlot: 0 }],
  });

  assertDsl(group, "pulse(3).every(2){$0}.out()");
});

test("exportGroupDsl binds mux nodes before indexed outlet usage", () => {
  const group = createGroupDefinition({
    id: "group-mux",
    nodes: [createNode({ id: "node-mux", type: "mux", x: 0, y: 0, name: "m" })],
    inputs: [{ nodeId: "node-mux", portSlot: 0 }],
    outputs: [
      { nodeId: "node-mux", portSlot: 0 },
      { nodeId: "node-mux", portSlot: 1 },
    ],
  });

  assertDsl(group, "m = $0.mux()\nm[0].outlet(0)\nm[1].outlet(1)");
});

test("exportGroupDsl falls back to explicit wires for demux inputs", () => {
  const group = createGroupDefinition({
    id: "group-demux",
    nodes: [createNode({ id: "node-demux", type: "demux", x: 4, y: 0, name: "d" })],
    inputs: [
      { nodeId: "node-demux", portSlot: 0 },
      { nodeId: "node-demux", portSlot: 1 },
    ],
    outputs: [{ nodeId: "node-demux", portSlot: 0 }],
  });

  assertDsl(group, "d = demux()\n$0.d[0]\n$1.d[1]\nd.outlet(0)");
});

test("exportGroupDsl renders switch control and indexed outputs canonically", () => {
  const group = createGroupDefinition({
    id: "group-switch",
    nodes: [
      createNode({ id: "node-switch", type: "switch", x: 0, y: 0, param: 2, name: "sw" }),
    ],
    inputs: [{ nodeId: "node-switch", portSlot: 0 }],
    outputs: [
      { nodeId: "node-switch", portSlot: 0 },
      { nodeId: "node-switch", portSlot: 3 },
    ],
    controls: [{ nodeId: "node-switch", controlSlot: 0 }],
  });

  assertDsl(group, "sw = $0.switch(2){$1}\nsw[0].outlet(0)\nsw[3].outlet(1)");
});

test("exportGroupDsl renders simple cycles as recursive bindings", () => {
  const group = createGroupDefinition({
    id: "group-cycle",
    nodes: [
      createNode({ id: "node-a", type: "every", x: 0, y: 0, param: 3, name: "a" }),
      createNode({ id: "node-b", type: "count", x: 4, y: 0, param: 4, name: "b" }),
    ],
    edges: [
      createEdge("edge-a-b", "node-a", 0, "node-b", 0),
      createEdge("edge-b-a-control", "node-b", 0, "node-a", 1),
    ],
    inputs: [{ nodeId: "node-a", portSlot: 0 }],
    outputs: [{ nodeId: "node-b", portSlot: 0 }],
  });

  assertDsl(group, "a = $0.every(3){b}\nb = a.count(4)\nb.outlet(0)");
});

test("exportGroupDsl uses explicit-wire fallback for multi-port merge shapes", () => {
  const group = createGroupDefinition({
    id: "group-explicit-wire",
    nodes: [
      createNode({ id: "node-mux", type: "mux", x: 0, y: 0, name: "m" }),
      createNode({ id: "node-a", type: "every", x: 4, y: -2, param: 2, name: "a" }),
      createNode({ id: "node-b", type: "count", x: 4, y: 2, param: 4, name: "b" }),
      createNode({ id: "node-demux", type: "demux", x: 8, y: 0, name: "d" }),
    ],
    edges: [
      createEdge("edge-m-a", "node-mux", 0, "node-a", 0),
      createEdge("edge-m-b", "node-mux", 1, "node-b", 0),
      createEdge("edge-a-d", "node-a", 0, "node-demux", 0),
      createEdge("edge-b-d", "node-b", 0, "node-demux", 1),
    ],
    inputs: [{ nodeId: "node-mux", portSlot: 0 }],
    outputs: [{ nodeId: "node-demux", portSlot: 0 }],
  });

  assertDsl(
    group,
    [
      "m = $0.mux()",
      "a = m[0].every(2)",
      "b = m[1].count(4)",
      "d = demux()",
      "a.d[0]",
      "b.d[1]",
      "d.outlet(0)",
    ].join("\n"),
  );
});

test("buildSemanticGroupIR expands nested groups inline and records provenance", () => {
  const child = createGroupDefinition({
    id: "group-child",
    nodes: [createNode({ id: "child-every", type: "every", x: 0, y: 0, param: 3 })],
    inputs: [{ nodeId: "child-every", portSlot: 0 }],
    outputs: [{ nodeId: "child-every", portSlot: 0 }],
    controls: [{ nodeId: "child-every", controlSlot: 0 }],
  });
  const parent = createGroupDefinition({
    id: "group-parent",
    nodes: [
      createNode({ id: "node-child", type: "group", x: 0, y: 0, groupRef: "group-child" }),
      createNode({ id: "node-count", type: "count", x: 4, y: 0, param: 4 }),
    ],
    edges: [createEdge("edge-child-count", "node-child", 0, "node-count", 0)],
    inputs: [{ nodeId: "node-child", portSlot: 0 }],
    outputs: [{ nodeId: "node-count", portSlot: 0 }],
    controls: [{ nodeId: "node-child", controlSlot: 0 }],
  });
  const result = buildSemanticGroupIR(parent, registry, {
    groups: {
      "group-child": child,
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.ir.nodes.map((node) => ({
      id: node.irNodeId,
      kind: node.origin.kind,
      groupPath: node.origin.groupPath,
      sourceNodeId: node.origin.sourceNodeId,
    })),
    [
      {
        id: "node-child::node::child-every",
        kind: "expanded-group",
        groupPath: ["group-child"],
        sourceNodeId: "child-every",
      },
      {
        id: "node-count",
        kind: "local",
        groupPath: [],
        sourceNodeId: "node-count",
      },
    ],
  );
  assert.deepEqual(
    result.ir.boundaryInputs.map((entry) => ({
      inletIndex: entry.inletIndex,
      kind: entry.kind,
      target: entry.target,
    })),
    [
      {
        inletIndex: 0,
        kind: "signal",
        target: {
          irNodeId: "node-child::node::child-every",
          signalSlot: 0,
        },
      },
      {
        inletIndex: 1,
        kind: "control",
        target: {
          irNodeId: "node-child::node::child-every",
          controlSlot: 0,
        },
      },
    ],
  );
});

test("exportGroupDsl renders expanded nested groups without surfaced groupRef syntax", () => {
  const child = createGroupDefinition({
    id: "group-child",
    nodes: [createNode({ id: "child-every", type: "every", x: 0, y: 0, param: 3 })],
    inputs: [{ nodeId: "child-every", portSlot: 0 }],
    outputs: [{ nodeId: "child-every", portSlot: 0 }],
    controls: [{ nodeId: "child-every", controlSlot: 0 }],
  });
  const parent = createGroupDefinition({
    id: "group-parent",
    nodes: [
      createNode({ id: "node-child", type: "group", x: 0, y: 0, groupRef: "group-child" }),
      createNode({ id: "node-count", type: "count", x: 4, y: 0, param: 4 }),
    ],
    edges: [createEdge("edge-child-count", "node-child", 0, "node-count", 0)],
    inputs: [{ nodeId: "node-child", portSlot: 0 }],
    outputs: [{ nodeId: "node-count", portSlot: 0 }],
    controls: [{ nodeId: "node-child", controlSlot: 0 }],
  });

  assertDsl(
    parent,
    "$0.every(3){$1}.count(4).outlet(0)",
    {
      groups: {
        "group-child": child,
      },
    },
  );
});

test("exportGroupDsl is deterministic for repeated exports of the same group", () => {
  const group = createGroupDefinition({
    id: "group-deterministic",
    nodes: [
      createNode({ id: "node-mux", type: "mux", x: 0, y: 0, name: "m" }),
      createNode({ id: "node-every", type: "every", x: 4, y: 0, param: 2, name: "a" }),
    ],
    edges: [createEdge("edge-mux-every", "node-mux", 0, "node-every", 0)],
    inputs: [{ nodeId: "node-mux", portSlot: 0 }],
    outputs: [{ nodeId: "node-every", portSlot: 0 }],
  });
  const first = exportGroupDsl(group, registry);
  const second = exportGroupDsl(group, registry);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.text, second.text);
});

test("exportGroupDsl normalizes legacy paramKey group controls before rendering", () => {
  const legacyGroup = createGroupDefinition({
    id: "group-legacy-control",
    nodes: [
      createNode({ id: "node-pulse", type: "pulse", x: 0, y: 0, param: 3 }),
      createNode({ id: "node-add", type: "add", x: 4, y: 0, param: 2 }),
    ],
    edges: [createEdge("edge-pulse-add", "node-pulse", 0, "node-add", 0)],
    outputs: [{ nodeId: "node-add", portSlot: 0 }],
    controls: [{ nodeId: "node-add", paramKey: "param" }],
  });

  assertDsl(legacyGroup, "pulse(3).add(2){$0}.outlet(0)");
});

test("exportGroupDsl rejects groups that drive one control slot from both inside and the boundary", () => {
  const invalidGroup = createGroupDefinition({
    id: "group-invalid-control-fan-in",
    nodes: [
      createNode({ id: "node-pulse", type: "pulse", x: 0, y: 0, param: 3 }),
      createNode({ id: "node-add", type: "add", x: 4, y: 0, param: 2 }),
    ],
    edges: [
      createEdge("edge-pulse-add-signal", "node-pulse", 0, "node-add", 0),
      createEdge("edge-pulse-add-control", "node-pulse", 0, "node-add", 1),
    ],
    outputs: [{ nodeId: "node-add", portSlot: 0 }],
    controls: [{ nodeId: "node-add", controlSlot: 0 }],
  });

  const result = exportGroupDsl(invalidGroup, registry);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "DSL_EXPORT_UNSUPPORTED_GRAPH");
  assert.match(result.errors[0].message, /multiple incoming sources/i);
});
