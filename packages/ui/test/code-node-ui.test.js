import test from "node:test";
import assert from "node:assert/strict";

import { createCodeNodeGroupId } from "@ping/core";

import { createEditorHarness, setupDom } from "./helpers/harness.js";

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
