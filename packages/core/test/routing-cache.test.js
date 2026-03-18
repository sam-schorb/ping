import test from "node:test";
import assert from "node:assert/strict";

import {
  createRoutingCache,
  getLayout,
  getNodeDefinition,
  routeGraph,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createTwoEdgeSnapshot(outputBPos, edgeBCorners = []) {
  return {
    nodes: [
      {
        id: "node-pulse-a",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-a",
        type: "output",
        pos: { x: 4, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-pulse-b",
        type: "pulse",
        pos: { x: 0, y: 4 },
        rot: 0,
        params: {},
      },
      {
        id: "node-output-b",
        type: "output",
        pos: outputBPos,
        rot: 0,
        params: {},
      }
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-pulse-a", portSlot: 0 },
        to: { nodeId: "node-output-a", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-b",
        from: { nodeId: "node-pulse-b", portSlot: 0 },
        to: { nodeId: "node-output-b", portSlot: 0 },
        manualCorners: edgeBCorners,
      }
    ],
  };
}

test("routeGraph reuses cached routes for unchanged edges and updates changed edges in place", () => {
  const cache = createRoutingCache();
  const initial = routeGraph(
    createTwoEdgeSnapshot({ x: 7, y: 6 }),
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    undefined,
    cache,
  );
  const previousA = initial.edgeRoutes.get("edge-a");
  const previousB = initial.edgeRoutes.get("edge-b");

  const updated = routeGraph(
    createTwoEdgeSnapshot(
      { x: 7, y: 6 },
      [{ x: 5, y: 5 }],
    ),
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    new Set(["edge-b"]),
    cache,
  );

  assert.equal(updated.errors, undefined);
  assert.equal(updated.edgeRoutes.get("edge-a"), previousA);
  assert.notEqual(updated.edgeRoutes.get("edge-b"), previousB);
  assert.equal(cache.edgeRoutes.get("edge-a"), previousA);
  assert.equal(cache.edgeRoutes.get("edge-b"), updated.edgeRoutes.get("edge-b"));
});

test("moving an unrelated obstacle node invalidates cached routes that may need to detour around it", () => {
  const cache = createRoutingCache();
  const initialSnapshot = {
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
        pos: { x: 20, y: 20 },
        rot: 0,
        params: { param: 3 },
      },
      {
        id: "node-output",
        type: "output",
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
  const initial = routeGraph(
    initialSnapshot,
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    undefined,
    cache,
  );
  const previousRoute = initial.edgeRoutes.get("edge-a");
  const updated = routeGraph(
    {
      ...initialSnapshot,
      nodes: initialSnapshot.nodes.map((node) =>
        node.id === "node-blocker"
          ? {
              ...node,
              pos: { x: 5, y: -1 },
            }
          : node,
      ),
    },
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    undefined,
    cache,
  );

  assert.notEqual(updated.edgeRoutes.get("edge-a"), previousRoute);
});

test("param changes do not invalidate cached routing", () => {
  const cache = createRoutingCache();
  const initialSnapshot = createTwoEdgeSnapshot({ x: 4, y: 4 });
  const initial = routeGraph(
    initialSnapshot,
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    undefined,
    cache,
  );
  const previousA = initial.edgeRoutes.get("edge-a");
  const updatedSnapshot = {
    ...initialSnapshot,
    nodes: initialSnapshot.nodes.map((node) =>
      node.id === "node-pulse-a"
        ? {
            ...node,
            params: { param: 7 },
          }
        : node,
    ),
  };
  const updated = routeGraph(
    updatedSnapshot,
    registry,
    {
      ticksPerGrid: 1,
      stubLength: 1,
      bendPreference: "horizontal-first",
    },
    undefined,
    cache,
  );

  assert.equal(updated.edgeRoutes.get("edge-a"), previousA);
});
