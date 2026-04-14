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

test("editor supports drag-based cable creation with manual corners", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "out");

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-1-out-0");
    const outputPoint = getPortScreenPoint(outputPort);

    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    assert.ok(harness.query("edge-preview"));

    const refreshedViewport = harness.query("editor-viewport");
    harness.pointerDown(refreshedViewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    harness.click(refreshedViewport, { clientX: 180, clientY: 120 });
    await harness.flush();
    const inputPort = harness.query("port-node-2-in-0");
    const inputPoint = getPortScreenPoint(inputPort);
    harness.pointerDown(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    harness.click(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    const createdEdge = harness.snapshot.edges[0];
    assert.ok(createdEdge);
    assert.equal(createdEdge.manualCorners.length, 1);
    assert.ok(harness.query(`edge-${createdEdge.id}`));
    assert.ok(harness.query(`corner-${createdEdge.id}-0`));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor collapses duplicate temporary cable corners before committing the edge", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    let viewport = harness.query("editor-viewport");
    harness.pointerDown(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    harness.click(viewport, { clientX: 180, clientY: 120 });
    await harness.flush();

    viewport = harness.query("editor-viewport");
    harness.pointerDown(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    harness.click(viewport, { clientX: 180, clientY: 120 });
    await harness.flush();

    const inputPort = harness.query("port-node-b-in-0");
    const inputPoint = getPortScreenPoint(inputPort);
    harness.pointerDown(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    harness.click(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    assert.equal(harness.snapshot.edges.length, 1);
    assert.deepEqual(harness.snapshot.edges[0].manualCorners, [{ x: 8, y: 5 }]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("double-clicking a selected edge inserts a bend after hidden collinear corners", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 12, y: 0 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [{ x: 6, y: 1 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    const insertScreenPoint = worldToScreen(
      { x: 8, y: 1 },
      { x: 0, y: 0, scale: 1 },
      DEFAULT_UI_CONFIG,
    );

    harness.click(harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit"), {
      clientX: insertScreenPoint.x,
      clientY: insertScreenPoint.y,
    });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "edge", edgeId: "edge-a" });

    const refreshedEdgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    harness.doubleClick(refreshedEdgeHit, {
      clientX: insertScreenPoint.x,
      clientY: insertScreenPoint.y,
    });
    await harness.flush();

    assert.deepEqual(harness.snapshot.edges[0].manualCorners, [
      { x: 6, y: 1 },
      { x: 8, y: 1 },
    ]);
    assert.ok(harness.query("corner-edge-a-1"));
    assert.match(
      harness.query("corner-handle-edge-a-1").getAttribute("class"),
      /\bis-visible\b/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("selected edge insertion on second click does not duplicate on the following dblclick event", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 12, y: 0 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 0 },
            manualCorners: [{ x: 6, y: 1 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    const insertScreenPoint = worldToScreen(
      { x: 8, y: 1 },
      { x: 0, y: 0, scale: 1 },
      DEFAULT_UI_CONFIG,
    );

    let edgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    harness.click(edgeHit, {
      clientX: insertScreenPoint.x,
      clientY: insertScreenPoint.y,
    });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "edge", edgeId: "edge-a" });

    edgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    harness.click(edgeHit, {
      clientX: insertScreenPoint.x,
      clientY: insertScreenPoint.y,
      detail: 2,
    });
    await harness.flush();

    assert.deepEqual(harness.snapshot.edges[0].manualCorners, [
      { x: 6, y: 1 },
      { x: 8, y: 1 },
    ]);

    edgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    harness.doubleClick(edgeHit, {
      clientX: insertScreenPoint.x,
      clientY: insertScreenPoint.y,
    });
    await harness.flush();

    assert.deepEqual(harness.snapshot.edges[0].manualCorners, [
      { x: 6, y: 1 },
      { x: 8, y: 1 },
    ]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor does not pan the canvas while an edge preview is active", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "out");

    const outputPort = harness.query("port-node-1-out-0");
    const before = getPortScreenPoint(outputPort);

    harness.pointerDown(outputPort, { clientX: before.x, clientY: before.y });
    harness.pointerMove(harness.query("editor-viewport"), { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    const refreshedViewport = harness.query("editor-viewport");
    harness.pointerDown(refreshedViewport, { clientX: 180, clientY: 120 });
    harness.pointerMove(refreshedViewport, { clientX: 320, clientY: 220 });
    harness.pointerUp({ clientX: 320, clientY: 220 });
    await harness.flush();

    const after = getPortScreenPoint(harness.query("port-node-1-out-0"));
    assert.deepEqual(after, before);
    assert.ok(harness.query("edge-preview"));
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor completes an active edge preview when the target port is clicked", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "out");

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-1-out-0");
    const outputPoint = getPortScreenPoint(outputPort);

    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    const refreshedInputPort = harness.query("port-node-2-in-0");
    const inputPoint = getPortScreenPoint(refreshedInputPort);
    harness.pointerDown(refreshedInputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    harness.click(refreshedInputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    const createdEdge = harness.snapshot.edges[0];
    assert.ok(createdEdge);
    assert.deepEqual(createdEdge.from, { nodeId: "node-1", portSlot: 0 });
    assert.deepEqual(createdEdge.to, { nodeId: "node-2", portSlot: 0 });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor escape cancels an active edge preview", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    assert.ok(harness.query("edge-preview"));

    dispatchKeydown(dom.window, harness.container, "Escape");
    await harness.flush();

    assert.equal(harness.query("edge-preview"), null);
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor backspace removes the last temporary cable corner before commit", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    const refreshedViewport = harness.query("editor-viewport");
    harness.pointerDown(refreshedViewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    harness.click(refreshedViewport, { clientX: 180, clientY: 120 });
    await harness.flush();

    const updatedViewport = harness.query("editor-viewport");
    harness.pointerDown(updatedViewport, { clientX: 240, clientY: 160 });
    harness.pointerUp({ clientX: 240, clientY: 160 });
    harness.click(updatedViewport, { clientX: 240, clientY: 160 });
    await harness.flush();

    dispatchKeydown(dom.window, harness.container, "Backspace");
    await harness.flush();

    const inputPort = harness.query("port-node-b-in-0");
    const inputPoint = getPortScreenPoint(inputPort);
    harness.pointerDown(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    harness.click(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    assert.equal(harness.snapshot.edges.length, 1);
    assert.deepEqual(harness.snapshot.edges[0].manualCorners, [{ x: 8, y: 5 }]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor delete cancels an active edge preview when no temporary corners remain", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    assert.ok(harness.query("edge-preview"));

    dispatchKeydown(dom.window, harness.container, "Delete");
    await harness.flush();

    assert.equal(harness.query("edge-preview"), null);
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("clicking the active source port cancels an edge preview", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    assert.ok(harness.query("edge-preview"));

    const refreshedOutputPort = harness.query("port-node-a-out-0");
    const refreshedOutputPoint = getPortScreenPoint(refreshedOutputPort);
    harness.pointerDown(refreshedOutputPort, {
      clientX: refreshedOutputPoint.x,
      clientY: refreshedOutputPoint.y,
    });
    harness.pointerUp({ clientX: refreshedOutputPoint.x, clientY: refreshedOutputPoint.y });
    harness.click(refreshedOutputPort, {
      clientX: refreshedOutputPoint.x,
      clientY: refreshedOutputPoint.y,
    });
    await harness.flush();

    assert.equal(harness.query("edge-preview"), null);
    assert.equal(harness.snapshot.edges.length, 0);
    assert.deepEqual(harness.selection, { kind: "none" });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("clicking another same-direction source restarts edge creation from that port", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "pulse", pos: { x: 2, y: 6 }, rot: 0, params: { param: 1 } },
          { id: "node-out", type: "out", pos: { x: 10, y: 4 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const firstSourcePort = harness.query("port-node-a-out-0");
    const secondSourcePort = harness.query("port-node-b-out-0");
    const inputPort = harness.query("port-node-out-in-0");
    const firstSourcePoint = getPortScreenPoint(firstSourcePort);
    const secondSourcePoint = getPortScreenPoint(secondSourcePort);
    const inputPoint = getPortScreenPoint(inputPort);

    harness.pointerDown(firstSourcePort, { clientX: firstSourcePoint.x, clientY: firstSourcePoint.y });
    harness.pointerMove(viewport, { clientX: 180, clientY: 120 });
    harness.pointerUp({ clientX: 180, clientY: 120 });
    await harness.flush();

    assert.ok(harness.query("edge-preview"));

    const refreshedSecondSourcePort = harness.query("port-node-b-out-0");
    const refreshedSecondSourcePoint = getPortScreenPoint(refreshedSecondSourcePort);
    harness.pointerDown(refreshedSecondSourcePort, {
      clientX: refreshedSecondSourcePoint.x,
      clientY: refreshedSecondSourcePoint.y,
    });
    harness.pointerUp({ clientX: refreshedSecondSourcePoint.x, clientY: refreshedSecondSourcePoint.y });
    harness.click(refreshedSecondSourcePort, {
      clientX: refreshedSecondSourcePoint.x,
      clientY: refreshedSecondSourcePoint.y,
    });
    await harness.flush();

    const refreshedInputPort = harness.query("port-node-out-in-0");
    const refreshedInputPoint = getPortScreenPoint(refreshedInputPort);
    harness.pointerDown(refreshedInputPort, {
      clientX: refreshedInputPoint.x,
      clientY: refreshedInputPoint.y,
    });
    harness.pointerUp({ clientX: refreshedInputPoint.x, clientY: refreshedInputPoint.y });
    harness.click(refreshedInputPort, {
      clientX: refreshedInputPoint.x,
      clientY: refreshedInputPoint.y,
    });
    await harness.flush();

    assert.equal(harness.snapshot.edges.length, 1);
    assert.deepEqual(harness.snapshot.edges[0].from, { nodeId: "node-b", portSlot: 0 });
    assert.deepEqual(harness.snapshot.edges[0].to, { nodeId: "node-out", portSlot: 0 });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("free-drag edge preview detours around blocking nodes before a target is hovered", async () => {
  const dom = setupDom();

  try {
    const baseSnapshot = {
      nodes: [
        { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: {} },
        { id: "node-blocker", type: "set", pos: { x: 5, y: -1 }, rot: 0, params: { param: 3 } },
      ],
      edges: [],
      groups: {},
    };
    const harness = createEditorHarness({ snapshot: baseSnapshot });
    await harness.flush();

    const outputPort = harness.query("port-node-pulse-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    const freeCursorScreen = {
      clientX: 12 * DEFAULT_UI_CONFIG.grid.GRID_PX,
      clientY: 1 * DEFAULT_UI_CONFIG.grid.GRID_PX,
    };

    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), freeCursorScreen);
    await harness.flush();

    const previewPath = harness.query("edge-preview").getAttribute("d");
    const expectedRoute = buildObstacleAwarePreviewRoute({
      snapshot: baseSnapshot,
      registry: TEST_REGISTRY,
      fromAnchor: getPortAnchor(
        baseSnapshot.nodes[0],
        "out",
        0,
        baseSnapshot,
        TEST_REGISTRY,
        "preview",
      ),
      toPoint: {
        x: freeCursorScreen.clientX / DEFAULT_UI_CONFIG.grid.GRID_PX,
        y: freeCursorScreen.clientY / DEFAULT_UI_CONFIG.grid.GRID_PX,
      },
      bendPreference: "horizontal-first",
      stubLength: 1,
    });

    assert.equal(previewPath, toScreenPath(expectedRoute));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("edge preview matches the committed routed path when hovering a valid target port", async () => {
  const dom = setupDom();

  try {
    const baseSnapshot = {
      nodes: [
        { id: "node-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: {} },
        { id: "node-blocker", type: "set", pos: { x: 5, y: -1 }, rot: 0, params: { param: 3 } },
        { id: "node-output", type: "out", pos: { x: 12, y: 0 }, rot: 0, params: {} },
      ],
      edges: [],
      groups: {},
    };
    const harness = createEditorHarness({ snapshot: baseSnapshot });
    await harness.flush();

    const outputPort = harness.query("port-node-pulse-out-0");
    const inputPort = harness.query("port-node-output-in-0");
    const outputPoint = getPortScreenPoint(outputPort);
    const inputPoint = getPortScreenPoint(inputPort);

    harness.pointerDown(outputPort, { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerMove(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    const previewPath = harness.query("edge-preview").getAttribute("d");
    const expectedRoute = routeGraph(
      {
        ...baseSnapshot,
        edges: [
          {
            id: "edge-preview",
            from: { nodeId: "node-pulse", portSlot: 0 },
            to: { nodeId: "node-output", portSlot: 0 },
            manualCorners: [],
          },
        ],
      },
      TEST_REGISTRY,
    ).edgeRoutes.get("edge-preview");

    assert.equal(previewPath, toScreenPath(expectedRoute));

    harness.pointerUp({ clientX: inputPoint.x, clientY: inputPoint.y });
    await harness.flush();

    const createdEdge = harness.snapshot.edges[0];
    assert.ok(createdEdge);
    assert.equal(
      harness
        .query(`edge-${createdEdge.id}`)
        .querySelector(".ping-editor__edge-path")
        .getAttribute("d"),
      previewPath,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor normalizes reverse-grab cable creation to output-to-input", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "out");

    const outputPort = harness.query("port-node-1-out-0");
    const inputPort = harness.query("port-node-2-in-0");
    const outputPoint = getPortScreenPoint(outputPort);
    const inputPoint = getPortScreenPoint(inputPort);

    harness.pointerDown(inputPort, { clientX: inputPoint.x, clientY: inputPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), { clientX: outputPoint.x, clientY: outputPoint.y });
    harness.pointerUp({ clientX: outputPoint.x, clientY: outputPoint.y });
    await harness.flush();

    const createdEdge = harness.snapshot.edges[0];
    assert.ok(createdEdge);
    assert.deepEqual(createdEdge.from, { nodeId: "node-1", portSlot: 0 });
    assert.deepEqual(createdEdge.to, { nodeId: "node-2", portSlot: 0 });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor supports grouping, diagnostics focus, sample slot updates, and reset", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    runtime.thumbs = [{ edgeId: "edge-a", progress: 0.5, speed: 1, emitTick: 0 }];

    const harness = createEditorHarness({
      runtime,
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

    assert.ok(harness.query("thumb-0"));
    assert.equal(harness.query("thumb-0").getAttribute("pointer-events"), "none");
    assert.equal(
      harness.container.querySelector(".ping-editor__thumb-layer")?.getAttribute("pointer-events"),
      "none",
    );

    harness.pointerDown(harness.query("node-node-a"), { clientX: 80, clientY: 80, shiftKey: true });
    harness.pointerUp({ clientX: 80, clientY: 80, shiftKey: true });
    harness.pointerDown(harness.query("node-node-b"), { clientX: 140, clientY: 80, shiftKey: true });
    harness.pointerUp({ clientX: 140, clientY: 80, shiftKey: true });
    await harness.flush();

    assert.equal(harness.snapshot.nodes.length, 3);

    harness.query("editor-viewport").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "G",
        bubbles: true,
      }),
    );
    await harness.flush();

    assert.ok(harness.query("group-config"));
    assert.equal(harness.query("group-preserve-delays").checked, false);
    harness.click(harness.query("group-confirm"));
    await harness.flush();

    assert.equal(Object.keys(harness.snapshot.groups).length, 1);
    assert.equal(
      harness.snapshot.groups[Object.keys(harness.snapshot.groups)[0]].preserveInternalCableDelays,
      false,
    );
    assert.ok(harness.snapshot.nodes.some((node) => node.type === "group"));
    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    const groupId = Object.keys(harness.snapshot.groups)[0];
    const inUseRemoveGroupButton = harness.container.querySelector(
      `[data-action="remove-group"][data-group-id="${groupId}"]`,
    );
    assert.equal(inUseRemoveGroupButton, null);

    harness.editor.setDiagnostics([
      {
        code: "BUILD_EDGE_TEST",
        message: "Focus edge test",
        severity: "error",
        edgeId: harness.snapshot.edges[0]?.id,
      },
    ]);
    await harness.flush();
    harness.click(harness.container.querySelector('[data-tab="console"]'));
    await harness.flush();
    harness.click(harness.query("diagnostic-0"));
    await harness.flush();
    assert.equal(harness.selection.kind, "edge");

    harness.click(harness.container.querySelector('[data-tab="samples"]'));
    await harness.flush();
    const sampleInput = harness.query("sample-input-1");
    Object.defineProperty(sampleInput, "files", {
      configurable: true,
      value: [new dom.window.File(["wave"], "kick.wav", { type: "audio/wav" })],
    });
    sampleInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await harness.flush(6);
    assert.match(harness.slots[0].path, /data:|kick\.wav/);
    assert.equal(harness.query("sample-title-1").textContent.trim(), "kick.wav");
    assert.equal(harness.container.querySelector('[data-testid="sample-meta-1"]'), null);
    assert.equal(harness.query("sample-trigger-1").textContent.trim(), "Replace");

    harness.click(harness.query("reset-pulses"));
    await harness.flush();
    assert.equal(runtime.resetCount, 1);
    assert.ok(harness.outputs.some((output) => output.type === "runtime/resetPulses"));

    const groupNode = harness.snapshot.nodes.find((node) => node.type === "group");
    harness.click(harness.query(`node-${groupNode.id}`));
    await harness.flush();
    harness.query("editor-viewport").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
      }),
    );
    await harness.flush();
    assert.equal(harness.snapshot.nodes.some((node) => node.type === "group"), false);

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    const removableGroupButton = harness.container.querySelector(
      `[data-action="remove-group"][data-group-id="${groupId}"]`,
    );
    assert.equal(removableGroupButton.disabled, false);
    harness.click(removableGroupButton);
    await harness.flush();
    assert.equal(Object.keys(harness.snapshot.groups ?? {}).length, 0);
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "removeGroup"),
      ),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor hides thumbs on edges connected to a dragged node until the drag completes", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    runtime.thumbs = [{ edgeId: "edge-a", progress: 0.5, speed: 1, emitTick: 0 }];

    const harness = createEditorHarness({
      runtime,
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

    assert.ok(harness.query("thumb-0"));

    const viewport = harness.query("editor-viewport");
    const node = harness.query("node-node-a");
    const before = getNodeScreenBox(node);

    harness.pointerDown(node, {
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
    });
    harness.pointerMove(viewport, {
      clientX: before.x + before.width / 2 + 96,
      clientY: before.y + before.height / 2 + 48,
    });
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="thumb-0"]'), null);

    harness.pointerUp({
      clientX: before.x + before.width / 2 + 96,
      clientY: before.y + before.height / 2 + 48,
    });
    await harness.flush();

    assert.ok(harness.query("thumb-0"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor also hides thumbs on unrelated edges that are preview-rerouted around a moved node", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    runtime.thumbs = [{ edgeId: "edge-a", progress: 0.5, speed: 1, emitTick: 0 }];

    const harness = createEditorHarness({
      runtime,
      snapshot: {
        nodes: [
          { id: "node-a-in", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
          { id: "node-a-out", type: "out", pos: { x: 12, y: 0 }, rot: 0, params: {} },
          { id: "node-b-in", type: "pulse", pos: { x: 0, y: 10 }, rot: 0, params: { param: 1 } },
          { id: "node-b-out", type: "out", pos: { x: 12, y: 10 }, rot: 0, params: {} },
          { id: "node-mover", type: "set", pos: { x: 18, y: 4 }, rot: 0, params: { param: 3 } },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a-in", portSlot: 0 },
            to: { nodeId: "node-a-out", portSlot: 0 },
            manualCorners: [],
          },
          {
            id: "edge-b",
            from: { nodeId: "node-b-in", portSlot: 0 },
            to: { nodeId: "node-b-out", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    assert.ok(harness.query("thumb-0"));

    const viewport = harness.query("editor-viewport");
    const mover = harness.query("node-node-mover");
    const before = getNodeScreenBox(mover);

    harness.pointerDown(mover, {
      clientX: before.x + before.width / 2,
      clientY: before.y + before.height / 2,
    });
    harness.pointerMove(viewport, {
      clientX: before.x + before.width / 2 - 312,
      clientY: before.y + before.height / 2 - 120,
    });
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="thumb-0"]'), null);

    runtime.thumbs = [{ edgeId: "edge-a", progress: 0.25, speed: 1, emitTick: 1 }];
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="thumb-0"]'), null);

    harness.pointerUp({
      clientX: before.x + before.width / 2 - 312,
      clientY: before.y + before.height / 2 - 120,
    });
    await harness.flush();

    assert.ok(harness.query("thumb-0"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("diagnostic focus selects the target without recentering the camera", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 20, y: 14 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    harness.editor.setDiagnostics([
      {
        code: "BUILD_TARGET_NODE",
        message: "Focus the far node without moving the camera.",
        severity: "warning",
        nodeId: "node-b",
      },
    ]);
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="console"]'));
    await harness.flush();

    const before = getNodeScreenBox(harness.query("node-node-b"));
    harness.click(harness.query("diagnostic-0"));
    await harness.flush();
    const after = getNodeScreenBox(harness.query("node-node-b"));

    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-b" });
    assert.deepEqual(after, before);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
