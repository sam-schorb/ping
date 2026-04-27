import test from "node:test";
import assert from "node:assert/strict";

import {
  createCodeNodeGroupId,
  getLayout,
  getNodeDefinition,
  lowerGroupDsl,
} from "@ping/core";

import { createEditorHarness, setupDom } from "./helpers/harness.js";

const DSL_REGISTRY = Object.freeze({
  getNodeDefinition,
  getLayout,
});

function stylePx(element, name) {
  return Number.parseFloat(element.style[name] || "0");
}

function attrNumber(element, name) {
  return Number.parseFloat(element.getAttribute(name) || "0");
}

test("phase 10 code node appears in the palette and creates a private backing group", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "N",
        bubbles: true,
      }),
    );
    await harness.flush();

    const searchInput = harness.query("palette-menu-search");
    searchInput.value = "code";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("palette-menu-code"));
    await harness.flush();

    assert.ok(harness.query("node-node-1"));
    assert.ok(harness.snapshot.groups?.[createCodeNodeGroupId("node-1")]);
    assert.equal(harness.container.querySelector('[data-tab="inspect"]'), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 10 private code backing groups stay hidden from group-library UI", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    const privateGroupId = createCodeNodeGroupId("node-code");

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();

    assert.equal(
      harness.container.querySelector(`[data-testid="group-library-${privateGroupId}"]`),
      null,
    );

    harness.click(harness.container.querySelector('[data-action="open-menu"]'));
    await harness.flush();

    const searchInput = harness.query("palette-menu-search");
    searchInput.value = privateGroupId;
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.equal(
      harness.container.querySelector(`[data-testid="palette-menu-group-${privateGroupId}"]`),
      null,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node uses the edit button instead of a node face label", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    const node = harness.query("node-node-code");
    const nodeRect = node.querySelector(".ping-editor__node");
    const editButton = harness.query("code-node-edit-node-code");
    const buttonWidth = stylePx(editButton, "width");
    const buttonHeight = stylePx(editButton, "height");
    const buttonCenterX = stylePx(editButton, "left") + buttonWidth / 2;
    const buttonCenterY = stylePx(editButton, "top") + buttonHeight / 2;
    const nodeX = attrNumber(nodeRect, "x");
    const nodeY = attrNumber(nodeRect, "y");
    const nodeWidth = attrNumber(nodeRect, "width");
    const nodeHeight = attrNumber(nodeRect, "height");

    assert.equal(node.querySelector(".ping-editor__node-label"), null);
    assert.equal(node.querySelector(".ping-editor__node-icon"), null);
    assert.equal(node.getAttribute("aria-label"), "Code");
    assert.ok(editButton);
    assert.equal(editButton.getAttribute("aria-label"), "Code DSL");
    assert.ok(buttonWidth > buttonHeight);
    assert.ok(buttonHeight >= 24);
    assert.ok(Math.abs(buttonCenterX - (nodeX + nodeWidth / 2)) <= 1);
    assert.ok(buttonCenterY > nodeY + nodeHeight * 0.45);
    assert.ok(buttonCenterY < nodeY + nodeHeight * 0.6);

    for (let index = 0; index < 5; index += 1) {
      harness.query("editor-viewport").dispatchEvent(
        new dom.window.WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          deltaY: 80,
          clientX: 480,
          clientY: 320,
        }),
      );
      await harness.flush();
    }

    const zoomedButton = harness.query("code-node-edit-node-code");

    assert.ok(zoomedButton);
    assert.ok(stylePx(zoomedButton, "width") < buttonWidth);
    assert.ok(stylePx(zoomedButton, "height") < buttonHeight);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node edit button survives pulse-only redraws so clicks are not dropped", async () => {
  const dom = setupDom();

  try {
    let pulseProgress = null;
    const runtime = {
      getMetrics() {
        return { lastTickProcessed: 1 };
      },
      getPresentedActivity() {
        return {
          thumbs: [],
          nodePulseStates:
            pulseProgress === null
              ? []
              : [
                  {
                    nodeId: "node-code",
                    progress: pulseProgress,
                    receivedTick: 1,
                  },
                ],
        };
      },
      resetPulses() {},
    };
    const harness = createEditorHarness({ runtime });
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    const button = harness.query("code-node-edit-node-code");

    pulseProgress = 0.45;
    await harness.flush();

    assert.equal(harness.query("code-node-edit-node-code"), button);

    harness.click(button);
    await harness.flush();

    assert.ok(harness.query("code-editor-modal"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 12 code node canvas shows presented outlet activity on the collapsed visible node", async () => {
  const dom = setupDom();

  try {
    const runtime = {
      resetCount: 0,
      thumbs: [],
      getThumbState() {
        return this.thumbs;
      },
      getPresentedActivity() {
        return {
          thumbs: [],
          nodePulseStates: [
            {
              nodeId: "node-code",
              progress: 0.25,
              receivedTick: 1,
            },
          ],
        };
      },
      getMetrics() {
        return { lastTickProcessed: 1 };
      },
      resetPulses() {
        this.resetCount += 1;
      },
    };
    const groupId = createCodeNodeGroupId("node-code");
    const harness = createEditorHarness({
      runtime,
      snapshot: {
        nodes: [
          {
            id: "node-code",
            type: "code",
            groupRef: groupId,
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        ],
        edges: [],
        groups: {
          [groupId]: {
            id: groupId,
            name: "Code node-code",
            preserveInternalCableDelays: false,
            graph: {
              nodes: [
                {
                  id: "inner-pulse",
                  type: "pulse",
                  pos: { x: 0, y: 0 },
                  rot: 0,
                  params: { param: 1 },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
            controls: [],
          },
        },
      },
    });
    await harness.flush();

    const bodyGroup = harness
      .query("node-node-code")
      .querySelector(".ping-editor__node-body-group");

    assert.equal(bodyGroup?.getAttribute("data-pulse-progress"), "0.250");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 13 code node canvas renders projected visible thumbs instead of raw compiled edge ids", async () => {
  const dom = setupDom();

  try {
    const runtime = {
      resetCount: 0,
      thumbs: [
        {
          edgeId: "node-code::edge::inner-edge",
          progress: 0.5,
          speed: 1,
          emitTick: 0,
        },
      ],
      projectedThumbs: [
        {
          edgeId: "edge-visible",
          progress: 0.5,
          speed: 1,
          emitTick: 0,
        },
      ],
      nodePulses: [],
      getThumbState() {
        return this.thumbs;
      },
      getProjectedThumbState() {
        return this.projectedThumbs;
      },
      getPresentedActivity() {
        return {
          thumbs: this.projectedThumbs,
          nodePulseStates: [],
        };
      },
      getNodePulseState() {
        return this.nodePulses;
      },
      getMetrics() {
        return { lastTickProcessed: 1 };
      },
      resetPulses() {
        this.resetCount += 1;
      },
    };
    const groupId = createCodeNodeGroupId("node-code");
    const harness = createEditorHarness({
      runtime,
      snapshot: {
        nodes: [
          {
            id: "node-code",
            type: "code",
            groupRef: groupId,
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
          {
            id: "node-output",
            type: "out",
            pos: { x: 8, y: 4 },
            rot: 0,
            params: {},
          },
        ],
        edges: [
          {
            id: "edge-visible",
            from: { nodeId: "node-code", portSlot: 0 },
            to: { nodeId: "node-output", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {
          [groupId]: {
            id: groupId,
            name: "Code node-code",
            preserveInternalCableDelays: false,
            graph: {
              nodes: [
                {
                  id: "inner-pulse",
                  type: "pulse",
                  pos: { x: 0, y: 0 },
                  rot: 0,
                  params: { param: 1 },
                },
              ],
              edges: [],
            },
            inputs: [],
            outputs: [{ nodeId: "inner-pulse", portSlot: 0 }],
            controls: [],
          },
        },
      },
    });
    await harness.flush();

    assert.ok(harness.query("thumb-0"));
    assert.equal(harness.query("thumb-0").getAttribute("data-testid"), "thumb-0");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node opens a modal editor and cancel discards draft DSL", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    harness.click(harness.query("code-node-edit-node-code"));
    await harness.flush();

    const source = harness.query("code-editor-source");
    source.value = "pulse(1).outlet(0)";
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.container.querySelector('[data-action="cancel-code-editor"]'));
    await harness.flush();

    assert.equal(harness.query("code-editor-modal"), null);
    assert.equal(harness.snapshot.groups[createCodeNodeGroupId("node-code")].dsl.source, "");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node backdrop click cancels draft DSL", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    harness.click(harness.query("code-node-edit-node-code"));
    await harness.flush();

    const source = harness.query("code-editor-source");
    source.value = "pulse(1).outlet(0)";
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("code-editor-backdrop"));
    await harness.flush();

    assert.equal(harness.query("code-editor-modal"), null);
    assert.equal(harness.snapshot.groups[createCodeNodeGroupId("node-code")].dsl.source, "");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node OK applies valid DSL through the private backing group", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    harness.click(harness.query("code-node-edit-node-code"));
    await harness.flush();

    const source = harness.query("code-editor-source");
    source.value = "pulse(1).outlet(0)";
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("code-editor-apply"));
    await harness.flush();

    const group = harness.snapshot.groups[createCodeNodeGroupId("node-code")];

    assert.equal(harness.query("code-editor-modal"), null);
    assert.equal(group.dsl.source, "pulse(1).outlet(0)");
    assert.equal(group.outputs.length, 1);
    assert.ok(harness.query("port-node-code-out-0"));
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.reason === "edit code DSL" &&
          output.payload.ops.some((op) => op.type === "updateGroup"),
      ),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node invalid DSL keeps the modal open and leaves the group unchanged", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    harness.applyOps([
      {
        type: "addNode",
        payload: {
          node: {
            id: "node-code",
            type: "code",
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
        },
      },
    ]);
    await harness.flush();

    harness.click(harness.query("code-node-edit-node-code"));
    await harness.flush();

    const outputCountBefore = harness.outputs.length;
    const source = harness.query("code-editor-source");
    source.value = "$1.every(2).outlet(0)";
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("code-editor-apply"));
    await harness.flush();

    assert.ok(harness.query("code-editor-modal"));
    assert.ok(harness.query("code-editor-issues"));
    assert.equal(harness.snapshot.groups[createCodeNodeGroupId("node-code")].dsl.source, "");
    assert.equal(harness.outputs.length, outputCountBefore);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code node rejects valid DSL that would invalidate existing external cables", async () => {
  const dom = setupDom();

  try {
    const groupId = createCodeNodeGroupId("node-code");
    const lowered = lowerGroupDsl("pulse(1).outlet(0)", DSL_REGISTRY, {
      groupId,
      groupName: "Code node-code",
    });

    assert.equal(lowered.ok, true);

    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          {
            id: "node-code",
            type: "code",
            groupRef: groupId,
            pos: { x: 4, y: 4 },
            rot: 0,
            params: {},
          },
          {
            id: "node-output",
            type: "out",
            pos: { x: 8, y: 4 },
            rot: 0,
            params: {},
          },
        ],
        edges: [
          {
            id: "edge-visible",
            from: { nodeId: "node-code", portSlot: 0 },
            to: { nodeId: "node-output", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {
          [groupId]: lowered.group,
        },
      },
    });
    await harness.flush();

    harness.click(harness.query("code-node-edit-node-code"));
    await harness.flush();

    const outputCountBefore = harness.outputs.length;
    const source = harness.query("code-editor-source");
    source.value = "";
    source.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("code-editor-apply"));
    await harness.flush();

    assert.ok(harness.query("code-editor-modal"));
    assert.ok(harness.query("code-editor-issues"));
    assert.equal(harness.snapshot.groups[groupId].dsl.source, "pulse(1).outlet(0)");
    assert.equal(harness.outputs.length, outputCountBefore);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
