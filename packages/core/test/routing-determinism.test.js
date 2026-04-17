import test from "node:test";
import assert from "node:assert/strict";

import {
  getLayout,
  getNodeDefinition,
  getOrthogonalRouteDistanceAtPoint,
  routeEdge,
  routeGraph,
} from "../src/index.js";
import { loadRoutingFixture } from "./helpers/routing-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function toSerializableRouteResult(result) {
  return {
    edgeRoutes: Array.from(result.edgeRoutes.entries()),
    edgeDelays: Array.from(result.edgeDelays.entries()),
    errors: result.errors ?? [],
  };
}

function assertOrthogonal(points) {
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(
      points[index].x === points[index - 1].x ||
        points[index].y === points[index - 1].y,
    );
  }
}

test("routeGraph is deterministic for identical inputs", async () => {
  const fixture = await loadRoutingFixture("valid-multi-corner.json");

  const first = routeGraph(fixture, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });
  const second = routeGraph(fixture, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(toSerializableRouteResult(first), toSerializableRouteResult(second));
  assert.equal(first.errors, undefined);
  assertOrthogonal(first.edgeRoutes.get("edge-corner").points);
});

test("routeEdge keeps manual corners as hard constraints in order", async () => {
  const fixture = await loadRoutingFixture("valid-multi-corner.json");
  const route = routeEdge("edge-corner", fixture, registry, {
    ticksPerGrid: 1,
    stubLength: 1,
    bendPreference: "horizontal-first",
  });

  assert.deepEqual(route.points, [
    { x: 3, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 5 },
    { x: 6, y: 5 },
  ]);
  assert.equal(route.svgPathD, "M 3 1 L 5 1 L 5 5 L 6 5");
  assert.equal(route.totalLength, 7);
});

test("route distance helper resolves hidden collinear waypoints in order", () => {
  const points = [
    { x: 3, y: 1 },
    { x: 9, y: 1 },
  ];

  assert.deepEqual(getOrthogonalRouteDistanceAtPoint(points, { x: 5, y: 1 }), {
    distance: 2,
    segmentIndex: 0,
  });
  assert.deepEqual(
    getOrthogonalRouteDistanceAtPoint(points, { x: 7, y: 1 }, { minimumDistance: 2 }),
    {
      distance: 4,
      segmentIndex: 0,
    },
  );
  assert.equal(getOrthogonalRouteDistanceAtPoint(points, { x: 7, y: 2 }), null);
});
