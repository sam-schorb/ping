import test from "node:test";
import assert from "node:assert/strict";

import {
  clearDeletedSelection,
  createEmptySelection,
  normalizeSelection,
  toggleGroupSelection,
} from "../src/index.js";

test("selection helpers normalize and clear deleted ids", () => {
  assert.deepEqual(normalizeSelection(null), createEmptySelection());
  assert.deepEqual(normalizeSelection({ kind: "node", nodeId: "node-a" }), {
    kind: "node",
    nodeId: "node-a",
  });

  const snapshot = {
    nodes: [{ id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } }],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-a", portSlot: 0 },
        manualCorners: [{ x: 1, y: 1 }],
      },
    ],
    groups: {},
  };

  assert.deepEqual(clearDeletedSelection({ kind: "node", nodeId: "missing" }, snapshot), {
    kind: "none",
  });
  assert.deepEqual(
    clearDeletedSelection({ kind: "corner", edgeId: "edge-a", cornerIndex: 0 }, snapshot),
    { kind: "corner", edgeId: "edge-a", cornerIndex: 0 },
  );
});

test("group selection toggles in stable order", () => {
  const first = toggleGroupSelection({ nodeIds: [] }, "node-a");
  assert.deepEqual(first, { nodeIds: ["node-a"] });

  const second = toggleGroupSelection(first, "node-b");
  assert.deepEqual(second, { nodeIds: ["node-a", "node-b"] });

  const third = toggleGroupSelection(second, "node-a");
  assert.deepEqual(third, { nodeIds: ["node-b"] });
});
