import test from "node:test";
import assert from "node:assert/strict";

import {
  getLayout,
  getNodeDefinition,
  getOrthogonalRouteDistanceAtPoint,
  resolveManualCornerDrag,
  routeEdge,
  routeGraph,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createManualCornerSnapshot(manualCorner = { x: 8, y: 3 }) {
  return {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 2, y: 2 },
        rot: 0,
        params: { param: 1 },
      },
      {
        id: "node-blocker",
        type: "set",
        pos: { x: 8, y: 2 },
        rot: 0,
        params: { param: 3 },
      },
      {
        id: "node-output",
        type: "out",
        pos: { x: 14, y: 2 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [manualCorner],
      },
    ],
    groups: {},
  };
}

test("routeEdge preserves manual corners that force immediate backtracking", () => {
  const manualCorner = { x: 8, y: 3 };
  const snapshot = createManualCornerSnapshot(manualCorner);
  const route = routeEdge("edge-a", snapshot, registry);

  assert.deepEqual(
    route.points.filter((point) => point.x === manualCorner.x && point.y === manualCorner.y),
    [manualCorner],
  );
  assert.notEqual(getOrthogonalRouteDistanceAtPoint(route.points, manualCorner), null);
});

test("routeGraph reports ROUTE_NO_PATH when a manual corner makes the edge unroutable", () => {
  const snapshot = createManualCornerSnapshot({ x: 9, y: 3 });
  const result = routeGraph(snapshot, registry);

  assert.deepEqual(result.errors?.map((issue) => issue.code), ["ROUTE_NO_PATH"]);
  assert.equal(result.edgeRoutes.has("edge-a"), false);
});

test("resolveManualCornerDrag returns exact geometry for a legal desired point", () => {
  const snapshot = createManualCornerSnapshot({ x: 6, y: 2 });
  const result = resolveManualCornerDrag({
    snapshot,
    registry,
    edgeId: "edge-a",
    cornerIndex: 0,
    desiredPoint: { x: 8, y: 3 },
  });

  assert.equal(result.status, "exact");
  assert.deepEqual(result.resolvedPoint, { x: 8, y: 3 });
  assert.notEqual(getOrthogonalRouteDistanceAtPoint(result.route.points, result.resolvedPoint), null);
});

test("resolveManualCornerDrag clamps impossible corner drags to nearby legal geometry", () => {
  const snapshot = createManualCornerSnapshot({ x: 6, y: 2 });
  const result = resolveManualCornerDrag({
    snapshot,
    registry,
    edgeId: "edge-a",
    cornerIndex: 0,
    desiredPoint: { x: 9, y: 3 },
  });

  assert.equal(result.status, "clamped");
  assert.notDeepEqual(result.resolvedPoint, { x: 9, y: 3 });
  assert.notEqual(getOrthogonalRouteDistanceAtPoint(result.route.points, result.resolvedPoint), null);
});
