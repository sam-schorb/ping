import test from "node:test";
import assert from "node:assert/strict";

import { getLayout, getNodeDefinition, getPortAnchor } from "../src/index.js";
import { loadRoutingFixture } from "./helpers/routing-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

test("anchor placement lands on integer grid intersections and respects multi-io side ordering", async () => {
  const fixture = await loadRoutingFixture("valid-multi-io.json");
  const mux = fixture.nodes.find((node) => node.id === "node-mux");
  const demux = fixture.nodes.find((node) => node.id === "node-demux");

  const topOut = getPortAnchor(mux, "out", 0, fixture, registry, "edge-top");
  const bottomOut = getPortAnchor(mux, "out", 5, fixture, registry, "edge-bottom");
  const topIn = getPortAnchor(demux, "in", 0, fixture, registry, "edge-top");
  const bottomIn = getPortAnchor(demux, "in", 5, fixture, registry, "edge-bottom");
  const mergedOut = getPortAnchor(demux, "out", 0, fixture, registry, "edge-merged");

  assert.deepEqual(topOut.point, { x: 1, y: 2 });
  assert.deepEqual(topOut.outward, { x: 0, y: -1 });
  assert.deepEqual(bottomOut.point, { x: 1, y: 5 });
  assert.deepEqual(bottomOut.outward, { x: 0, y: 1 });
  assert.deepEqual(topIn.point, { x: 8, y: 2 });
  assert.deepEqual(bottomIn.point, { x: 8, y: 5 });
  assert.deepEqual(mergedOut.point, { x: 9, y: 3 });
  assert.deepEqual(mergedOut.outward, { x: 1, y: 0 });

  for (const anchor of [topOut, bottomOut, topIn, bottomIn, mergedOut]) {
    assert.equal(Number.isInteger(anchor.point.x), true);
    assert.equal(Number.isInteger(anchor.point.y), true);
  }
});

test("group nodes derive anchors from their exposed custom layout and rotation", () => {
  const snapshot = {
    nodes: [
      {
        id: "group-node",
        type: "group",
        groupRef: "group-a",
        pos: { x: 10, y: 4 },
        rot: 90,
        params: {},
      },
    ],
    edges: [],
    groups: {
      "group-a": {
        id: "group-a",
        name: "Group A",
        graph: {
          nodes: [
            {
              id: "inner-pulse",
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [],
        },
        inputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
        outputs: [{ nodeId: "inner-pulse", portSlot: 0 }, { nodeId: "inner-pulse", portSlot: 0 }],
        controls: [{ nodeId: "inner-pulse", controlSlot: 0 }],
      },
    },
  };
  const groupNode = snapshot.nodes[0];
  const outputAnchor = getPortAnchor(
    groupNode,
    "out",
    1,
    snapshot,
    registry,
    "edge-group",
  );

  assert.deepEqual(outputAnchor.point, { x: 11, y: 7 });
  assert.deepEqual(outputAnchor.outward, { x: 0, y: -1 });
});
