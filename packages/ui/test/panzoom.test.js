import test from "node:test";
import assert from "node:assert/strict";

import { mergeUIConfig } from "../config/defaults.js";
import { applyPinchGesture, applyScreenDeltaPan } from "../render/panzoom.js";

function createViewport(width = 800, height = 600) {
  return {
    getBoundingClientRect() {
      return {
        width,
        height,
        left: 0,
        top: 0,
        right: width,
        bottom: height,
      };
    },
  };
}

test("applyScreenDeltaPan moves the camera with the drag delta and preserves scale", () => {
  const viewport = createViewport();
  const config = mergeUIConfig(undefined, {
    grid: {
      worldBounds: { minX: -40, minY: -40, maxX: 40, maxY: 40 },
    },
  });

  assert.deepEqual(
    applyScreenDeltaPan(
      { x: 10, y: -20, scale: 1.25 },
      { x: 36, y: -18 },
      viewport,
      config,
    ),
    { x: 46, y: -38, scale: 1.25 },
  );
});

test("applyPinchGesture combines midpoint pan with scale around the starting midpoint", () => {
  const viewport = createViewport();
  const config = mergeUIConfig(undefined, {
    grid: {
      worldBounds: { minX: -80, minY: -80, maxX: 80, maxY: 80 },
    },
  });

  assert.deepEqual(
    applyPinchGesture(
      { x: 0, y: 0, scale: 1 },
      {
        startMidpoint: { x: 100, y: 100 },
        currentMidpoint: { x: 120, y: 135 },
        startDistance: 80,
        currentDistance: 120,
      },
      viewport,
      config,
    ),
    { x: -30, y: -15, scale: 1.5 },
  );
});
