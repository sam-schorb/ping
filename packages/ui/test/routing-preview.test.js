import test from "node:test";
import assert from "node:assert/strict";

import { JSDOM } from "jsdom";

import { getOrthogonalRouteDistanceAtPoint, routeEdge, routeGraph } from "@ping/core";

import {
  DEFAULT_UI_CONFIG,
  createPreviewEdgeRoutes,
  createPreviewRenderState,
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

function createCornerPreviewSnapshot(manualCorner = { x: 6, y: 2 }) {
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
        manualCorners: [manualCorner],
      },
    ],
    groups: {},
  };
}

function createBlockedCornerPreviewSnapshot(manualCorner = { x: 6, y: 2 }) {
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

test("createPreviewRenderState hides thumbs on every preview-rerouted edge", () => {
  const snapshot = createMultiEdgeSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewState = {
    drag: {
      kind: "node",
      nodeIds: ["node-mover"],
      currentPositions: {
        "node-mover": { x: 5, y: -1 },
      },
    },
    nodePositionOverrides: new Map(),
  };

  const previewRenderState = createPreviewRenderState(
    snapshot,
    routes,
    TEST_REGISTRY,
    previewState,
    DEFAULT_UI_CONFIG,
  );

  assert.deepEqual([...previewRenderState.previewEdgeRoutes.keys()], ["edge-a"]);
  assert.deepEqual([...previewRenderState.hiddenThumbEdgeIds], ["edge-a"]);
});

test("createPreviewRenderState reroutes the dragged corner edge from the snapped live point", () => {
  const snapshot = createCornerPreviewSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewState = {
    drag: {
      kind: "corner",
      edgeId: "edge-a",
      cornerIndex: 0,
      startPoint: { x: 6, y: 2 },
      currentPoint: { x: 8.4, y: 5.6 },
    },
    nodePositionOverrides: new Map(),
  };
  const expectedSnapshot = createCornerPreviewSnapshot({ x: 8, y: 6 });
  const expectedRoute = routeEdge("edge-a", expectedSnapshot, TEST_REGISTRY);

  const previewRenderState = createPreviewRenderState(
    snapshot,
    routes,
    TEST_REGISTRY,
    previewState,
    DEFAULT_UI_CONFIG,
  );

  assert.deepEqual(
    previewRenderState.previewSnapshot.edges.find((edge) => edge.id === "edge-a")?.manualCorners,
    [{ x: 8, y: 6 }],
  );
  assert.deepEqual(previewRenderState.previewEdgeRoutes.get("edge-a"), expectedRoute);
  assert.deepEqual([...previewRenderState.hiddenThumbEdgeIds], ["edge-a"]);
});

test("renderSvgMarkup places the dragged corner handle at the snapped preview position", () => {
  const snapshot = createCornerPreviewSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const args = createBaseRenderArgs(snapshot, routes);
  const previewState = {
    kind: "corner",
    edgeId: "edge-a",
    cornerIndex: 0,
    startPoint: { x: 6, y: 2 },
    currentPoint: { x: 8.4, y: 5.6 },
  };
  const expectedSnapshot = createCornerPreviewSnapshot({ x: 8, y: 6 });
  const expectedRoute = routeEdge("edge-a", expectedSnapshot, TEST_REGISTRY);
  const expectedPoint = worldToScreen({ x: 8, y: 6 }, args.camera, args.config);
  const markup = renderSvgMarkup({
    ...args,
    drag: previewState,
  });
  const dom = new JSDOM(`<div id="root">${markup}</div>`);
  const handle = dom.window.document.querySelector('[data-testid="corner-handle-edge-a-0"]');

  assert.equal(getEdgePathD(markup), toScreenPath(expectedRoute, args.camera, args.config));
  assert.equal(Number(handle.getAttribute("cx")), expectedPoint.x);
  assert.equal(Number(handle.getAttribute("cy")), expectedPoint.y);
});

test("createPreviewRenderState clamps impossible corner drags to legal routed geometry", () => {
  const snapshot = createBlockedCornerPreviewSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const previewState = {
    drag: {
      kind: "corner",
      edgeId: "edge-a",
      cornerIndex: 0,
      startPoint: { x: 6, y: 2 },
      currentPoint: { x: 9, y: 3 },
    },
    nodePositionOverrides: new Map(),
  };

  const previewRenderState = createPreviewRenderState(
    snapshot,
    routes,
    TEST_REGISTRY,
    previewState,
    DEFAULT_UI_CONFIG,
  );
  const resolvedCorner = previewRenderState.previewSnapshot.edges.find((edge) => edge.id === "edge-a")
    ?.manualCorners?.[0];
  const resolvedRoute = previewRenderState.previewEdgeRoutes.get("edge-a");

  assert.notDeepEqual(resolvedCorner, { x: 9, y: 3 });
  assert.notEqual(getOrthogonalRouteDistanceAtPoint(resolvedRoute.points, resolvedCorner), null);
});

test("renderSvgMarkup keeps the dragged corner handle on the rendered route when the desired point is illegal", () => {
  const snapshot = createBlockedCornerPreviewSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const args = createBaseRenderArgs(snapshot, routes);
  const markup = renderSvgMarkup({
    ...args,
    drag: {
      kind: "corner",
      edgeId: "edge-a",
      cornerIndex: 0,
      startPoint: { x: 6, y: 2 },
      currentPoint: { x: 9, y: 3 },
    },
  });
  const dom = new JSDOM(`<div id="root">${markup}</div>`);
  const handle = dom.window.document.querySelector('[data-testid="corner-handle-edge-a-0"]');
  const handleWorldPoint = {
    x: Number(handle.getAttribute("cx")) / DEFAULT_UI_CONFIG.grid.GRID_PX,
    y: Number(handle.getAttribute("cy")) / DEFAULT_UI_CONFIG.grid.GRID_PX,
  };
  const previewRenderState = createPreviewRenderState(
    snapshot,
    routes,
    TEST_REGISTRY,
    {
      drag: {
        kind: "corner",
        edgeId: "edge-a",
        cornerIndex: 0,
        startPoint: { x: 6, y: 2 },
        currentPoint: { x: 9, y: 3 },
      },
      nodePositionOverrides: new Map(),
    },
    DEFAULT_UI_CONFIG,
  );
  const previewRoute = previewRenderState.previewEdgeRoutes.get("edge-a");

  assert.notEqual(getEdgePathD(markup), "");
  assert.notEqual(getOrthogonalRouteDistanceAtPoint(previewRoute.points, handleWorldPoint), null);
});

test("renderSvgMarkup hides thumbs on unrelated edges when they are preview-rerouted", () => {
  const snapshot = createMultiEdgeSnapshot();
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const markup = renderSvgMarkup({
    ...createBaseRenderArgs(snapshot, routes),
    thumbs: [{ edgeId: "edge-a", progress: 0.5, speed: 1, emitTick: 0 }],
    drag: {
      kind: "node",
      nodeIds: ["node-mover"],
      currentPositions: {
        "node-mover": { x: 5, y: -1 },
      },
    },
  });
  const dom = new JSDOM(`<div id="root">${markup}</div>`);

  assert.equal(dom.window.document.querySelector('[data-testid="thumb-0"]'), null);
});
