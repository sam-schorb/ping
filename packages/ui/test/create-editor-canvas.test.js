import {
  test,
  assert,
  createDefaultSampleSlots,
  DEFAULT_TEMPO_BPM,
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
  getPortScreenPoint,
  getNodeScreenBox,
  getNodeIconBox,
  createRoundedRectPath,
  toScreenPath,
  createNodeFromMenu,
  dispatchWheel,
  dispatchKeydown,
  createGroupableSnapshot,
  openGroupDialogForConnectedPair,
} from "./helpers/create-editor-test-helpers.js";

test("editor can create nodes, connect, move, rotate, and delete", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "out");

    assert.ok(harness.query("node-node-1"));
    assert.ok(harness.query("node-node-2"));

    const outputPort = harness.query("port-node-1-out-0");
    const inputPort = harness.query("port-node-2-in-0");
    const outputPoint = getPortScreenPoint(outputPort);
    const inputPoint = getPortScreenPoint(inputPort);

    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    assert.ok(harness.query("edge-edge-1"));

    const viewport = harness.query("editor-viewport");
    const nodeTwo = harness.query("node-node-2");
    harness.pointerDown(nodeTwo, { clientX: 160, clientY: 160 });
    harness.pointerMove(viewport, { clientX: 280, clientY: 220 });
    harness.pointerUp({ clientX: 280, clientY: 220 });
    await harness.flush();

    assert.notDeepEqual(
      harness.snapshot.nodes.find((node) => node.id === "node-2").pos,
      { x: 6, y: 4 },
    );

    harness.click(harness.query("node-node-2"));
    await harness.flush();
    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-2" });
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "R",
        bubbles: true,
      }),
    );
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((node) => node.id === "node-2").rot,
      90,
    );

    harness.click(harness.query("node-node-2"));
    await harness.flush();
    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-2" });
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.snapshot.nodes.some((node) => node.id === "node-2"), false);
    assert.equal(harness.snapshot.edges.length, 0);
    assert.ok(harness.outputs.some((output) => output.type === "ui/undoSnapshot"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor keeps dragged nodes visible at their transient position", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const node = harness.query("node-node-1");
    const before = getNodeScreenBox(node);

    harness.pointerDown(node, {
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
    });
    harness.pointerMove(viewport, {
      clientX: before.x + before.width / 2 + 120,
      clientY: before.y + before.height / 2 + 60,
    });
    await harness.flush();

    const draggedNode = harness.query("node-node-1");
    const during = getNodeScreenBox(draggedNode);
    const nodeLayer = harness.container.querySelector(".ping-editor__node-layer");
    const viewportCursor = harness.query("editor-viewport").style.cursor;

    assert.equal(draggedNode.isConnected, true);
    assert.notDeepEqual(during, before);
    assert.equal(nodeLayer?.lastElementChild?.getAttribute("data-node-id"), "node-1");
    assert.equal(viewportCursor, "grabbing");

    harness.pointerUp({
      clientX: before.x + before.width / 2 + 120,
      clientY: before.y + before.height / 2 + 60,
    });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor keeps the optimistic node position until the moved snapshot lands", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      deferGraphOpsMs: 30,
      snapshot: {
        nodes: [
          { id: "node-1", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const node = harness.query("node-node-1");
    const before = getNodeScreenBox(node);
    const target = {
      clientX: before.x + before.width / 2 + 120,
      clientY: before.y + before.height / 2 + 60,
    };

    harness.pointerDown(node, {
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
    });
    harness.pointerMove(viewport, target);
    await harness.flush();

    const during = getNodeScreenBox(harness.query("node-node-1"));

    harness.pointerUp(target);
    await flushFrames(dom.window, 1);

    const afterPointerUpBeforeSync = getNodeScreenBox(harness.query("node-node-1"));
    assert.notDeepEqual(afterPointerUpBeforeSync, before);

    await flushFrames(dom.window, 8);

    const afterSync = getNodeScreenBox(harness.query("node-node-1"));
    assert.deepEqual(afterSync, afterPointerUpBeforeSync);
    assert.notDeepEqual(afterSync, before);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor keeps the toolbar mounted during drag-driven viewport repaints", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const node = harness.query("node-node-1");
    const before = getNodeScreenBox(node);

    harness.pointerDown(node, {
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
    });
    await harness.flush();

    const undoButton = harness.query("undo-button");

    harness.pointerMove(viewport, {
      clientX: before.x + before.width / 2 + 96,
      clientY: before.y + before.height / 2 + 48,
    });
    await harness.flush();

    assert.equal(harness.query("undo-button"), undoButton);

    harness.pointerUp({
      clientX: before.x + before.width / 2 + 96,
      clientY: before.y + before.height / 2 + 48,
    });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("selecting a node keeps viewport focus so Backspace deletes the node and its connections", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    const node = harness.query("node-node-b");
    harness.pointerDown(node, { clientX: 216, clientY: 72 });
    harness.pointerUp({ clientX: 216, clientY: 72 });
    harness.click(node, { clientX: 216, clientY: 72 });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-b" });
    assert.equal(dom.window.document.activeElement, harness.query("editor-viewport"));

    dom.window.document.activeElement.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.snapshot.nodes.some((node) => node.id === "node-b"), false);
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("pointer-down on a cable selects it instead of starting marquee selection", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    const edgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");

    harness.pointerDown(edgeHit, { clientX: 144, clientY: 72 });
    harness.pointerMove(harness.query("editor-viewport"), { clientX: 156, clientY: 80 });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "edge", edgeId: "edge-a" });
    assert.equal(harness.container.querySelector(".ping-editor__selection-box"), null);

    harness.pointerUp({ clientX: 156, clientY: 80 });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("plain canvas drag marquee-selects nodes without panning the viewport", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-c", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const beforePort = getPortScreenPoint(harness.query("port-node-a-out-0"));
    const firstNodeRect = harness.query("node-node-a").querySelector("rect");
    const secondNodeRect = harness.query("node-node-b").querySelector("rect");
    const startX = Number(firstNodeRect.getAttribute("x")) - 8;
    const startY = Number(firstNodeRect.getAttribute("y")) - 8;
    const endX =
      Number(secondNodeRect.getAttribute("x")) +
      Number(secondNodeRect.getAttribute("width")) +
      8;
    const endY =
      Number(secondNodeRect.getAttribute("y")) +
      Number(secondNodeRect.getAttribute("height")) +
      8;

    harness.pointerDown(viewport, { clientX: startX, clientY: startY });
    harness.pointerMove(viewport, { clientX: endX, clientY: endY });
    await harness.flush();
    assert.ok(harness.container.querySelector(".ping-editor__selection-box"));

    harness.pointerUp({ clientX: endX, clientY: endY });
    await harness.flush();

    const afterPort = getPortScreenPoint(harness.query("port-node-a-out-0"));
    assert.deepEqual(afterPort, beforePort);
    assert.deepEqual(harness.selectedNodeIds.sort(), ["node-a", "node-b"]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("shift-drag marquee adds nodes to the existing selection", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-c", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-a"));
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const secondNodeRect = harness.query("node-node-b").querySelector("rect");
    const thirdNodeRect = harness.query("node-node-c").querySelector("rect");
    const startX = Number(secondNodeRect.getAttribute("x")) - 8;
    const startY = Number(secondNodeRect.getAttribute("y")) - 8;
    const endX =
      Number(thirdNodeRect.getAttribute("x")) +
      Number(thirdNodeRect.getAttribute("width")) +
      8;
    const endY =
      Number(thirdNodeRect.getAttribute("y")) +
      Number(thirdNodeRect.getAttribute("height")) +
      8;

    harness.pointerDown(viewport, { clientX: startX, clientY: startY, shiftKey: true });
    harness.pointerMove(viewport, { clientX: endX, clientY: endY, shiftKey: true });
    harness.pointerUp({ clientX: endX, clientY: endY, shiftKey: true });
    await harness.flush();

    assert.deepEqual(harness.selectedNodeIds.sort(), ["node-a", "node-b", "node-c"]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("dragging one node in a multi-selection moves the entire selected set", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-c", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-a"));
    await harness.flush();
    const secondNodeBox = getNodeScreenBox(harness.query("node-node-b"));
    harness.pointerDown(harness.query("node-node-b"), {
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    harness.pointerUp({
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    await harness.flush();

    const before = Object.fromEntries(
      harness.snapshot.nodes.map((node) => [node.id, { ...node.pos }]),
    );
    const node = harness.query("node-node-a");
    const box = getNodeScreenBox(node);

    harness.pointerDown(node, {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    });
    harness.pointerMove(harness.query("editor-viewport"), {
      clientX: box.x + box.width / 2 + 96,
      clientY: box.y + box.height / 2 + 48,
    });
    harness.pointerUp({
      clientX: box.x + box.width / 2 + 96,
      clientY: box.y + box.height / 2 + 48,
    });
    await harness.flush();

    const after = Object.fromEntries(
      harness.snapshot.nodes.map((node) => [node.id, { ...node.pos }]),
    );
    const deltaA = {
      x: after["node-a"].x - before["node-a"].x,
      y: after["node-a"].y - before["node-a"].y,
    };
    const deltaB = {
      x: after["node-b"].x - before["node-b"].x,
      y: after["node-b"].y - before["node-b"].y,
    };
    const deltaC = {
      x: after["node-c"].x - before["node-c"].x,
      y: after["node-c"].y - before["node-c"].y,
    };

    assert.notDeepEqual(deltaA, { x: 0, y: 0 });
    assert.deepEqual(deltaB, deltaA);
    assert.deepEqual(deltaC, { x: 0, y: 0 });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("Backspace deletes every node in the current multi-selection", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
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
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-a"));
    await harness.flush();
    const secondNodeBox = getNodeScreenBox(harness.query("node-node-b"));
    harness.pointerDown(harness.query("node-node-b"), {
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    harness.pointerUp({
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    await harness.flush();

    harness.query("editor-viewport").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
      }),
    );
    await harness.flush();

    assert.deepEqual(
      harness.snapshot.nodes.map((node) => node.id),
      ["node-c"],
    );
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("copy and paste duplicate a multi-selection with internal edges preserved", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-c", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [{ x: 4, y: 2 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-a"));
    await harness.flush();
    const secondNodeBox = getNodeScreenBox(harness.query("node-node-b"));
    harness.pointerDown(harness.query("node-node-b"), {
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    harness.pointerUp({
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    await harness.flush();

    const copiedData = harness.dispatchClipboard("copy", {
      target: harness.query("editor-viewport"),
    });
    const copiedPayload = JSON.parse(copiedData["application/x-ping-subgraph+json"]);

    harness.dispatchClipboard("paste", {
      target: harness.query("editor-viewport"),
      data: copiedData,
    });
    await harness.flush();

    assert.equal(harness.snapshot.nodes.length, 5);
    assert.equal(harness.snapshot.edges.length, 2);
    assert.equal(
      harness.snapshot.edges.filter((edge) => edge.from.nodeId !== "node-a" && edge.from.nodeId !== "node-b").length,
      1,
    );
    assert.equal(harness.selectedNodeIds.length, 2);

    const pastedNodes = harness.snapshot.nodes.filter(
      (node) => !["node-a", "node-b", "node-c"].includes(node.id),
    );
    assert.equal(pastedNodes.length, 2);
    assert.notDeepEqual(
      pastedNodes.map((node) => node.pos).sort((left, right) => left.x - right.x),
      copiedPayload.nodes.map((node) => node.pos).sort((left, right) => left.x - right.x),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("cut removes the selected nodes and paste restores a duplicated copy", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-a"));
    await harness.flush();
    const secondNodeBox = getNodeScreenBox(harness.query("node-node-b"));
    harness.pointerDown(harness.query("node-node-b"), {
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    harness.pointerUp({
      clientX: secondNodeBox.x + secondNodeBox.width / 2,
      clientY: secondNodeBox.y + secondNodeBox.height / 2,
      shiftKey: true,
    });
    await harness.flush();

    const cutData = harness.dispatchClipboard("cut", {
      target: harness.query("editor-viewport"),
    });
    await harness.flush();

    assert.equal(harness.snapshot.nodes.length, 0);
    assert.equal(harness.snapshot.edges.length, 0);

    harness.dispatchClipboard("paste", {
      target: harness.query("editor-viewport"),
      data: cutData,
    });
    await harness.flush();

    assert.equal(harness.snapshot.nodes.length, 2);
    assert.equal(harness.snapshot.edges.length, 1);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("copy shortcuts are ignored while typing in inline param fields", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "add", pos: { x: 2, y: 2 }, rot: 0, params: { param: 3 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const inlineParamInput = harness.query("inline-param-node-a");
    inlineParamInput.focus();
    const copiedData = harness.dispatchClipboard("copy", {
      target: inlineParamInput,
    });

    assert.deepEqual(copiedData, {});

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

