import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultSampleSlots,
  DEFAULT_TEMPO_BPM,
  getOrthogonalRouteDistanceAtPoint,
  getPortAnchor,
  routeGraph,
} from "@ping/core";
import {
  buildObstacleAwarePreviewRoute,
  createEditor,
  DEFAULT_UI_CONFIG,
  mergeUIConfig,
  worldToScreen,
} from "../../src/index.js";
import { resolveNodeTheme } from "../../theme/node-theme.js";
import {
  createEditorHarness,
  createRuntimeStub,
  flushFrames,
  setupDom,
  TEST_PALETTE,
  TEST_REGISTRY,
} from "./harness.js";

export {
  test,
  assert,
  createDefaultSampleSlots,
  DEFAULT_TEMPO_BPM,
  getOrthogonalRouteDistanceAtPoint,
  getPortAnchor,
  routeGraph,
  buildObstacleAwarePreviewRoute,
  createEditor,
  DEFAULT_UI_CONFIG,
  mergeUIConfig,
  worldToScreen,
  resolveNodeTheme,
  createEditorHarness,
  createRuntimeStub,
  flushFrames,
  setupDom,
  TEST_PALETTE,
  TEST_REGISTRY,
};

export function getPortScreenPoint(portElement) {
  return {
    x: Number(portElement.getAttribute("cx")),
    y: Number(portElement.getAttribute("cy")),
  };
}

export function getNodeScreenBox(nodeElement) {
  const nodeRect = nodeElement.querySelector(".ping-editor__node");

  return {
    x: Number(nodeRect.getAttribute("x")),
    y: Number(nodeRect.getAttribute("y")),
    width: Number(nodeRect.getAttribute("width")),
    height: Number(nodeRect.getAttribute("height")),
  };
}

export function getNodeIconBox(nodeElement) {
  const icon = nodeElement.querySelector(".ping-editor__node-icon");

  return {
    x: Number(icon.getAttribute("x")),
    y: Number(icon.getAttribute("y")),
    width: Number(icon.getAttribute("width")),
    height: Number(icon.getAttribute("height")),
  };
}

export function createRoundedRectPath(x, y, width, height, radius) {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));

  if (clampedRadius === 0) {
    return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
  }

  return [
    `M ${x + clampedRadius} ${y}`,
    `H ${x + width - clampedRadius}`,
    `A ${clampedRadius} ${clampedRadius} 0 0 1 ${x + width} ${y + clampedRadius}`,
    `V ${y + height - clampedRadius}`,
    `A ${clampedRadius} ${clampedRadius} 0 0 1 ${x + width - clampedRadius} ${y + height}`,
    `H ${x + clampedRadius}`,
    `A ${clampedRadius} ${clampedRadius} 0 0 1 ${x} ${y + height - clampedRadius}`,
    `V ${y + clampedRadius}`,
    `A ${clampedRadius} ${clampedRadius} 0 0 1 ${x + clampedRadius} ${y}`,
    "Z",
  ].join(" ");
}

export function toScreenPath(route, camera = { x: 0, y: 0, scale: 1 }, config = DEFAULT_UI_CONFIG) {
  const points = route.points.map((point) => worldToScreen(point, camera, config));

  return `M ${points[0].x} ${points[0].y}${points
    .slice(1)
    .map((point) => ` L ${point.x} ${point.y}`)
    .join("")}`;
}

export async function createNodeFromMenu(harness, type) {
  harness.click(harness.container.querySelector('[data-action="open-menu"]'));
  await harness.flush();
  harness.click(harness.query(`palette-menu-${type}`));
  await harness.flush();
}

export function dispatchWheel(window, element, options = {}) {
  element.dispatchEvent(
    new window.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaX: options.deltaX ?? 0,
      deltaY: options.deltaY ?? 0,
      clientX: options.clientX ?? 0,
      clientY: options.clientY ?? 0,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: options.metaKey ?? false,
    }),
  );
}

export function dispatchKeydown(window, element, key, options = {}) {
  element.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    }),
  );
}

export function createGroupableSnapshot() {
  return {
    nodes: [
      { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
      { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
      { id: "node-c", type: "out", pos: { x: 10, y: 2 }, rot: 0, params: {} },
    ],
    edges: [
      {
        id: "edge-a",
        from: { nodeId: "node-a", portSlot: 0 },
        to: { nodeId: "node-b", portSlot: 0 },
        manualCorners: [],
      },
      {
        id: "edge-b",
        from: { nodeId: "node-b", portSlot: 0 },
        to: { nodeId: "node-c", portSlot: 0 },
        manualCorners: [],
      },
    ],
    groups: {},
  };
}

export async function openGroupDialogForConnectedPair(harness) {
  harness.pointerDown(harness.query("node-node-a"), { clientX: 80, clientY: 80 });
  harness.pointerUp({ clientX: 80, clientY: 80 });
  await harness.flush();

  harness.pointerDown(harness.query("node-node-b"), { clientX: 140, clientY: 80, shiftKey: true });
  harness.pointerUp({ clientX: 140, clientY: 80, shiftKey: true });
  await harness.flush();

  harness.click(harness.container.querySelector('[data-action="open-group-config"]'));
  await harness.flush();
}
