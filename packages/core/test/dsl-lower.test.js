import test from "node:test";
import assert from "node:assert/strict";

import {
  DSL_ERROR_CODES,
  buildGraph,
  getLayout,
  getNodeDefinition,
  lowerGroupDsl,
  routeProjectGraph,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function assertRoutesAndBuild(group) {
  const project = {
    nodes: [],
    edges: [],
    groups: {
      [group.id]: group,
    },
  };
  const routes = routeProjectGraph(project, registry);

  assert.deepEqual(routes.errors ?? [], []);

  const built = buildGraph(project, registry, routes.edgeDelays);

  assert.equal(built.ok, true);
}

test("lowerGroupDsl lowers a simple chain into a fresh valid group definition", () => {
  const result = lowerGroupDsl("$0.every(2).counter(4).outlet(0)", registry, {
    groupId: "group-simple-chain",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.group.graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      param: node.params.param,
      name: node.name,
    })),
    [
      { id: "node-1", type: "every", param: 2, name: undefined },
      { id: "node-2", type: "counter", param: 4, name: undefined },
    ],
  );
  assert.deepEqual(result.group.inputs, [{ nodeId: "node-1", portSlot: 0 }]);
  assert.deepEqual(result.group.controls, []);
  assert.deepEqual(result.group.outputs, [{ nodeId: "node-2", portSlot: 0 }]);
  assert.equal(result.group.graph.edges.length, 1);
  assertRoutesAndBuild(result.group);
});

test("lowerGroupDsl lowers stored params, control inlets, and .out() terminals", () => {
  const result = lowerGroupDsl("pulse(3).every(2){$0}.out()", registry, {
    groupId: "group-control-out",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.group.graph.nodes.map((node) => ({
      type: node.type,
      param: node.params.param,
    })),
    [
      { type: "pulse", param: 3 },
      { type: "every", param: 2 },
      { type: "out", param: undefined },
    ],
  );
  assert.deepEqual(result.group.inputs, []);
  assert.deepEqual(result.group.controls, [{ nodeId: "node-2", controlSlot: 0 }]);
  assert.equal(result.group.graph.edges.length, 2);
  assert.deepEqual(
    result.group.graph.edges.map((edge) => edge.to),
    [
      { nodeId: "node-2", portSlot: 0 },
      { nodeId: "node-3", portSlot: 0 },
    ],
  );
  assertRoutesAndBuild(result.group);
});

test("lowerGroupDsl lowers recursive bindings into a build-valid feedback graph", () => {
  const source = [
    "a = $0.every(3){m[0]}",
    "b = a.counter(4)",
    "m = b.mux()",
    "m[1].outlet(0)",
  ].join("\n");
  const result = lowerGroupDsl(source, registry, {
    groupId: "group-cycle",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.group.graph.nodes.map((node) => ({
      type: node.type,
      name: node.name,
      param: node.params.param,
    })),
    [
      { type: "every", name: "a", param: 3 },
      { type: "counter", name: "b", param: 4 },
      { type: "mux", name: "m", param: undefined },
    ],
  );
  assert.deepEqual(result.group.inputs, [{ nodeId: "node-1", portSlot: 0 }]);
  assert.deepEqual(result.group.controls, []);
  assert.deepEqual(result.group.outputs, [{ nodeId: "node-3", portSlot: 1 }]);
  assert.deepEqual(
    result.group.graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
    })),
    [
      {
        from: { nodeId: "node-1", portSlot: 0 },
        to: { nodeId: "node-2", portSlot: 0 },
      },
      {
        from: { nodeId: "node-2", portSlot: 0 },
        to: { nodeId: "node-3", portSlot: 0 },
      },
      {
        from: { nodeId: "node-3", portSlot: 0 },
        to: { nodeId: "node-1", portSlot: 1 },
      },
    ],
  );
  assertRoutesAndBuild(result.group);
});

test("lowerGroupDsl lowers explicit wires and indexed ports canonically", () => {
  const source = ["d = demux()", "$0.d[0]", "$1.d[1]", "d.outlet(0)"].join("\n");
  const result = lowerGroupDsl(source, registry, {
    groupId: "group-demux",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.group.inputs, [
    { nodeId: "node-1", portSlot: 0 },
    { nodeId: "node-1", portSlot: 1 },
  ]);
  assert.deepEqual(result.group.outputs, [{ nodeId: "node-1", portSlot: 0 }]);
  assert.deepEqual(result.group.controls, []);
  assert.equal(result.group.graph.edges.length, 0);
  assertRoutesAndBuild(result.group);
});

test("lowerGroupDsl lowers switch outputs and mixed signal/control boundary inlets", () => {
  const source = ["sw = $0.switch(2){$1}", "sw[0].outlet(0)", "sw[3].outlet(1)"].join(
    "\n",
  );
  const result = lowerGroupDsl(source, registry, {
    groupId: "group-switch",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.group.inputs, [{ nodeId: "node-1", portSlot: 0 }]);
  assert.deepEqual(result.group.controls, [{ nodeId: "node-1", controlSlot: 0 }]);
  assert.deepEqual(result.group.outputs, [
    { nodeId: "node-1", portSlot: 0 },
    { nodeId: "node-1", portSlot: 3 },
  ]);
  assertRoutesAndBuild(result.group);
});

test("lowerGroupDsl rejects mixed signal/control use of the same inlet index", () => {
  const result = lowerGroupDsl("$0.every(2){$0}.outlet(0)", registry);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, DSL_ERROR_CODES.LOWER_INVALID_INLET_USAGE);
});

test("lowerGroupDsl rejects gapped outlet numbering", () => {
  const result = lowerGroupDsl("$0.every(2).outlet(1)", registry);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, DSL_ERROR_CODES.LOWER_GAPPED_OUTLET);
});

test("lowerGroupDsl rejects invalid indexed port references", () => {
  const result = lowerGroupDsl(["m = $0.mux()", "m[6].outlet(0)"].join("\n"), registry);

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, DSL_ERROR_CODES.LOWER_INVALID_PORT_INDEX);
});

test("lowerGroupDsl rejects invalid param clauses", () => {
  const blockParam = lowerGroupDsl("$0.block(2).outlet(0)", registry);

  assert.equal(blockParam.ok, false);
  assert.equal(blockParam.errors[0].code, DSL_ERROR_CODES.LOWER_INVALID_PARAM_BLOCK);

  const outOfRangeParam = lowerGroupDsl("$0.every(0).outlet(0)", registry);

  assert.equal(outOfRangeParam.ok, false);
  assert.equal(
    outOfRangeParam.errors[0].code,
    DSL_ERROR_CODES.LOWER_INVALID_PARAM_BLOCK,
  );
});
