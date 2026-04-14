import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistryIndex,
  getNodeRoutingBounds,
  getLayout,
  getNodeDefinition,
  getPortAnchor,
  routeGraph,
} from "@ping/core";
import {
  buildObstacleAwarePreviewRoute,
  buildPreviewRoute,
  doesRouteIntersectBounds,
  findEdgeCornerInsertTarget,
  getPointAtRouteProgress,
  getPortWorldPoint,
  snapWorldPoint,
} from "../src/index.js";

const REGISTRY_INDEX = buildRegistryIndex();
const REGISTRY = {
  getNodeDefinition(type) {
    return getNodeDefinition(type, REGISTRY_INDEX);
  },
  getLayout,
};

test("snap-to-grid rounds world points", () => {
  const config = {
    grid: {
      snap: true,
    },
  };

  assert.deepEqual(snapWorldPoint({ x: 3.4, y: 1.6 }, config), { x: 3, y: 2 });
});

test("thumb math walks orthogonal polylines", () => {
  const route = {
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    totalLength: 8,
  };

  assert.deepEqual(getPointAtRouteProgress(route, 0), { x: 0, y: 0 });
  assert.deepEqual(getPointAtRouteProgress(route, 0.5), { x: 4, y: 0 });
  assert.deepEqual(getPointAtRouteProgress(route, 0.75), { x: 4, y: 2 });
});

test("preview routes stay orthogonal through manual corners and include a start stub", () => {
  const route = buildPreviewRoute(
    { x: 3, y: 1 },
    { x: 12, y: 1 },
    "horizontal-first",
    [{ x: 6, y: 2 }],
    {
      startOutward: { x: 1, y: 0 },
      stubLength: 1,
    },
  );

  assert.deepEqual(route.points, [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 6, y: 1 },
    { x: 6, y: 2 },
    { x: 12, y: 2 },
    { x: 12, y: 1 },
  ]);
});

test("obstacle-aware preview routes detour around blocking nodes without touching their edges", () => {
  const snapshot = {
    nodes: [
      { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: {} },
      { id: "node-blocker", type: "set", pos: { x: 5, y: -1 }, rot: 0, params: { param: 3 } },
    ],
    edges: [],
    groups: {},
  };
  const fromAnchor = getPortAnchor(snapshot.nodes[0], "out", 0, snapshot, REGISTRY, "preview");
  const blockerBounds = getNodeRoutingBounds(snapshot.nodes[1], snapshot, REGISTRY, "preview");
  const route = buildObstacleAwarePreviewRoute({
    snapshot,
    registry: REGISTRY,
    fromAnchor,
    toPoint: { x: 12, y: 1 },
    bendPreference: "horizontal-first",
    stubLength: 1,
  });

  assert.deepEqual(route.points, [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 3 },
    { x: 12, y: 3 },
    { x: 12, y: 1 },
  ]);
  assert.equal(doesRouteIntersectBounds(route, blockerBounds), false);
});

test("obstacle-aware preview clamps a cursor inside a node back to a legal endpoint", () => {
  const snapshot = {
    nodes: [
      { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: {} },
      { id: "node-blocker", type: "set", pos: { x: 5, y: -1 }, rot: 0, params: { param: 3 } },
    ],
    edges: [],
    groups: {},
  };
  const fromAnchor = getPortAnchor(snapshot.nodes[0], "out", 0, snapshot, REGISTRY, "preview");
  const blockerBounds = getNodeRoutingBounds(snapshot.nodes[1], snapshot, REGISTRY, "preview");
  const route = buildObstacleAwarePreviewRoute({
    snapshot,
    registry: REGISTRY,
    fromAnchor,
    toPoint: { x: 6, y: 1 },
    bendPreference: "horizontal-first",
    stubLength: 1,
  });

  assert.deepEqual(route.points, [
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ]);
  assert.equal(doesRouteIntersectBounds(route, blockerBounds), false);
});

test("multi-io port geometry preserves mux ordering and mirrored demux ordering", () => {
  const snapshot = {
    nodes: [
      {
        id: "node-a",
        type: "mux",
        pos: { x: 10, y: 10 },
        rot: 0,
        params: {},
      },
      {
        id: "node-b",
        type: "demux",
        pos: { x: 20, y: 10 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
    groups: {},
  };
  const mux = snapshot.nodes[0];
  const demux = snapshot.nodes[1];

  assert.deepEqual(getPortWorldPoint(snapshot, mux, REGISTRY, "out", 0), { x: 11, y: 10 });
  assert.deepEqual(getPortWorldPoint(snapshot, mux, REGISTRY, "out", 5), { x: 11, y: 13 });
  assert.deepEqual(getPortWorldPoint(snapshot, demux, REGISTRY, "in", 0), { x: 22, y: 10 });
  assert.deepEqual(getPortWorldPoint(snapshot, demux, REGISTRY, "in", 5), { x: 22, y: 13 });
  assert.deepEqual(getPortWorldPoint(snapshot, demux, REGISTRY, "out", 0), { x: 23, y: 11 });
});

test("edge insert target respects hidden collinear manual corners when choosing the insert index", () => {
  const snapshot = {
    nodes: [
      { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: {} },
      { id: "node-output", type: "out", pos: { x: 12, y: 0 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse", portSlot: 0 },
        to: { nodeId: "node-output", portSlot: 0 },
        manualCorners: [{ x: 6, y: 1 }],
      },
    ],
    groups: {},
  };
  const routes = routeGraph(snapshot, REGISTRY);

  assert.deepEqual(
    findEdgeCornerInsertTarget(snapshot, routes, REGISTRY, "edge-a", { x: 4.2, y: 1.1 }),
    {
      edgeId: "edge-a",
      index: 0,
      point: { x: 4, y: 1 },
    },
  );
  assert.deepEqual(
    findEdgeCornerInsertTarget(snapshot, routes, REGISTRY, "edge-a", { x: 8.4, y: 0.9 }),
    {
      edgeId: "edge-a",
      index: 1,
      point: { x: 8, y: 1 },
    },
  );
});
