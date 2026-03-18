import test from "node:test";
import assert from "node:assert/strict";

import { JSDOM } from "jsdom";

import { routeEdge, routeGraph } from "@ping/core";

import {
  DEFAULT_UI_CONFIG,
  createPreviewEdgeRoutes,
  renderSvgMarkup,
  worldToScreen,
} from "../src/index.js";
import { TEST_REGISTRY } from "./helpers/harness.js";

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
    groups: {},
  };
}

function createBaseRenderArgs(snapshot, routes) {
  return {
    snapshot,
    routes,
    registry: TEST_REGISTRY,
    config: DEFAULT_UI_CONFIG,
    camera: { x: 0, y: 0, scale: 1 },
    viewportSize: { width: 800, height: 600 },
    selection: { kind: "none" },
    hover: { kind: "none" },
    groupSelection: { nodeIds: [] },
    drag: null,
    nodePositionOverrides: new Map(),
    thumbs: [],
    previewRoute: null,
    boxSelection: null,
  };
}

function createMultiEdgeSnapshot() {
  return {
    nodes: [
      {
        id: "node-a-in",
        type: "pulse",
        pos: { x: 0, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-a-out",
        type: "out",
        pos: { x: 12, y: 0 },
        rot: 0,
        params: {},
      },
      {
        id: "node-b-in",
        type: "pulse",
        pos: { x: 0, y: 10 },
        rot: 0,
        params: {},
      },
      {
        id: "node-b-out",
        type: "out",
        pos: { x: 12, y: 10 },
        rot: 0,
        params: {},
      },
      {
        id: "node-mover",
        type: "set",
        pos: { x: 18, y: 4 },
        rot: 0,
        params: { param: 3 },
      },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a-in", portSlot: 0 },
        to: { nodeId: "node-a-out", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-b",
        from: { nodeId: "node-b-in", portSlot: 0 },
        to: { nodeId: "node-b-out", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };
}

function getEdgePathD(markup) {
  const dom = new JSDOM(`<div id="root">${markup}</div>`);
  return dom.window.document
    .querySelector('[data-testid="edge-edge-a"] .ping-editor__edge-path')
    .getAttribute("d");
}

function toScreenPath(route, camera, config) {
  const points = route.points.map((point) => worldToScreen(point, camera, config));
  return `M ${points[0].x} ${points[0].y}${points
    .slice(1)
    .map((point) => ` L ${point.x} ${point.y}`)
    .join("")}`;
}

test("drag preview reroutes moved edges with the same obstacle-aware router as committed edges", () => {
  const snapshot = createSnapshot({ x: 5, y: -1 });
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewSnapshot = {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.id === "node-output"
        ? {
            ...node,
            pos: { x: 12, y: 3 },
          }
        : node,
    ),
  };
  const expectedRoute = routeEdge("edge-a", previewSnapshot, TEST_REGISTRY);
  const args = createBaseRenderArgs(snapshot, routes);
  const markup = renderSvgMarkup({
    ...args,
    drag: {
      kind: "node",
      nodeIds: ["node-output"],
      currentPositions: {
        "node-output": { x: 12, y: 3 },
      },
    },
  });

  assert.equal(
    getEdgePathD(markup),
    toScreenPath(expectedRoute, args.camera, args.config),
  );
});

test("renderSvgMarkup does not fall back to an illegal direct line when routing reports no path", () => {
  const snapshot = createSnapshot({ x: 4, y: -1 });
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const markup = renderSvgMarkup(createBaseRenderArgs(snapshot, routes));

  assert.deepEqual(routes.errors?.map((issue) => issue.code), ["ROUTE_NO_PATH"]);
  assert.equal(getEdgePathD(markup), "");
});

test("createPreviewEdgeRoutes only reroutes edges attached to the moved node", () => {
  const snapshot = createMultiEdgeSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewSnapshot = {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.id === "node-a-out"
        ? {
            ...node,
            pos: { x: 12, y: 3 },
          }
        : node,
    ),
  };

  const previewRoutes = createPreviewEdgeRoutes(
    snapshot,
    previewSnapshot,
    routes,
    TEST_REGISTRY,
    {
      drag: {
        kind: "node",
        nodeIds: ["node-a-out"],
        currentPositions: {
          "node-a-out": { x: 12, y: 3 },
        },
      },
      nodePositionOverrides: new Map(),
    },
    DEFAULT_UI_CONFIG,
  );

  assert.deepEqual([...previewRoutes.keys()], ["edge-a"]);
});

test("createPreviewEdgeRoutes reroutes unrelated edges only when the moved node becomes their obstacle", () => {
  const snapshot = createMultiEdgeSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewSnapshot = {
    ...snapshot,
    nodes: snapshot.nodes.map((node) =>
      node.id === "node-mover"
        ? {
            ...node,
            pos: { x: 5, y: -1 },
          }
        : node,
    ),
  };

  const previewRoutes = createPreviewEdgeRoutes(
    snapshot,
    previewSnapshot,
    routes,
    TEST_REGISTRY,
    {
      drag: {
        kind: "node",
        nodeIds: ["node-mover"],
        currentPositions: {
          "node-mover": { x: 5, y: -1 },
        },
      },
      nodePositionOverrides: new Map(),
    },
    DEFAULT_UI_CONFIG,
  );

  assert.deepEqual([...previewRoutes.keys()], ["edge-a"]);
});
