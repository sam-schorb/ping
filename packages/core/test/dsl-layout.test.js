import test from "node:test";
import assert from "node:assert/strict";

import {
  DSL_ERROR_CODES,
  getLayout,
  getNodeDefinition,
  lowerGroupDsl,
  routeEdge,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function getNode(group, nodeName) {
  return group.graph.nodes.find((node) => node.name === nodeName);
}

test("fresh DSL-authored groups generate deterministic node positions", () => {
  const source = [
    "m = $0.mux()",
    "a = m[0].every(2)",
    "b = m[1].counter(4)",
    "a.outlet(0)",
    "b.outlet(1)",
  ].join("\n");
  const first = lowerGroupDsl(source, registry, { groupId: "layout-mux-a" });
  const second = lowerGroupDsl(source, registry, { groupId: "layout-mux-b" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(
    first.group.graph.nodes.map((node) => ({ name: node.name, pos: node.pos })),
    second.group.graph.nodes.map((node) => ({ name: node.name, pos: node.pos })),
  );

  const mux = getNode(first.group, "m");
  const topBranch = getNode(first.group, "a");
  const lowerBranch = getNode(first.group, "b");

  assert.equal(mux.pos.x < topBranch.pos.x, true);
  assert.equal(topBranch.pos.y < lowerBranch.pos.y, true);
});

test("fresh DSL-authored groups generate deterministic manual corners and satisfy feasible distances", () => {
  const source = "pulse(3)<15>.every(2).outlet(0)";
  const first = lowerGroupDsl(source, registry, { groupId: "layout-distance-a" });
  const second = lowerGroupDsl(source, registry, { groupId: "layout-distance-b" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(
    first.group.graph.edges.map((edge) => edge.manualCorners),
    second.group.graph.edges.map((edge) => edge.manualCorners),
  );
  assert.notDeepEqual(first.group.graph.edges[0].manualCorners, []);

  const routed = routeEdge("edge-1", first.group.graph, registry);

  assert.equal(routed.totalLength, 15);
});

test("fresh DSL-authored groups fail cleanly when a requested distance is infeasible", () => {
  const result = lowerGroupDsl("pulse(3)<9>.every(2).outlet(0)", registry, {
    groupId: "layout-distance-fail",
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, DSL_ERROR_CODES.LAYOUT_INFEASIBLE_DISTANCE);
});

test("fresh DSL-authored groups preserve stable visual ordering for demux inputs", () => {
  const source = [
    "a = $0.every(2)",
    "b = $1.counter(4)",
    "d = demux()",
    "a.d[0]",
    "b.d[1]",
    "d.outlet(0)",
  ].join("\n");
  const result = lowerGroupDsl(source, registry, { groupId: "layout-demux" });

  assert.equal(result.ok, true);

  const a = getNode(result.group, "a");
  const b = getNode(result.group, "b");
  const d = getNode(result.group, "d");

  assert.equal(a.pos.x < d.pos.x, true);
  assert.equal(b.pos.x < d.pos.x, true);
  assert.equal(a.pos.y < b.pos.y, true);
});

test("fresh DSL-authored groups preserve stable visual ordering for switch outputs", () => {
  const source = [
    "sw = $0.switch(2){$1}",
    "a = sw[0].every(2)",
    "b = sw[3].counter(4)",
    "a.outlet(0)",
    "b.outlet(1)",
  ].join("\n");
  const result = lowerGroupDsl(source, registry, { groupId: "layout-switch" });

  assert.equal(result.ok, true);

  const sw = getNode(result.group, "sw");
  const a = getNode(result.group, "a");
  const b = getNode(result.group, "b");

  assert.equal(sw.pos.x < a.pos.x, true);
  assert.equal(sw.pos.x < b.pos.x, true);
  assert.equal(a.pos.y < b.pos.y, true);
});
