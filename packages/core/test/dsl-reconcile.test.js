import test from "node:test";
import assert from "node:assert/strict";

import {
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

function withCustomEntityIds(group, nodeIds, edgeIds) {
  const nodeIdMap = new Map(group.graph.nodes.map((node, index) => [node.id, nodeIds[index] ?? node.id]));
  const edgeIdMap = new Map(group.graph.edges.map((edge, index) => [edge.id, edgeIds[index] ?? edge.id]));

  return {
    ...group,
    graph: {
      nodes: group.graph.nodes.map((node) => ({
        ...node,
        id: nodeIdMap.get(node.id),
        pos: { ...node.pos },
        params: { ...node.params },
      })),
      edges: group.graph.edges.map((edge) => ({
        ...edge,
        id: edgeIdMap.get(edge.id),
        from: {
          nodeId: nodeIdMap.get(edge.from.nodeId),
          portSlot: edge.from.portSlot,
        },
        to: {
          nodeId: nodeIdMap.get(edge.to.nodeId),
          portSlot: edge.to.portSlot,
        },
        manualCorners: edge.manualCorners.map((point) => ({ ...point })),
      })),
    },
    inputs: group.inputs.map((mapping) => ({
      ...mapping,
      nodeId: nodeIdMap.get(mapping.nodeId),
    })),
    outputs: group.outputs.map((mapping) => ({
      ...mapping,
      nodeId: nodeIdMap.get(mapping.nodeId),
    })),
    controls: group.controls.map((mapping) => ({
      ...mapping,
      nodeId: nodeIdMap.get(mapping.nodeId),
    })),
    ...(group.dsl ? { dsl: { ...group.dsl } } : {}),
  };
}

test("lowerGroupDsl preserves existing node ids on compatible edits", () => {
  const source = ["a = $0.every(2)", "b = a.counter(4)", "b.outlet(0)"].join("\n");
  const initial = lowerGroupDsl(source, registry, {
    groupId: "group-reconcile-ids",
  });

  assert.equal(initial.ok, true);

  const existingGroup = withCustomEntityIds(
    initial.group,
    ["legacy-every", "legacy-counter"],
    ["legacy-edge"],
  );
  const reconciled = lowerGroupDsl(source, registry, {
    existingGroup,
  });

  assert.equal(reconciled.ok, true);
  assert.deepEqual(
    reconciled.group.graph.nodes.map((node) => node.id),
    ["legacy-every", "legacy-counter"],
  );
  assertRoutesAndBuild(reconciled.group);
});

test("lowerGroupDsl preserves existing edge ids and manual corners when the connection is unchanged", () => {
  const source = "pulse(3)<15>.every(2).outlet(0)";
  const initial = lowerGroupDsl(source, registry, {
    groupId: "group-reconcile-edge",
  });

  assert.equal(initial.ok, true);
  assert.notDeepEqual(initial.group.graph.edges[0].manualCorners, []);

  const existingGroup = withCustomEntityIds(
    initial.group,
    ["legacy-pulse", "legacy-every"],
    ["legacy-edge"],
  );
  const existingCorners = existingGroup.graph.edges[0].manualCorners.map((point) => ({
    ...point,
  }));
  const reconciled = lowerGroupDsl(source, registry, {
    existingGroup,
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.group.graph.edges[0].id, "legacy-edge");
  assert.deepEqual(reconciled.group.graph.edges[0].manualCorners, existingCorners);
  assertRoutesAndBuild(reconciled.group);
});

test("lowerGroupDsl preserves matched node geometry and only relayouts changed regions", () => {
  const initial = lowerGroupDsl("$0.every(2).outlet(0)", registry, {
    groupId: "group-reconcile-layout",
  });

  assert.equal(initial.ok, true);

  const existingGroup = withCustomEntityIds(initial.group, ["legacy-every"], []);
  existingGroup.graph.nodes[0].pos = { x: 40, y: 20 };

  const reconciled = lowerGroupDsl("pulse(3).every(2).outlet(0)", registry, {
    existingGroup,
  });

  assert.equal(reconciled.ok, true);

  const preservedNode = reconciled.group.graph.nodes.find((node) => node.id === "legacy-every");
  const newNode = reconciled.group.graph.nodes.find((node) => node.id !== "legacy-every");

  assert.deepEqual(preservedNode.pos, { x: 40, y: 20 });
  assert.notDeepEqual(newNode.pos, preservedNode.pos);
  assertRoutesAndBuild(reconciled.group);
});

test("lowerGroupDsl falls back to fresh ids when structure diverges beyond reconciliation", () => {
  const initial = lowerGroupDsl("$0.every(2).outlet(0)", registry, {
    groupId: "group-reconcile-diverge",
  });

  assert.equal(initial.ok, true);

  const existingGroup = withCustomEntityIds(initial.group, ["legacy-every"], []);
  const reconciled = lowerGroupDsl("$0.counter(4).outlet(0)", registry, {
    existingGroup,
  });

  assert.equal(reconciled.ok, true);
  assert.equal(
    reconciled.group.graph.nodes.some((node) => node.id === "legacy-every"),
    false,
  );
  assertRoutesAndBuild(reconciled.group);
});
