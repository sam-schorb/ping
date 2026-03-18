import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistryIndex,
  getLayout,
  getNodeDefinition,
} from "@ping/core";
import {
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
