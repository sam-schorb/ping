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

test("editor renders palette, fallback routes, diagnostics, and sample controls", async () => {
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

    harness.editor.setRoutes({ edgeRoutes: new Map(), edgeDelays: new Map() });
    harness.editor.setDiagnostics([
      {
        code: "BUILD_TEST",
        message: "Renderable diagnostic test.",
        severity: "warning",
        nodeId: "node-a",
      },
    ]);
    await harness.flush();

    assert.ok(harness.container.querySelector('[data-action="open-menu"]'));
    assert.ok(harness.query("tempo-input"));
    assert.equal(harness.query("tempo-input").getAttribute("type"), "range");
    assert.equal(harness.query("tempo-input").getAttribute("min"), "1");
    assert.equal(harness.query("tempo-input").getAttribute("max"), "100");
    assert.equal(harness.query("tempo-input").getAttribute("step"), "1");
    assert.equal(harness.query("tempo-input").value, String(DEFAULT_TEMPO_BPM));
    assert.ok(harness.query("reset-pulses"));
    assert.equal(
      [...harness.container.querySelectorAll(".ping-editor__panel-title")].some(
        (node) => node.textContent.trim() === "Palette",
      ),
      false,
    );
    harness.click(harness.container.querySelector('[data-tab="console"]'));
    await harness.flush();
    assert.equal(
      [...harness.container.querySelectorAll(".ping-editor__panel-title")].some(
        (node) => node.textContent.trim() === "Console",
      ),
      false,
    );
    assert.match(harness.query("diagnostic-0").textContent, /renderable diagnostic test/i);
    harness.click(harness.container.querySelector('[data-tab="samples"]'));
    await harness.flush();
    assert.equal(
      [...harness.container.querySelectorAll(".ping-editor__panel-title")].some(
        (node) => node.textContent.trim() === "Samples",
      ),
      false,
    );
    assert.equal(harness.query("sample-title-1").textContent.trim(), "kick1.mp3");
    assert.equal(harness.container.querySelector('[data-testid="sample-meta-1"]'), null);
    assert.equal(harness.query("sample-trigger-1").textContent.trim(), "Replace");
    assert.ok(harness.query("sample-input-1"));
    assert.equal(
      harness
        .query("edge-edge-a")
        .querySelector(".ping-editor__edge-path")
        .getAttribute("stroke-dasharray"),
      "4 3",
    );
    assert.equal(
      harness
        .query("edge-edge-a")
        .querySelector(".ping-editor__edge-hit")
        .getAttribute("stroke-width"),
      "10",
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor renders the canvas background as a single-color dot grid", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const grid = harness.container.querySelector(".ping-editor__grid");
    const gridBackground = grid.querySelector("rect");
    const gridDot = grid.querySelector("pattern circle");
    const gridPattern = grid.querySelector("pattern");

    assert.equal(gridBackground.getAttribute("fill"), DEFAULT_UI_CONFIG.canvas.background);
    assert.ok(gridDot);
    assert.equal(gridDot.getAttribute("fill"), DEFAULT_UI_CONFIG.canvas.gridLine);
    assert.ok(Number(gridDot.getAttribute("r")) >= 1.35);
    assert.equal(Number(gridDot.getAttribute("cx")), Number(gridPattern.getAttribute("width")) / 2);
    assert.equal(Number(gridDot.getAttribute("cy")), Number(gridPattern.getAttribute("height")) / 2);
    assert.equal(grid.querySelector("line"), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor abbreviates comparison node labels only on the node face", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-gt", type: "gtp", pos: { x: 2, y: 2 }, rot: 0, params: { param: 4 } },
          { id: "node-gte", type: "gtep", pos: { x: 8, y: 2 }, rot: 0, params: { param: 4 } },
          { id: "node-lt", type: "ltp", pos: { x: 14, y: 2 }, rot: 0, params: { param: 4 } },
          { id: "node-lte", type: "ltep", pos: { x: 20, y: 2 }, rot: 0, params: { param: 4 } },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    assert.equal(
      harness.query("node-node-gt").querySelector(".ping-editor__node-label")?.textContent.trim(),
      "GT",
    );
    assert.equal(harness.query("node-node-gt").getAttribute("aria-label"), "Greater Than");
    assert.equal(
      harness.query("node-node-gte").querySelector(".ping-editor__node-label")?.textContent.trim(),
      "GTE",
    );
    assert.equal(
      harness.query("node-node-gte").getAttribute("aria-label"),
      "Greater Than Equal",
    );
    assert.equal(
      harness.query("node-node-lt").querySelector(".ping-editor__node-label")?.textContent.trim(),
      "LT",
    );
    assert.equal(harness.query("node-node-lt").getAttribute("aria-label"), "Less Than");
    assert.equal(
      harness.query("node-node-lte").querySelector(".ping-editor__node-label")?.textContent.trim(),
      "LTE",
    );
    assert.equal(
      harness.query("node-node-lte").getAttribute("aria-label"),
      "Less Than Equal",
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("sample slots show distinct loaded and empty states", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="samples"]'));
    await harness.flush();
    assert.equal(harness.query("sample-title-1").textContent.trim(), "kick1.mp3");
    assert.equal(harness.container.querySelector('[data-testid="sample-meta-1"]'), null);
    assert.equal(harness.query("sample-trigger-1").textContent.trim(), "Replace");

    harness.editor.setSlots(
      createDefaultSampleSlots().map((slot, index) =>
        index === 0
          ? {
              ...slot,
              path: "",
            }
          : slot,
      ),
    );
    await harness.flush();

    assert.equal(harness.query("sample-title-1").textContent.trim(), "No sample loaded");
    assert.equal(harness.container.querySelector('[data-testid="sample-meta-1"]'), null);
    assert.equal(harness.query("sample-trigger-1").textContent.trim(), "Add");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor ports expose pulse, control, and output hover labels", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-switch", type: "switch", pos: { x: 4, y: 4 }, rot: 0, params: { param: 2 } },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const pulseInput = harness.query("port-node-switch-in-0");
    const controlInput = harness.query("port-node-switch-in-1");
    const firstOutput = harness.query("port-node-switch-out-0");
    const sixthOutput = harness.query("port-node-switch-out-5");

    assert.equal(pulseInput.getAttribute("aria-label"), "Switch: Pulse input");
    assert.equal(controlInput.getAttribute("aria-label"), "Switch: Control input");
    assert.equal(firstOutput.getAttribute("aria-label"), "Switch: Pulse output 1");
    assert.equal(sixthOutput.getAttribute("aria-label"), "Switch: Pulse output 6");
    assert.equal(pulseInput.querySelector("title")?.textContent, "Switch: Pulse input");
    assert.equal(controlInput.querySelector("title")?.textContent, "Switch: Control input");
    assert.equal(firstOutput.querySelector("title")?.textContent, "Switch: Pulse output 1");
    assert.equal(sixthOutput.querySelector("title")?.textContent, "Switch: Pulse output 6");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("grouped node ports expose mapping-aware hover labels", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 4 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {
          "group-a": {
            id: "group-a",
            name: "Group A",
            graph: {
              nodes: [
                { id: "inner-add", type: "add", name: "Mixer", pos: { x: 0, y: 0 }, rot: 0, params: { param: 2 } },
              ],
              edges: [],
            },
            inputs: [{ nodeId: "inner-add", portSlot: 0 }],
            outputs: [{ nodeId: "inner-add", portSlot: 0 }],
            controls: [{ nodeId: "inner-add", paramKey: "param" }],
          },
        },
      },
    });
    await harness.flush();

    const pulseInput = harness.query("port-node-group-in-0");
    const controlInput = harness.query("port-node-group-in-1");
    const output = harness.query("port-node-group-out-0");
    const groupNode = harness.query("node-node-group");
    const titleNodes = groupNode.querySelectorAll("title");

    assert.equal(pulseInput.getAttribute("aria-label"), "Group A: Mixer input 1");
    assert.equal(controlInput.getAttribute("aria-label"), "Group A: Mixer param");
    assert.equal(output.getAttribute("aria-label"), "Group A: Mixer output 1");
    assert.equal(pulseInput.querySelector("title")?.textContent, "Group A: Mixer input 1");
    assert.equal(controlInput.querySelector("title")?.textContent, "Group A: Mixer param");
    assert.equal(output.querySelector("title")?.textContent, "Group A: Mixer output 1");
    assert.equal(titleNodes[titleNodes.length - 1]?.textContent, "Group A");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor keeps toolbar and sidebar controls mounted while leaving canvas hover", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await harness.flush();

    harness.pointerMove(harness.query("node-node-1"), { clientX: 80, clientY: 80 });
    await harness.flush();

    const addNodeButton = harness.container.querySelector('[data-action="open-menu"]');
    assert.ok(addNodeButton);
    harness.pointerMove(addNodeButton, { clientX: 24, clientY: 24 });
    await harness.flush();
    assert.equal(addNodeButton.isConnected, true);

    harness.click(addNodeButton);
    await harness.flush();
    assert.ok(harness.query("palette-menu"));

    harness.pointerMove(harness.query("node-node-1"), { clientX: 80, clientY: 80 });
    await harness.flush();

    const consoleTab = harness.container.querySelector('[data-tab="console"]');
    assert.ok(consoleTab);
    harness.pointerMove(consoleTab, { clientX: 1120, clientY: 96 });
    await harness.flush();
    assert.equal(consoleTab.isConnected, true);

    harness.click(consoleTab);
    await harness.flush();
    assert.equal(
      harness.container.querySelector('[data-tab="console"]').classList.contains("is-active"),
      true,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor emits undo and redo requests from the toolbar and keyboard shortcuts", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.editor.setHistory({ canUndo: true, canRedo: true });
    await harness.flush();

    const undoButton = harness.query("undo-button");
    const redoButton = harness.query("redo-button");
    assert.equal(undoButton.disabled, false);
    assert.equal(redoButton.disabled, false);

    undoButton.focus();
    harness.click(undoButton);
    await harness.flush();
    assert.equal(harness.outputs.at(-1)?.type, "ui/requestUndo");
    assert.equal(dom.window.document.activeElement, harness.query("editor-viewport"));

    const outputCountBeforeUndoShortcut = harness.outputs.length;
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await harness.flush();
    assert.equal(harness.outputs.length, outputCountBeforeUndoShortcut + 1);
    assert.equal(harness.outputs.at(-1)?.type, "ui/requestUndo");

    const outputCountBeforeInputShortcut = harness.outputs.length;
    harness.query("tempo-input").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await harness.flush();
    assert.equal(harness.outputs.length, outputCountBeforeInputShortcut);

    const outputCountBeforeRedoShortcut = harness.outputs.length;
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await harness.flush();
    assert.equal(harness.outputs.length, outputCountBeforeRedoShortcut + 1);
    assert.equal(harness.outputs.at(-1)?.type, "ui/requestRedo");

    const outputCountBeforeRedoYShortcut = harness.outputs.length;
    harness.container.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await harness.flush();
    assert.equal(harness.outputs.length, outputCountBeforeRedoYShortcut + 1);
    assert.equal(harness.outputs.at(-1)?.type, "ui/requestRedo");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("tempo slider updates without replacing its DOM node", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.editor.setSidebarExtensions({
      tabs: [
        {
          id: "save",
          label: "project",
          markup: "<div>v1</div>",
          testId: "tab-save",
        },
      ],
      actions: [],
    });
    await harness.flush();

    const tempoInput = harness.query("tempo-input");
    tempoInput.value = "42";
    tempoInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.equal(harness.query("tempo-input"), tempoInput);
    assert.equal(tempoInput.value, "42");
    assert.equal(harness.outputs.at(-1)?.type, "audio/updateTempo");
    assert.equal(harness.outputs.at(-1)?.payload?.bpm, 42);

    harness.editor.setTempo(24);
    await harness.flush();

    assert.equal(harness.query("tempo-input"), tempoInput);
    assert.equal(tempoInput.value, "24");

    harness.editor.setSidebarExtensions({
      tabs: [
        {
          id: "save",
          label: "project",
          markup: "<div>v2</div>",
          testId: "tab-save",
        },
      ],
      actions: [],
    });
    await harness.flush();

    assert.equal(harness.query("tempo-input"), tempoInput);
    assert.equal(tempoInput.value, "24");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor orders the built-in sidebar tabs and uses compact history controls", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const tabIds = [...harness.container.querySelectorAll(".ping-editor__tabs [data-tab]")]
      .map((tab) => tab.getAttribute("data-tab"));

    assert.deepEqual(tabIds.slice(0, 5), ["docs", "code", "console", "groups", "samples"]);
    assert.equal(
      harness.container.querySelector('[data-tab="code"] .ping-editor__tab-label')?.textContent.trim(),
      "code",
    );
    assert.equal(harness.query("undo-button").getAttribute("aria-label"), "Undo");
    assert.equal(harness.query("redo-button").getAttribute("aria-label"), "Redo");
    assert.ok(harness.query("undo-button").querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.ok(harness.query("redo-button").querySelector(".ping-editor__toolbar-button-icon svg"));
    const addNodeButton = harness.container.querySelector('[data-action="open-menu"]');
    const createGroupButton = harness.container.querySelector('[data-action="open-group-config"]');
    assert.equal(addNodeButton?.querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(), "Add Node");
    assert.ok(addNodeButton?.querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.equal(
      createGroupButton?.querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(),
      "Create Group",
    );
    assert.ok(createGroupButton?.querySelector(".ping-editor__toolbar-button-icon svg"));
    const docsToolbarButton = harness.query("docs-toolbar-button");
    assert.equal(docsToolbarButton.querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(), "Docs");
    assert.ok(docsToolbarButton.querySelector(".ping-editor__toolbar-button-icon svg"));
    const rotateToolbarButton = harness.query("rotate-toolbar-button");
    assert.equal(
      rotateToolbarButton.querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(),
      "Rotate",
    );
    assert.ok(rotateToolbarButton.querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.equal(rotateToolbarButton.hasAttribute("disabled"), true);
    const deleteToolbarButton = harness.query("delete-toolbar-button");
    assert.equal(
      deleteToolbarButton.querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(),
      "Delete",
    );
    assert.ok(deleteToolbarButton.querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.equal(deleteToolbarButton.hasAttribute("disabled"), true);
    assert.equal(harness.query("reset-pulses").textContent.trim(), "Reset");
    assert.ok(harness.query("reset-pulses").querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.equal(
      harness.query("reset-pulses").nextElementSibling?.classList.contains("ping-editor__toolbar-field"),
      false,
    );
    assert.equal(
      harness.query("tempo-input").closest("label")?.classList.contains("ping-editor__toolbar-field"),
      true,
    );
    assert.equal(
      harness.query("tempo-popover-button").querySelector(".ping-editor__toolbar-button-label")?.textContent.trim(),
      "Tempo",
    );
    assert.ok(harness.query("tempo-popover-button").querySelector(".ping-editor__toolbar-button-icon svg"));
    assert.equal(harness.container.querySelector('[data-testid="tempo-popover"]'), null);
    const toolbarActions = [...harness.container.querySelectorAll(".ping-editor__toolbar [data-action]")].map((node) =>
      node.getAttribute("data-action"),
    );
    assert.deepEqual(toolbarActions.slice(0, 8), [
      "request-undo",
      "request-redo",
      "open-menu",
      "open-group-config",
      "delete-selection",
      "rotate-selection",
      "reset-pulses",
      "open-docs-sidebar",
    ]);
    assert.equal(harness.container.querySelector('[data-testid="selection-label"]'), null);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor\s*\{[\s\S]*--ping-chrome-top:\s*#f49595;[\s\S]*--ping-chrome-bottom:\s*#ffcfa3;[\s\S]*--ping-chrome-accent:\s*#9a523f;/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s*\{[\s\S]*gap:\s*6px;[\s\S]*justify-content:\s*flex-start;[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*5px 10px;[\s\S]*padding-inline-end:\s*calc\(10px \+ var\(--ping-toolbar-sidebar-clearance,\s*0px\)\);[\s\S]*background:\s*var\(--ping-chrome-shell\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s+\.ping-editor__panel-button,\s*\.ping-editor__toolbar-label\s*\{[\s\S]*font-size:\s*11px;[\s\S]*font-weight:\s*600;/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s+\.ping-editor__panel-button:hover\s*\{[\s\S]*transform:\s*none;/,
    );
    assert.match(
      styles,
      /\.ping-editor__field\.ping-editor__toolbar-field\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*6px;/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s+\.ping-editor__icon-button\s*\{[\s\S]*width:\s*24px;[\s\S]*height:\s*24px;/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar-slider\s*\{[\s\S]*width:\s*120px;[\s\S]*accent-color:\s*var\(--ping-chrome-accent\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s+\.ping-editor__toolbar-tempo-button\s*\{[\s\S]*display:\s*none;/,
    );
    assert.match(
      styles,
      /\.ping-editor__tempo-popover\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*calc\(100% \+ 8px\);[\s\S]*right:\s*0;[\s\S]*min-width:\s*184px;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__toolbar\s*\{[\s\S]*padding-inline-end:\s*10px;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__toolbar-docs-button\s*\{[\s\S]*display:\s*inline-flex;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__toolbar-rotate-button\s*\{[\s\S]*display:\s*inline-flex;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.ping-editor__toolbar\s+\.ping-editor__toolbar-tempo-button\s*\{[\s\S]*display:\s*inline-flex;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.ping-editor__field\.ping-editor__toolbar-tempo-field\s*\{[\s\S]*display:\s*none;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__toolbar-delete-button\s*\{[\s\S]*display:\s*inline-flex;/,
    );
    assert.match(
      styles,
      /@media \(max-width: 720px\)\s*\{[\s\S]*\.ping-editor__toolbar\s*\{[\s\S]*flex-wrap:\s*nowrap;[\s\S]*\[data-testid="undo-button"\],\s*\.ping-editor__toolbar\s*\[data-testid="redo-button"\]\s*\{[\s\S]*display:\s*none;[\s\S]*\.ping-editor__toolbar-button-icon\s*\{[\s\S]*display:\s*inline-flex;[\s\S]*\.ping-editor__toolbar-button-label,\s*\.ping-editor__toolbar-label\s*\{[\s\S]*display:\s*none;[\s\S]*\.ping-editor__toolbar-slider\s*\{[\s\S]*width:\s*clamp\(72px,\s*24vw,\s*96px\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__sidebar\s*\{[\s\S]*background:\s*var\(--ping-chrome-shell\);/,
    );
    assert.doesNotMatch(
      styles,
      /\.ping-editor__node\.is-group-selected\b/,
    );
    assert.match(styles, /\.ping-editor__node-selection-ring\s*\{[\s\S]*pointer-events:\s*none;/);
    assert.match(styles, /\.ping-editor__edge-path\.is-selected\s*\{[\s\S]*stroke:\s*#2b7fda;/);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("toolbar delete copy follows selection kind without adding cable-mode text", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "pulse", pos: { x: 6, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-out", type: "out", pos: { x: 12, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-a",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-out", portSlot: 0 },
            manualCorners: [{ x: 7, y: 2 }],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    const readDeleteToolbarLabel = () =>
      harness
        .query("delete-toolbar-button")
        .querySelector(".ping-editor__toolbar-button-label")
        ?.textContent.trim();

    assert.equal(readDeleteToolbarLabel(), "Delete");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("aria-label"), "Delete");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("title"), "Delete");

    harness.editor.setSelection({ kind: "node", nodeId: "node-a" });
    await harness.flush();
    assert.equal(readDeleteToolbarLabel(), "Delete Node");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("aria-label"), "Delete Node");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("title"), "Delete Node");

    harness.editor.setSelection({ kind: "edge", edgeId: "edge-a" });
    await harness.flush();
    assert.equal(readDeleteToolbarLabel(), "Delete Cable");

    harness.editor.setSelection({ kind: "corner", edgeId: "edge-a", cornerIndex: 0 });
    await harness.flush();
    assert.equal(readDeleteToolbarLabel(), "Delete Bend");

    const nodeABox = getNodeScreenBox(harness.query("node-node-a"));
    harness.pointerDown(harness.query("node-node-a"), {
      clientX: nodeABox.x + nodeABox.width / 2,
      clientY: nodeABox.y + nodeABox.height / 2,
    });
    harness.pointerUp({
      clientX: nodeABox.x + nodeABox.width / 2,
      clientY: nodeABox.y + nodeABox.height / 2,
    });
    await harness.flush();

    const nodeBBox = getNodeScreenBox(harness.query("node-node-b"));
    harness.pointerDown(harness.query("node-node-b"), {
      clientX: nodeBBox.x + nodeBBox.width / 2,
      clientY: nodeBBox.y + nodeBBox.height / 2,
      shiftKey: true,
    });
    harness.pointerUp({
      clientX: nodeBBox.x + nodeBBox.width / 2,
      clientY: nodeBBox.y + nodeBBox.height / 2,
      shiftKey: true,
    });
    await harness.flush();

    assert.equal(readDeleteToolbarLabel(), "Delete Nodes");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("aria-label"), "Delete Nodes");
    assert.equal(harness.query("delete-toolbar-button").getAttribute("title"), "Delete Nodes");

    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
      pointerType: "mouse",
      pointerId: 1,
    });
    await harness.flush();

    assert.equal(harness.query("desktop-cable-hint"), null);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.doesNotMatch(styles, /\.ping-editor__toolbar-cable-hint\s*\{/);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("docs tab renders alphabetical categories, sorted entries, and jump tags", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="docs"]'));
    await harness.flush();

    const tagLabels = [...harness.query("docs-tag-bank").querySelectorAll(".ping-editor__docs-tag")].map(
      (element) => element.textContent.trim(),
    );
    assert.deepEqual(
      tagLabels,
      ["all", "logic", "math", "modifiers", "routing", "sinks", "sources", "state", "code"],
    );

    const sectionIds = [...harness.container.querySelectorAll("[data-docs-category-id]")].map((element) =>
      element.getAttribute("data-docs-category-id"),
    );
    assert.deepEqual(
      sectionIds,
      ["logic", "math", "modifiers", "routing", "sinks", "sources", "state", "code"],
    );
    assert.equal(harness.container.querySelector('[data-testid="docs-section-groups"]'), null);
    assert.equal(harness.query("docs-section-code").querySelector(".ping-editor__docs-entry-title")?.textContent.trim(), "Code");

    const mathEntries = [
      ...harness.query("docs-section-math").querySelectorAll("[data-testid^='docs-entry-'] .ping-editor__docs-entry-title"),
    ].map((element) => element.textContent.trim());
    assert.deepEqual(mathEntries, ["Add", "Set", "Sub"]);

    const stateEntries = [
      ...harness.query("docs-section-state").querySelectorAll("[data-testid^='docs-entry-'] .ping-editor__docs-entry-title"),
    ].map((element) => element.textContent.trim());
    assert.deepEqual(stateEntries, ["Count", "Drop", "Every", "Random", "Step"]);

    assert.match(harness.query("docs-entry-pulse").textContent, /emit a fixed pulse value of 1/i);
    assert.match(harness.query("docs-entry-pulse").textContent, /ctrl:\s*sets the pulse rate\./i);
    assert.match(harness.query("docs-entry-out").textContent, /ctrl:\s*none\./i);
    assert.match(harness.query("docs-entry-step").textContent, /stride amount added on each pulse/i);
    assert.equal(
      harness.query("docs-entry-pulse").querySelector(".ping-editor__docs-tag")?.textContent.trim(),
      "sources",
    );
    assert.equal(
      harness.query("docs-entry-code").querySelector(".ping-editor__docs-tag")?.textContent.trim(),
      "code",
    );

    const panelScroll = harness.container.querySelector(".ping-editor__panel-scroll");
    const routingSection = harness.query("docs-section-routing");
    let lastScrollTo = null;
    panelScroll.scrollTop = 25;
    panelScroll.scrollTo = (options) => {
      lastScrollTo = options;
      const { top } = options;
      panelScroll.scrollTop = top;
    };
    panelScroll.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 320,
      height: 480,
      right: 320,
      bottom: 480,
    });
    routingSection.getBoundingClientRect = () => ({
      x: 0,
      y: 160,
      left: 0,
      top: 160,
      width: 320,
      height: 120,
      right: 320,
      bottom: 280,
    });

    harness.click(harness.query("docs-tag-routing"));
    await harness.flush();
    assert.equal(panelScroll.scrollTop, 177);
    assert.deepEqual(lastScrollTo, { top: 177, behavior: "auto" });

    harness.click(harness.query("docs-tag-all"));
    await harness.flush();
    assert.equal(panelScroll.scrollTop, 0);
    assert.deepEqual(lastScrollTo, { top: 0, behavior: "auto" });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("code tab renders the DSL guide as clean section cards with code examples", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="code"]'));
    await harness.flush();

    assert.ok(harness.query("code-panel"));
    assert.equal(harness.query("code-panel").querySelector(".ping-editor__code-panel-title"), null);

    const tagLabels = [...harness.query("code-tag-bank").querySelectorAll(".ping-editor__code-tag")].map(
      (element) => element.textContent.trim(),
    );
    assert.deepEqual(tagLabels, [
      "all",
      "overview",
      "inputs",
      "calls",
      "chains",
      "bindings",
      "mux",
      "demux",
      "outputs",
    ]);

    const sectionIds = [...harness.container.querySelectorAll("[data-docs-category-id]")].map((element) =>
      element.getAttribute("data-docs-category-id"),
    );
    assert.deepEqual(sectionIds, [
      "overview",
      "inputs",
      "calls",
      "chains",
      "bindings",
      "mux",
      "demux",
      "outputs",
    ]);

    assert.equal(
      harness.query("code-section-overview").querySelector(".ping-editor__code-section-title")?.textContent.trim(),
      "Start",
    );
    assert.equal(
      harness.query("code-example-overview-0").querySelector(".ping-editor__code-example-label")?.textContent.trim(),
      "Simple chain",
    );
    assert.match(
      harness.query("code-example-overview-0").querySelector(".ping-editor__code-block")?.textContent ?? "",
      /\$0\.every\(2\)\.count\(4\)\.outlet\(0\)/,
    );
    assert.match(
      harness.query("code-section-mux").textContent,
      /six indexed outputs/i,
    );
    assert.match(
      harness.query("code-example-demux-0").querySelector(".ping-editor__code-block")?.textContent ?? "",
      /\$0\.d\[0\]/,
    );
    assert.equal(harness.container.querySelector(".ping-editor__code-section-chip"), null);

    const panelScroll = harness.container.querySelector(".ping-editor__panel-scroll");
    const demuxSection = harness.query("code-section-demux");
    let lastScrollTo = null;
    panelScroll.scrollTop = 18;
    panelScroll.scrollTo = (options) => {
      lastScrollTo = options;
      panelScroll.scrollTop = options.top;
    };
    panelScroll.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 320,
      height: 480,
      right: 320,
      bottom: 480,
    });
    demuxSection.getBoundingClientRect = () => ({
      x: 0,
      y: 210,
      left: 0,
      top: 210,
      width: 320,
      height: 120,
      right: 320,
      bottom: 330,
    });

    harness.click(harness.query("code-tag-demux"));
    await harness.flush();
    assert.equal(panelScroll.scrollTop, 220);
    assert.deepEqual(lastScrollTo, { top: 220, behavior: "auto" });

    harness.click(harness.query("code-tag-all"));
    await harness.flush();
    assert.equal(panelScroll.scrollTop, 0);
    assert.deepEqual(lastScrollTo, { top: 0, behavior: "auto" });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("sidebar docs interactions do not leak into canvas selection or marquee state", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } }],
        edges: [],
        groups: {},
      },
      selection: { kind: "node", nodeId: "node-a" },
    });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="docs"]'));
    await harness.flush();

    const docsCopy = harness
      .query("docs-entry-pulse")
      .querySelector(".ping-editor__docs-entry-copy");

    harness.pointerDown(docsCopy, { clientX: 1100, clientY: 180 });
    harness.pointerMove(docsCopy, { clientX: 1120, clientY: 220 });
    await harness.flush();

    assert.equal(harness.container.querySelector(".ping-editor__selection-box"), null);

    harness.pointerUp({ clientX: 1120, clientY: 220 });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-a" });
    assert.equal(harness.container.querySelector(".ping-editor__selection-box"), null);

    harness.click(docsCopy);
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-a" });

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("narrow layouts start with the sidebar collapsed and use the metronome tempo popover", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      containerRectWidth: 680,
    });
    await harness.flush();

    assert.equal(harness.query("editor-sidebar").classList.contains("is-collapsed"), true);
    assert.equal(harness.query("sidebar-toggle").getAttribute("aria-label"), "Open sidebar");

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.ping-editor__toolbar\s+\.ping-editor__toolbar-tempo-button\s*\{[\s\S]*display:\s*inline-flex;/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.ping-editor__field\.ping-editor__toolbar-tempo-field\s*\{[\s\S]*display:\s*none;/,
    );

    harness.click(harness.query("tempo-popover-button"));
    await harness.flush();

    assert.ok(harness.query("tempo-popover"));
    assert.equal(harness.query("tempo-popover-button").getAttribute("aria-expanded"), "true");
    assert.equal(harness.container.querySelector('[data-testid="tempo-popover-value"]'), null);

    const popoverInput = harness.query("tempo-popover-input");
    popoverInput.value = "42";
    popoverInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.equal(harness.outputs.at(-1)?.type, "audio/updateTempo");
    assert.equal(harness.outputs.at(-1)?.payload?.bpm, 42);
    assert.equal(harness.query("tempo-input").value, "42");
    assert.equal(harness.query("tempo-popover-input").value, "42");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor sidebar collapses into a toggle bar and restores the active tab", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    assert.ok(harness.container.querySelector(".ping-editor__sidebar-header"));
    assert.ok(harness.container.querySelector(".ping-editor__sidebar-content"));
    assert.equal(
      harness.query("sidebar-toggle").parentElement,
      harness.query("editor-sidebar"),
    );
    assert.ok(harness.query("sidebar-toggle").querySelector(".ping-editor__sidebar-toggle-icon--desktop svg"));
    assert.ok(harness.query("sidebar-toggle").querySelector(".ping-editor__sidebar-toggle-icon--mobile svg"));
    assert.match(
      harness.container.querySelector(".ping-editor__toolbar").getAttribute("style") ?? "",
      /--ping-toolbar-sidebar-clearance:\s*calc\(calc\(min\(320px,\s*48vw,\s*560px\)\s*\*\s*1\.2\)\s*\+\s*32px\)/,
    );
    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor__sidebar\s*\{[^}]*top:\s*52px;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*overflow:\s*visible;[^}]*\}/,
    );
    assert.match(
      styles,
      /\.ping-editor__sidebar-toggle\s*\{[\s\S]*top:\s*12px;[\s\S]*inset-inline-start:\s*0;[\s\S]*transform:\s*translateX\(-100%\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__sidebar:not\(\.is-collapsed\) \.ping-editor__sidebar-toggle:hover\s*\{[\s\S]*transform:\s*translate\(-100%,\s*-1px\);/,
    );

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    assert.equal(
      harness.container.querySelector('[data-tab="groups"]').classList.contains("is-active"),
      true,
    );
    assert.equal(
      [...harness.container.querySelectorAll(".ping-editor__panel-title")].some(
        (node) => node.textContent.trim() === "Groups",
      ),
      false,
    );

    harness.click(harness.query("sidebar-toggle"));
    await harness.flush();
    assert.equal(harness.query("editor-sidebar").classList.contains("is-collapsed"), true);
    assert.equal(harness.query("sidebar-toggle").getAttribute("aria-label"), "Open sidebar");
    assert.match(
      harness.container.querySelector(".ping-editor__toolbar").getAttribute("style") ?? "",
      /--ping-toolbar-sidebar-clearance:\s*52px/,
    );
    assert.equal(harness.container.querySelector('[data-tab="groups"]'), null);

    harness.click(harness.query("docs-toolbar-button"));
    await harness.flush();
    assert.equal(harness.query("editor-sidebar").classList.contains("is-collapsed"), false);
    assert.equal(harness.query("sidebar-toggle").getAttribute("aria-label"), "Close sidebar");
    assert.match(
      harness.container.querySelector(".ping-editor__toolbar").getAttribute("style") ?? "",
      /--ping-toolbar-sidebar-clearance:\s*calc\(calc\(min\(320px,\s*48vw,\s*560px\)\s*\*\s*1\.2\)\s*\+\s*32px\)/,
    );
    assert.equal(
      harness.container.querySelector('[data-tab="docs"]').classList.contains("is-active"),
      true,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("shift-click grouping includes the original selected node", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-d", type: "add", pos: { x: 10, y: 2 }, rot: 0, params: { param: 2 } },
          { id: "node-c", type: "out", pos: { x: 14, y: 2 }, rot: 0, params: {} },
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
            to: { nodeId: "node-d", portSlot: 0 },
            manualCorners: [],
          },
          {
            id: "edge-c",
            from: { nodeId: "node-d", portSlot: 0 },
            to: { nodeId: "node-c", portSlot: 0 },
            manualCorners: [],
          },
        ],
        groups: {},
      },
    });
    await harness.flush();

    harness.pointerDown(harness.query("node-node-a"), { clientX: 80, clientY: 80 });
    harness.pointerUp({ clientX: 80, clientY: 80 });
    await harness.flush();

    harness.pointerDown(harness.query("node-node-b"), { clientX: 140, clientY: 80, shiftKey: true });
    harness.pointerUp({ clientX: 140, clientY: 80, shiftKey: true });
    await harness.flush();

    harness.query("editor-viewport").dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "G",
        bubbles: true,
      }),
    );
    await harness.flush();

    harness.click(harness.query("group-confirm"));
    await harness.flush();

    const groupId = Object.keys(harness.snapshot.groups)[0];
    assert.ok(groupId);
    assert.deepEqual(
      harness.snapshot.groups[groupId].graph.nodes.map((node) => node.id).sort(),
      ["node-a", "node-b"],
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("group dialog close actions remove the overlay", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: createGroupableSnapshot(),
    });
    await harness.flush();

    await openGroupDialogForConnectedPair(harness);
    assert.ok(harness.query("group-config"));

    harness.click(
      harness.container.querySelector('.ping-editor__group-header [data-action="close-group-config"]'),
    );
    await harness.flush();

    assert.equal(harness.query("group-config"), null);
    assert.equal(harness.query("group-confirm"), null);

    harness.click(harness.container.querySelector('[data-action="open-group-config"]'));
    await harness.flush();
    assert.ok(harness.query("group-config"));

    harness.click(
      harness.container.querySelector('.ping-editor__action-row [data-action="close-group-config"]'),
    );
    await harness.flush();

    assert.equal(harness.query("group-config"), null);
    assert.equal(harness.query("group-confirm"), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("group dialog blocks already-driven control inputs and can expose them instead with confirmation", async () => {
  const dom = setupDom();

  try {
    const confirmMessages = [];
    dom.window.confirm = (message) => {
      confirmMessages.push(message);
      return true;
    };

    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "add", pos: { x: 6, y: 2 }, rot: 0, params: { param: 3 } },
          { id: "node-c", type: "out", pos: { x: 10, y: 2 }, rot: 0, params: {} },
        ],
        edges: [
          {
            id: "edge-control",
            from: { nodeId: "node-a", portSlot: 0 },
            to: { nodeId: "node-b", portSlot: 1 },
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

    await openGroupDialogForConnectedPair(harness);
    assert.match(harness.query("group-controls-unavailable-0").textContent, /already driven internally/i);

    harness.click(
      harness.container.querySelector(
        '[data-action="group-expose-instead"][data-group-kind="controls"][data-group-id="control:node-b:slot:0"]',
      ),
    );
    await harness.flush();

    assert.ok(confirmMessages.length >= 1);
    assert.ok(
      confirmMessages.some((message) => /disconnect the internal control cable/i.test(message)),
    );
    assert.equal(harness.query("group-controls-unavailable-0"), null);

    harness.click(harness.query("group-confirm"));
    await harness.flush();

    const groupId = Object.keys(harness.snapshot.groups)[0];
    assert.ok(groupId);
    assert.equal(
      harness.snapshot.groups[groupId].controls.some(
        (entry) => entry.nodeId === "node-b" && entry.controlSlot === 0,
      ),
      true,
    );
    assert.equal(
      harness.snapshot.groups[groupId].graph.edges.some((edge) => edge.id === "edge-control"),
      false,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor renders sidebar tabs as a fixed header strip instead of a scroller", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="samples"]'));
    await harness.flush();
    assert.equal(
      harness.container.querySelector('[data-tab="samples"]').classList.contains("is-active"),
      true,
    );

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();
    assert.equal(
      harness.container.querySelector('[data-tab="groups"]').classList.contains("is-active"),
      true,
    );

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(styles, /\.ping-editor__sidebar-header\s*\{[\s\S]*border-bottom:\s*1px solid/);
    assert.match(
      styles,
      /\.ping-editor__tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(0,\s*1fr\)\);[\s\S]*min-height:\s*52px;/,
    );
    assert.doesNotMatch(styles, /\.ping-editor__tabs\s*\{[^}]*overflow-x:\s*auto;/);
    assert.match(styles, /\.ping-editor__tab \+ \.ping-editor__tab\s*\{[\s\S]*border-inline-start:/);
    assert.match(
      styles,
      /\.ping-editor__tab\s*\{[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center;[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*0 8px;/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("group dialog styles keep the primary action visible and spaced from the mappings", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor__panel-button\.is-primary\s*\{[\s\S]*background:\s*var\(--ping-chrome-accent\);[\s\S]*border-color:\s*var\(--ping-chrome-accent\);[\s\S]*color:\s*var\(--ping-chrome-on-accent\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__group-dialog \.ping-editor__action-row\s*\{[\s\S]*margin-top:\s*16px;/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
