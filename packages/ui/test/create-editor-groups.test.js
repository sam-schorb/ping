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

test("editor supports menu creation, inline param edits, and context-menu rotate", async () => {
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

    assert.ok(harness.query("palette-menu-category-basic"));
    assert.equal(harness.query("palette-menu-category-basic").getAttribute("aria-pressed"), "true");
    assert.ok(harness.query("palette-menu-pulse"));
    assert.ok(harness.query("palette-menu-out"));
    assert.ok(harness.query("palette-menu-mux"));
    assert.ok(harness.query("palette-menu-every"));
    assert.ok(harness.query("palette-menu-set"));
    assert.equal(harness.container.querySelector(".ping-editor__menu-item-copy"), null);
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-add"]'), null);

    harness.click(harness.query("palette-menu-category-routing"));
    await harness.flush();
    assert.equal(harness.query("palette-menu-category-routing").getAttribute("aria-pressed"), "true");
    assert.ok(harness.query("palette-menu-mux"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-pulse"]'), null);

    harness.click(harness.query("palette-menu-category-basic"));
    await harness.flush();
    harness.click(harness.query("palette-menu-set"));
    await harness.flush();

    assert.ok(harness.query("node-node-1"));
    const paramInput = harness.query("inline-param-node-1");
    paramInput.focus();
    paramInput.value = "11";
    paramInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dispatchKeydown(dom.window, paramInput, "Enter");
    await harness.flush();

    harness.query("node-node-1").dispatchEvent(
      new dom.window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
    await harness.flush();

    const node = harness.snapshot.nodes.find((entry) => entry.id === "node-1");
    assert.equal(node.params.param, 8);
    assert.equal(node.rot, 90);
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "setParam"),
      ),
    );
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "setParam"),
      ),
    );
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "rotateNode"),
      ),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("groups can be edited from the sidebar without resetting dialog scroll", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [],
        edges: [],
        groups: {
          "group-a": {
            id: "group-a",
            name: "Group A",
            preserveInternalCableDelays: true,
            graph: {
              nodes: [
                { id: "inner-add", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } },
              ],
              edges: [],
            },
            inputs: [{ label: "Signal In", nodeId: "inner-add", portSlot: 0 }],
            outputs: [{ label: "Signal Out", nodeId: "inner-add", portSlot: 0 }],
            controls: [{ label: "Param", nodeId: "inner-add", paramKey: "param" }],
          },
        },
      },
    });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    harness.click(harness.container.querySelector('[data-action="edit-group"][data-group-id="group-a"]'));
    await harness.flush();
    assert.equal(harness.query("group-preserve-delays").checked, true);

    harness.query("group-config").scrollTop = 96;
    harness.click(
      harness.container.querySelector(
        '[data-action="group-remove-mapping"][data-group-kind="outputs"]',
      ),
    );
    await harness.flush();
    assert.equal(harness.query("group-config").scrollTop, 96);

    const nameInput = harness.query("group-name");
    nameInput.value = "Edited Group";
    nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();
    assert.equal(harness.query("group-config").scrollTop, 96);

    const preserveToggle = harness.query("group-preserve-delays");
    preserveToggle.checked = false;
    preserveToggle.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    harness.click(harness.query("group-confirm"));
    await harness.flush();

    assert.equal(harness.snapshot.groups["group-a"].name, "Edited Group");
    assert.equal(harness.snapshot.groups["group-a"].outputs.length, 0);
    assert.equal(harness.snapshot.groups["group-a"].preserveInternalCableDelays, false);
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "updateGroup"),
      ),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("group dialog preserves focused fields across rerenders", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [],
        edges: [],
        groups: {
          "group-a": {
            id: "group-a",
            name: "Group A",
            graph: {
              nodes: [
                { id: "pulse-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } },
                { id: "pulse-b", type: "pulse", pos: { x: 2, y: 0 }, rot: 0, params: { param: 3 } },
                { id: "pulse-c", type: "pulse", pos: { x: 4, y: 0 }, rot: 0, params: { param: 4 } },
              ],
              edges: [],
            },
            inputs: [{ label: "Signal In", nodeId: "pulse-a", portSlot: 0 }],
            outputs: [{ label: "Signal Out", nodeId: "pulse-a", portSlot: 0 }],
            controls: [{ label: "Param", nodeId: "pulse-a", paramKey: "param" }],
          },
        },
      },
    });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    harness.click(harness.container.querySelector('[data-action="edit-group"][data-group-id="group-a"]'));
    await harness.flush();

    const nameInput = harness.query("group-name");
    nameInput.focus();
    nameInput.value = "Edited Group";
    nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
    nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    harness.editor.setTempo(42);
    await harness.flush();

    const refreshedNameInput = harness.query("group-name");
    assert.equal(dom.window.document.activeElement, refreshedNameInput);
    assert.equal(refreshedNameInput.value, "Edited Group");
    assert.equal(refreshedNameInput.selectionStart, "Edited Group".length);
    assert.equal(refreshedNameInput.selectionEnd, "Edited Group".length);

    const outputSelectSelector = '[data-action="group-restore-select"][data-group-kind="outputs"]';
    const outputSelect = harness.container.querySelector(outputSelectSelector);
    assert.ok(outputSelect);
    outputSelect.focus();
    outputSelect.value = "output:pulse-c:0";
    outputSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

    harness.editor.setHistory({ canUndo: true, canRedo: false });
    await harness.flush();

    const refreshedOutputSelect = harness.container.querySelector(outputSelectSelector);
    assert.equal(dom.window.document.activeElement, refreshedOutputSelect);
    assert.equal(refreshedOutputSelect.value, "output:pulse-c:0");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("keyboard add-node creation uses the menu-open pointer anchor and focuses inline params for param nodes", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const firstOpenPoint = { clientX: 336, clientY: 240 };
    const viewport = harness.query("editor-viewport");
    harness.pointerMove(viewport, firstOpenPoint);
    viewport.focus();
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "N",
        bubbles: true,
      }),
    );
    await harness.flush();

    const addMenuItem = harness.query("palette-menu-set");
    assert.equal(dom.window.document.activeElement, harness.query("palette-menu-search"));
    addMenuItem.focus();
    harness.click(addMenuItem);
    await harness.flush();

    assert.deepEqual(harness.snapshot.nodes.find((node) => node.id === "node-1")?.pos, {
      x: Math.round(firstOpenPoint.clientX / DEFAULT_UI_CONFIG.grid.GRID_PX),
      y: Math.round(firstOpenPoint.clientY / DEFAULT_UI_CONFIG.grid.GRID_PX),
    });
    assert.equal(dom.window.document.activeElement, harness.query("inline-param-node-1"));

    const secondOpenPoint = { clientX: 456, clientY: 312 };
    const viewportAfterFirstCreate = harness.query("editor-viewport");
    harness.pointerMove(viewportAfterFirstCreate, secondOpenPoint);
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "N",
        bubbles: true,
      }),
    );
    await harness.flush();

    const pulseMenuItem = harness.query("palette-menu-pulse");
    assert.equal(dom.window.document.activeElement, harness.query("palette-menu-search"));
    pulseMenuItem.focus();
    harness.click(pulseMenuItem);
    await harness.flush();

    assert.deepEqual(harness.snapshot.nodes.find((node) => node.id === "node-2")?.pos, {
      x: Math.round(secondOpenPoint.clientX / DEFAULT_UI_CONFIG.grid.GRID_PX),
      y: Math.round(secondOpenPoint.clientY / DEFAULT_UI_CONFIG.grid.GRID_PX),
    });
    assert.equal(dom.window.document.activeElement, harness.query("inline-param-node-2"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("bare n opens the add-node menu from the document body but ignores unrelated focused controls", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    assert.equal(dom.window.document.activeElement, dom.window.document.body);

    dom.window.document.body.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "n",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.ok(harness.query("palette-menu"));

    dom.window.document.body.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "n",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="palette-menu"]'), null);
    assert.equal(dom.window.document.activeElement, harness.query("editor-viewport"));

    const outsideButton = dom.window.document.createElement("button");
    outsideButton.textContent = "outside";
    dom.window.document.body.append(outsideButton);
    outsideButton.focus();
    outsideButton.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "n",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="palette-menu"]'), null);

    outsideButton.remove();
    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor renders a box-selection overlay during shift-drag", async () => {
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

    const viewport = harness.query("editor-viewport");
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

    harness.pointerDown(viewport, { clientX: startX, clientY: startY, shiftKey: true });
    harness.pointerMove(viewport, { clientX: endX, clientY: endY, shiftKey: true });
    await harness.flush();
    assert.ok(harness.container.querySelector(".ping-editor__selection-box"));
    harness.pointerUp({ clientX: endX, clientY: endY, shiftKey: true });
    await harness.flush();
    assert.equal(harness.container.querySelector(".ping-editor__selection-box"), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor falls back for unknown nodes and ignores thumbs for missing edges", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    runtime.thumbs = [{ edgeId: "missing-edge", progress: 0.5, speed: 1, emitTick: 0 }];
    const container = document.createElement("div");
    container.dataset.rectWidth = "1280";
    container.dataset.rectHeight = "860";
    document.body.append(container);

    const editor = createEditor({
      registry: TEST_REGISTRY,
      runtime,
      onOutput() {},
    });

    editor.mount(container);
    editor.setSnapshot({
      nodes: [{ id: "node-x", type: "mystery", pos: { x: 2, y: 2 }, rot: 0, params: {} }],
      edges: [],
      groups: {},
    });
    editor.setRoutes({ edgeRoutes: new Map(), edgeDelays: new Map(), errors: [] });
    editor.setPalette(TEST_PALETTE);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 20));

    const unknownNode = container.querySelector('[data-testid="node-node-x"]');
    assert.ok(unknownNode);
    assert.match(unknownNode.getAttribute("aria-label") ?? "", /mystery/i);
    assert.equal(container.querySelector('[data-testid="thumb-0"]'), null);

    editor.unmount();
    container.remove();
  } finally {
    dom.cleanup();
  }
});
