import test from "node:test";
import assert from "node:assert/strict";

import {
  NODE_REGISTRY,
  getGroupLayout,
  getLayout,
  createGroupedNodeDefinition,
} from "../src/index.js";

test("every registry node derives a layout matching its declared counts", () => {
  for (const definition of NODE_REGISTRY) {
    const layout = getLayout(
      definition.layout,
      definition.inputs,
      definition.outputs,
      definition.controlPorts,
    );

    assert.equal(
      layout.inputs.length,
      definition.inputs + definition.controlPorts,
      definition.type,
    );
    assert.equal(layout.outputs.length, definition.outputs, definition.type);
  }
});

test("multi-out and multi-in archetypes preserve the fixed global port ordering", () => {
  const multiOut = getLayout("multi-out-6", 1, 6, 0);
  const multiIn = getLayout("multi-in-6", 6, 1, 0);
  const mirroredMultiIn = getLayout("multi-in-6-mirrored", 6, 1, 0);

  assert.deepEqual(
    multiOut.outputs.map((port) => [port.index, port.side, port.sideSlot]),
    [
      [0, "top", 1],
      [1, "top", 2],
      [2, "right", 1],
      [3, "right", 2],
      [4, "bottom", 2],
      [5, "bottom", 1],
    ],
  );
  assert.deepEqual(
    multiIn.inputs.map((port) => [port.index, port.side, port.sideSlot]),
    [
      [0, "top", 1],
      [1, "top", 2],
      [2, "right", 1],
      [3, "right", 2],
      [4, "bottom", 2],
      [5, "bottom", 1],
    ],
  );
  assert.deepEqual(
    mirroredMultiIn.inputs.map((port) => [port.index, port.side, port.sideSlot]),
    [
      [0, "top", 2],
      [1, "top", 1],
      [2, "left", 1],
      [3, "left", 2],
      [4, "bottom", 1],
      [5, "bottom", 2],
    ],
  );
});

test("grouped-node helpers derive custom layouts from group definitions", () => {
  const groupDefinition = {
    id: "group-a",
    name: "Group A",
    inputs: [{ nodeId: "n1", portSlot: 0 }, { nodeId: "n2", portSlot: 0 }],
    outputs: [{ nodeId: "n3", portSlot: 0 }, { nodeId: "n4", portSlot: 0 }],
    controls: [{ nodeId: "n5", paramKey: "param" }],
  };

  const layout = getGroupLayout(groupDefinition);
  const groupedNode = createGroupedNodeDefinition(groupDefinition, {
    description: "Base group node",
  });

  assert.deepEqual(
    layout.inputs.map((port) => [port.role, port.index, port.side]),
    [
      ["signal", 0, "left"],
      ["signal", 1, "left"],
      ["control", 2, "left"],
    ],
  );
  assert.deepEqual(
    layout.outputs.map((port) => [port.role, port.index, port.side]),
    [
      ["signal", 0, "right"],
      ["signal", 1, "right"],
    ],
  );
  assert.equal(groupedNode.type, "group");
  assert.equal(groupedNode.label, "Group A");
  assert.equal(groupedNode.inputs, 2);
  assert.equal(groupedNode.outputs, 2);
  assert.equal(groupedNode.controlPorts, 1);
});

test("getLayout throws on unknown archetypes", () => {
  assert.throws(() => getLayout("unknown-layout", 0, 0, 0), {
    message: 'Unknown node layout "unknown-layout".',
  });
});
