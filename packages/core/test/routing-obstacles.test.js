import test from "node:test";
import assert from "node:assert/strict";

import {
  getLayout,
  getNodeDefinition,
  routeEdge,
  routeGraph,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createSnapshot(blockerPos) {
  return {
    nodes: [
      {
        id: "node-pulse",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-blocker",
        type: "set",
        pos: blockerPos,
        rot: 0,
        params: { param: 3 },
      },
      {
        id: "node-output",
        type: "out",
        pos: { x: 12, y: 0 },
        rot: 0,
        params: {},
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [],
      },
    ],
  };
}

function assertRouteAvoidsBounds(route, bounds) {
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const step = {
      x: Math.sign(end.x - start.x),
      y: Math.sign(end.y - start.y),
    };
    let current = start;

    while (current.x !== end.x || current.y !== end.y) {
      const next = {
        x: current.x + step.x,
        y: current.y + step.y,
      };

      if (current.y === next.y) {
        const x = Math.min(current.x, next.x);
        const y = current.y;
        assert.equal(
          y >= bounds.y0 && y <= bounds.y1 && x >= bounds.x0 && x < bounds.x1,
          false,
        );
      } else {
        const x = current.x;
        const y = Math.min(current.y, next.y);
        assert.equal(
          x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y < bounds.y1,
          false,
        );
      }

      current = next;
    }
  }
}

test("routeEdge detours around blocking nodes without crossing or skimming them", () => {
  const snapshot = createSnapshot({ x: 5, y: -1 });
  const route = routeEdge("edge-a", snapshot, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.equal(route.totalLength > 9, true);
  assert.deepEqual(route.points[0], { x: 3, y: 1 });
  assert.deepEqual(route.points.at(-1), { x: 12, y: 1 });
  assertRouteAvoidsBounds(route, {
    x0: 5,
    y0: -1,
    x1: 8,
    y1: 2,
  });
});

test("routeGraph reports ROUTE_NO_PATH when a port has no legal exit corridor", () => {
  const snapshot = createSnapshot({ x: 4, y: -1 });
  const result = routeGraph(snapshot, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(result.errors?.map((issue) => issue.code), ["ROUTE_NO_PATH"]);
  assert.equal(result.edgeRoutes.has("edge-a"), false);
});
