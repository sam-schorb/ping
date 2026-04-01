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

test("canvas pointer focus uses preventScroll to avoid page auto-scrolling", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const focusCalls = [];
    const originalFocus = viewport.focus.bind(viewport);

    viewport.focus = (options) => {
      focusCalls.push(options);
      originalFocus();
    };

    harness.pointerDown(viewport, { clientX: 320, clientY: 240 });

    assert.deepEqual(focusCalls, [{ preventScroll: true }]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("canvas pointer focus falls back cleanly when focus options are unsupported", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const focusCalls = [];

    viewport.focus = (options) => {
      focusCalls.push(options);

      if (options && typeof options === "object") {
        throw new TypeError("focus options unsupported");
      }
    };

    harness.pointerDown(viewport, { clientX: 320, clientY: 240 });

    assert.deepEqual(focusCalls, [{ preventScroll: true }, undefined]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor renders nested group snapshots without routing or build diagnostics", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-group", type: "group", groupRef: "group-b", pos: { x: 6, y: 2 }, rot: 0, params: {} },
          { id: "node-c", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-c",
            from: { nodeId: "node-group", portSlot: 0 },
            to: { nodeId: "node-c", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {
          "group-a": {
            id: "group-a",
            name: "Group A",
            graph: {
              nodes: [
                { id: "inner-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
                { id: "inner-add", type: "add", pos: { x: 4, y: 0 }, rot: 0, params: { param: 2 } },
                { id: "inner-input", type: "add", pos: { x: 4, y: 2 }, rot: 0, params: { param: 2 } },
              ],
              edges: [
                {
                  id: "child-edge",
                  from: { nodeId: "inner-pulse", portSlot: 0 },
                  to: { nodeId: "inner-add", portSlot: 0 },
                  manualCorners: [],
                },
              ],
            },
            inputs: [{ nodeId: "inner-input", portSlot: 0 }],
            outputs: [{ nodeId: "inner-add", portSlot: 0 }],
            controls: [],
          },
          "group-b": {
            id: "group-b",
            name: "Group B",
            graph: {
              nodes: [
                { id: "parent-pulse", type: "pulse", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } },
                { id: "child-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 0 }, rot: 0, params: {} },
              ],
              edges: [
                {
                  id: "parent-edge",
                  from: { nodeId: "parent-pulse", portSlot: 0 },
                  to: { nodeId: "child-group", portSlot: 0 },
                  manualCorners: [],
                },
              ],
            },
            inputs: [],
            outputs: [{ nodeId: "child-group", portSlot: 0 }],
            controls: [],
          },
        },
      },
    });
    await harness.flush();
    assert.ok(harness.query("node-node-group"));

    harness.click(harness.container.querySelector('[data-tab="console"]'));
    await harness.flush();
    assert.equal(harness.container.querySelector('[data-testid="diagnostic-0"]'), null);
    assert.match(harness.container.textContent, /No diagnostics\./);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor supports trackpad-style wheel pan", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const beforeWheelPan = getPortScreenPoint(harness.query("port-node-a-out-0"));
    dispatchWheel(dom.window, harness.query("editor-viewport"), {
      deltaX: 36,
      deltaY: 48,
      clientX: 420,
      clientY: 280,
    });
    await harness.flush();

    const afterWheelPan = getPortScreenPoint(harness.query("port-node-a-out-0"));
    assert.deepEqual(
      {
        x: Math.round(afterWheelPan.x - beforeWheelPan.x),
        y: Math.round(afterWheelPan.y - beforeWheelPan.y),
      },
      { x: -36, y: -48 },
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor uses default canvas cursor and crosshair during cable creation", async () => {
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
            manualCorners: [{ x: 6, y: 2 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    harness.pointerMove(harness.query("editor-viewport"), { clientX: 20, clientY: 20 });
    await harness.flush();
    assert.equal(harness.query("editor-viewport").style.cursor, "default");

    const outputPort = harness.query("port-node-a-out-0");
    const portPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, { clientX: portPoint.x, clientY: portPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), {
      clientX: portPoint.x + 80,
      clientY: portPoint.y + 48,
    });
    await harness.flush();
    assert.equal(harness.query("editor-viewport").style.cursor, "crosshair");
    harness.pointerUp({ clientX: portPoint.x + 80, clientY: portPoint.y + 48 });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor uses crosshair for box selection and move for corner drags", async () => {
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
            manualCorners: [{ x: 6, y: 2 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    harness.pointerDown(harness.query("editor-viewport"), {
      clientX: 40,
      clientY: 40,
      shiftKey: true,
    });
    harness.pointerMove(harness.query("editor-viewport"), {
      clientX: 100,
      clientY: 100,
      shiftKey: true,
    });
    await harness.flush();
    assert.equal(harness.query("editor-viewport").style.cursor, "crosshair");
    harness.pointerUp({ clientX: 100, clientY: 100, shiftKey: true });
    await harness.flush();

    const corner = harness.query("corner-edge-a-0");
    const cornerPoint = {
      x: Number(corner.getAttribute("cx")),
      y: Number(corner.getAttribute("cy")),
    };
    harness.pointerDown(corner, { clientX: cornerPoint.x, clientY: cornerPoint.y });
    harness.pointerMove(harness.query("editor-viewport"), {
      clientX: cornerPoint.x + 40,
      clientY: cornerPoint.y + 20,
    });
    await harness.flush();
    assert.equal(harness.query("editor-viewport").style.cursor, "move");
    harness.pointerUp({
      clientX: cornerPoint.x + 40,
      clientY: cornerPoint.y + 20,
    });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor reserves ctrl-wheel for zoom and keeps a full-width desktop viewport shell", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "out", pos: { x: 2, y: 2 }, rot: 0, params: {} }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const beforeZoom = getNodeScreenBox(harness.query("node-node-a"));
    dispatchWheel(dom.window, viewport, {
      deltaY: -40,
      ctrlKey: true,
      clientX: 320,
      clientY: 240,
    });
    await harness.flush();

    const afterZoom = getNodeScreenBox(harness.query("node-node-a"));
    assert.ok(afterZoom.width > beforeZoom.width);
    assert.ok(afterZoom.height > beforeZoom.height);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(styles, /\.ping-editor\s*\{[\s\S]*position:\s*relative;[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ping-editor__layout\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ping-editor__viewport-shell\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*100%;/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*min-width:\s*min\(320px,\s*48vw,\s*560px\);/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*width:\s*min\(320px,\s*48vw,\s*560px\);/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*max-width:\s*min\(320px,\s*48vw,\s*560px\);/);
    assert.match(styles, /\.ping-editor__sample-button\s*\{[\s\S]*padding:\s*4px 8px;[\s\S]*font-size:\s*10px;/);
    assert.match(styles, /\.ping-editor__sample-file-input\s*\{[\s\S]*clip-path:\s*inset\(100%\);/);
    assert.doesNotMatch(styles, /\.ping-editor__sample-slot input\[type="file"\]\s*\{/);
    assert.match(styles, /\.ping-editor__menu\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ping-editor__menu\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(styles, /\.ping-editor__menu-list\s*\{[\s\S]*overflow:\s*auto;/);
    assert.match(styles, /\.ping-editor__menu-item\s*\{[\s\S]*display:\s*flex;/);
    assert.match(
      styles,
      /\.ping-editor__menu-item:hover\s*\{[\s\S]*transform:\s*none;[\s\S]*border-color:\s*var\(--ping-chrome-notice-border\);/,
    );
    assert.doesNotMatch(styles, /\.ping-editor__menu-item:hover\s*\{[\s\S]*transform:\s*translateY\(-1px\);/);
    assert.ok(!styles.includes(".ping-editor__menu-item-copy"));
    assert.doesNotMatch(styles, /\.ping-editor__viewport-shell\s*\{[\s\S]*aspect-ratio:\s*1\s*\/\s*1;/);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("zooming in scales graph chrome while keeping hit targets stable", async () => {
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
    await harness.flush(6);

    const beforeNode = harness.query("node-node-a");
    const beforeRect = beforeNode.querySelector(".ping-editor__node");
    const beforePort = harness.query("port-node-a-out-0");
    const beforeEdgeOutline = harness.query("edge-edge-a").querySelector(".ping-editor__edge-outline");
    const beforeEdge = harness.query("edge-edge-a").querySelector(".ping-editor__edge-path");
    const beforeEdgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    const beforeLabel = beforeNode.querySelector(".ping-editor__node-label");
    const beforeIcon = beforeNode.querySelector(".ping-editor__node-icon");
    const beforeThumb = harness.query("thumb-0");

    for (let index = 0; index < 6; index += 1) {
      dispatchWheel(dom.window, harness.query("editor-viewport"), {
        deltaY: -40,
        ctrlKey: true,
        clientX: 320,
        clientY: 240,
      });
      await harness.flush();
    }

    const afterNode = harness.query("node-node-a");
    const afterRect = afterNode.querySelector(".ping-editor__node");
    const afterPort = harness.query("port-node-a-out-0");
    const afterEdgeOutline = harness.query("edge-edge-a").querySelector(".ping-editor__edge-outline");
    const afterEdge = harness.query("edge-edge-a").querySelector(".ping-editor__edge-path");
    const afterEdgeHit = harness.query("edge-edge-a").querySelector(".ping-editor__edge-hit");
    const afterLabel = afterNode.querySelector(".ping-editor__node-label");
    const afterIcon = afterNode.querySelector(".ping-editor__node-icon");
    const afterThumb = harness.query("thumb-0");

    assert.ok(Number(afterRect.getAttribute("width")) > Number(beforeRect.getAttribute("width")));
    assert.ok(Number(afterRect.getAttribute("rx")) > Number(beforeRect.getAttribute("rx")));
    assert.ok(Number(afterPort.getAttribute("r")) > Number(beforePort.getAttribute("r")));
    assert.ok(
      Number(afterEdgeOutline.getAttribute("stroke-width")) >
        Number(beforeEdgeOutline.getAttribute("stroke-width")),
    );
    assert.ok(
      Number(afterEdge.getAttribute("stroke-width")) > Number(beforeEdge.getAttribute("stroke-width")),
    );
    assert.equal(
      Number(afterEdgeHit.getAttribute("stroke-width")),
      Number(beforeEdgeHit.getAttribute("stroke-width")),
    );
    assert.ok(Number(afterLabel.getAttribute("font-size")) > Number(beforeLabel.getAttribute("font-size")));
    assert.equal(beforeIcon, null);
    assert.equal(afterIcon, null);
    assert.ok(Number(afterThumb.getAttribute("r")) > Number(beforeThumb.getAttribute("r")));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("nodes use the shared UI category themes instead of raw registry fills", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-pulse", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-add", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-out", type: "out", pos: { x: 10, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush(4);

    const pulseDefinition = TEST_REGISTRY.getNodeDefinition("pulse");
    const addDefinition = TEST_REGISTRY.getNodeDefinition("add");
    const outDefinition = TEST_REGISTRY.getNodeDefinition("out");
    const pulseTheme = resolveNodeTheme({
      category: pulseDefinition.category,
      color: pulseDefinition.color,
      config: DEFAULT_UI_CONFIG,
    });
    const addTheme = resolveNodeTheme({
      category: addDefinition.category,
      color: addDefinition.color,
      config: DEFAULT_UI_CONFIG,
    });
    const outTheme = resolveNodeTheme({
      category: outDefinition.category,
      color: outDefinition.color,
      config: DEFAULT_UI_CONFIG,
    });

    const pulseNode = harness.query("node-node-pulse");
    const addNode = harness.query("node-node-add");
    const outNode = harness.query("node-node-out");

    assert.equal(pulseNode.querySelector(".ping-editor__node").getAttribute("fill"), pulseTheme.fill);
    assert.equal(addNode.querySelector(".ping-editor__node").getAttribute("fill"), addTheme.fill);
    assert.equal(outNode.querySelector(".ping-editor__node").getAttribute("fill"), outTheme.fill);
    assert.equal(pulseNode.querySelector(".ping-editor__node-icon"), null);
    assert.equal(addNode.querySelector(".ping-editor__node-icon"), null);
    assert.equal(outNode.querySelector(".ping-editor__node-icon"), null);

    for (let index = 0; index < 8; index += 1) {
      dispatchWheel(dom.window, harness.query("editor-viewport"), {
        deltaY: 40,
        ctrlKey: true,
        clientX: 320,
        clientY: 240,
      });
      await harness.flush();
    }

    const pulseIcon = harness.query("node-node-pulse").querySelector(".ping-editor__node-icon path");
    const addIcon = harness.query("node-node-add").querySelector(".ping-editor__node-icon path");
    const outIcon = harness.query("node-node-out").querySelector(".ping-editor__node-icon path");

    assert.equal(
      pulseIcon.getAttribute("stroke"),
      pulseTheme.icon,
    );
    assert.equal(
      addIcon.getAttribute("stroke"),
      addTheme.icon,
    );
    assert.equal(
      outIcon.getAttribute("stroke"),
      outTheme.icon,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("palette menu icon chips share the same UI category theme mapping", async () => {
  const dom = setupDom();

  try {
    const customConfig = mergeUIConfig(DEFAULT_UI_CONFIG, {
      node: {
        categoryThemes: {
          default: {
            menuChip: "#e9ddcf",
          },
          Sources: {
            icon: "#9b533d",
            menuChip: "#f1ddd3",
          },
        },
      },
    });
    const harness = createEditorHarness({ config: customConfig });
    await harness.flush();

    const addNodeButton = harness.container.querySelector('[data-action="open-menu"]');
    assert.ok(addNodeButton);
    harness.click(addNodeButton);
    await harness.flush();

    const pulseDefinition = TEST_REGISTRY.getNodeDefinition("pulse");
    const pulseTheme = resolveNodeTheme({
      category: pulseDefinition.category,
      color: pulseDefinition.color,
      config: customConfig,
    });
    const pulseMenuItem = harness.query("palette-menu-pulse");
    const pulseIconWrap = pulseMenuItem.querySelector(".ping-editor__menu-item-icon-wrap");
    const pulseIconPath = pulseMenuItem.querySelector(".ping-editor__menu-item-icon path");

    assert.ok(pulseIconWrap.getAttribute("style")?.includes(`background:${pulseTheme.menuChip}`));
    assert.ok(pulseIconWrap.getAttribute("style")?.includes(`color:${pulseTheme.icon}`));
    assert.equal(pulseIconPath.getAttribute("stroke"), "currentColor");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("pulsed nodes scale the body chrome without moving ports and keep the normal stroke color", async () => {
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

    const beforeNode = harness.query("node-node-a");
    const beforeBodyGroup = beforeNode.querySelector(".ping-editor__node-body-group");
    const beforePulseInputPoint = getPortScreenPoint(harness.query("port-node-a-in-0"));
    const beforePulseOutputPoint = getPortScreenPoint(harness.query("port-node-a-out-0"));

    assert.equal(beforeBodyGroup.getAttribute("transform"), null);
    assert.equal(beforeBodyGroup.getAttribute("data-pulse-scale"), null);

    harness.runtime.nodePulses = [{ nodeId: "node-a", progress: 0.5, receivedTick: 1 }];
    await harness.flush();

    const pulsedNode = harness.query("node-node-a");
    const pulsedBodyGroup = pulsedNode.querySelector(".ping-editor__node-body-group");
    const pulsedNodeRect = pulsedNode.querySelector(".ping-editor__node");
    const afterPulseInputPoint = getPortScreenPoint(harness.query("port-node-a-in-0"));
    const afterPulseOutputPoint = getPortScreenPoint(harness.query("port-node-a-out-0"));

    assert.match(pulsedBodyGroup.getAttribute("transform"), /scale\(1\.04\)/);
    assert.equal(Number(pulsedBodyGroup.getAttribute("data-pulse-scale")), 1.04);
    assert.equal(Number(pulsedBodyGroup.getAttribute("data-pulse-progress")), 0.5);
    assert.equal(pulsedNodeRect.getAttribute("stroke"), DEFAULT_UI_CONFIG.node.stroke);
    assert.deepEqual(afterPulseInputPoint, beforePulseInputPoint);
    assert.deepEqual(afterPulseOutputPoint, beforePulseOutputPoint);

    for (let index = 0; index < 6; index += 1) {
      dispatchWheel(dom.window, harness.query("editor-viewport"), {
        deltaY: 40,
        ctrlKey: true,
        clientX: 320,
        clientY: 240,
      });
      await harness.flush();
    }

    const zoomedOutBodyGroup = harness.query("node-node-a").querySelector(".ping-editor__node-body-group");
    assert.ok(Number(zoomedOutBodyGroup.getAttribute("data-pulse-scale")) > 1.04);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("oversized grouped nodes cap pulse amplitude to the same absolute expansion as a 3x3 node", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          {
            id: "node-group",
            type: "group",
            groupRef: "group-large",
            pos: { x: 8, y: 2 },
            rot: 0,
            params: {},
          },
        ],
        edges: [],
        groups: {
          "group-large": {
            id: "group-large",
            name: "Large Group",
            graph: {
              nodes: [
                { id: "node-demux", type: "demux", pos: { x: 1, y: 1 }, rot: 0, params: {} },
                { id: "node-mux", type: "mux", pos: { x: 5, y: 1 }, rot: 0, params: {} },
              ],
              edges: [],
            },
            inputs: [
              { nodeId: "node-demux", portSlot: 0 },
              { nodeId: "node-demux", portSlot: 1 },
              { nodeId: "node-demux", portSlot: 2 },
              { nodeId: "node-demux", portSlot: 3 },
              { nodeId: "node-demux", portSlot: 4 },
              { nodeId: "node-demux", portSlot: 5 },
            ],
            outputs: [
              { nodeId: "node-mux", portSlot: 0 },
              { nodeId: "node-mux", portSlot: 1 },
              { nodeId: "node-mux", portSlot: 2 },
              { nodeId: "node-mux", portSlot: 3 },
              { nodeId: "node-mux", portSlot: 4 },
              { nodeId: "node-mux", portSlot: 5 },
            ],
            controls: [],
            preserveInternalCableDelays: false,
          },
        },
      },
    });
    await harness.flush();

    harness.runtime.nodePulses = [
      { nodeId: "node-a", progress: 0.5, receivedTick: 1 },
      { nodeId: "node-group", progress: 0.5, receivedTick: 1 },
    ];
    await harness.flush();

    const smallScale = Number(
      harness
        .query("node-node-a")
        .querySelector(".ping-editor__node-body-group")
        .getAttribute("data-pulse-scale"),
    );
    const largeScale = Number(
      harness
        .query("node-node-group")
        .querySelector(".ping-editor__node-body-group")
        .getAttribute("data-pulse-scale"),
    );

    assert.equal(smallScale, 1.04);
    assert.equal(largeScale, 1.0171);
    assert.ok(largeScale < smallScale);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("selected nodes drop the black body stroke while the highlight stays on the same path", async () => {
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

    const node = harness.query("node-node-a");
    const nodeRect = node.querySelector(".ping-editor__node");
    const nodeX = Number(nodeRect.getAttribute("x"));
    const nodeY = Number(nodeRect.getAttribute("y"));
    const nodeWidth = Number(nodeRect.getAttribute("width"));
    const nodeHeight = Number(nodeRect.getAttribute("height"));
    const nodeRadius = Number(nodeRect.getAttribute("rx"));
    const nodeStrokeWidth = Number(nodeRect.getAttribute("stroke-width"));
    const edgeOutline = harness.query("edge-edge-a").querySelector(".ping-editor__edge-outline");
    const edgePath = harness.query("edge-edge-a").querySelector(".ping-editor__edge-path");

    assert.equal(node.querySelector('[data-testid="node-selection-ring-node-a"]'), null);
    assert.equal(nodeRect.getAttribute("stroke"), DEFAULT_UI_CONFIG.node.stroke);
    assert.equal(edgeOutline.getAttribute("stroke"), DEFAULT_UI_CONFIG.node.stroke);
    assert.equal(edgePath.getAttribute("stroke"), DEFAULT_UI_CONFIG.edge.stroke);
    assert.ok(
      Number(edgeOutline.getAttribute("stroke-width")) > Number(edgePath.getAttribute("stroke-width")),
    );

    harness.click(node);
    await harness.flush();

    const selectedNode = harness.query("node-node-a");
    const selectedNodeRect = selectedNode.querySelector(".ping-editor__node");
    const selectionRing = harness.query("node-selection-ring-node-a");

    assert.equal(selectedNodeRect.getAttribute("stroke"), "none");
    assert.equal(selectedNodeRect.getAttribute("stroke-width"), "0");
    assert.equal(selectionRing.getAttribute("stroke"), DEFAULT_UI_CONFIG.selection.highlightColor);
    assert.equal(
      selectionRing.getAttribute("d"),
      createRoundedRectPath(nodeX, nodeY, nodeWidth, nodeHeight, nodeRadius),
    );
    assert.equal(Number(selectionRing.getAttribute("stroke-width")), nodeStrokeWidth * 3);

    harness.runtime.nodePulses = [{ nodeId: "node-a", progress: 0.5, receivedTick: 1 }];
    await harness.flush();

    const pulsedSelectedNode = harness.query("node-node-a");
    const pulsedSelectedNodeRect = pulsedSelectedNode.querySelector(".ping-editor__node");
    const pulsedSelectionRing = harness.query("node-selection-ring-node-a");
    const pulsedBodyGroup = pulsedSelectedNode.querySelector(".ping-editor__node-body-group");

    assert.match(pulsedBodyGroup.getAttribute("transform"), /scale\(1\.04\)/);
    assert.equal(pulsedSelectedNodeRect.getAttribute("stroke"), "none");
    assert.equal(pulsedSelectionRing.getAttribute("stroke"), DEFAULT_UI_CONFIG.selection.highlightColor);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("node labels hide sooner and icons move into the top two thirds when zoomed far out", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "out", pos: { x: 2, y: 2 }, rot: 0, params: {} }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const beforeNode = harness.query("node-node-a");
    assert.ok(beforeNode.querySelector(".ping-editor__node-label"));
    assert.equal(beforeNode.querySelector(".ping-editor__node-icon"), null);

    for (let index = 0; index < 4; index += 1) {
      dispatchWheel(dom.window, harness.query("editor-viewport"), {
        deltaY: 40,
        ctrlKey: true,
        clientX: 320,
        clientY: 240,
      });
      await harness.flush();
    }

    const afterNode = harness.query("node-node-a");
    const nodeBox = getNodeScreenBox(afterNode);
    const iconBox = getNodeIconBox(afterNode);
    const topBandHeight = (nodeBox.height * 2) / 3;

    assert.equal(afterNode.querySelector(".ping-editor__node-label"), null);
    assert.ok(Math.abs(iconBox.x - (nodeBox.x + (nodeBox.width - iconBox.width) / 2)) < 0.01);
    assert.ok(Math.abs(iconBox.y - (nodeBox.y + (topBandHeight - iconBox.height) / 2)) < 0.01);
    assert.ok(iconBox.y + iconBox.height <= nodeBox.y + topBandHeight + 0.01);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

