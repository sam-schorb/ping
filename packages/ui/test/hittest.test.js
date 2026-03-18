import test from "node:test";
import assert from "node:assert/strict";

import { routeGraph } from "@ping/core";
import { hitEdge, hitNode, hitPort } from "../src/index.js";
import { TEST_REGISTRY } from "./helpers/harness.js";
import { getPortWorldPoint } from "../src/index.js";

test("hit testing prioritizes ports, edges, and nodes with world-space math", () => {
  const snapshot = {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 3 } },
      { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [{ x: 6, y: 2 }],
      },
    ],
    groups: {},
  };
  const routes = routeGraph(snapshot, TEST_REGISTRY);
  const portPoint = getPortWorldPoint(snapshot, snapshot.nodes[0], TEST_REGISTRY, "out", 0);
  const route = routes.edgeRoutes.get("edge-a");
  const edgePoint = {
    x: (route.points[0].x + route.points[1].x) / 2,
    y: (route.points[0].y + route.points[1].y) / 2,
  };

  assert.deepEqual(hitPort(snapshot, TEST_REGISTRY, portPoint, 0.5), {
    kind: "port",
    nodeId: "node-a",
    portSlot: 0,
    direction: "out",
  });
  assert.deepEqual(hitEdge(snapshot, routes, TEST_REGISTRY, edgePoint, 0.5), {
    kind: "edge",
    edgeId: "edge-a",
  });
  assert.deepEqual(hitNode(snapshot, TEST_REGISTRY, { x: 2.5, y: 2.5 }), {
    kind: "node",
    nodeId: "node-a",
  });
});
