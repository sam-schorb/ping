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

test("editor renders add-node categories as a fixed stacked header instead of a scroller", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-action="open-menu"]'));
    await harness.flush();

    const categories = harness.container.querySelector(".ping-editor__menu-categories");
    assert.equal(categories?.getAttribute("data-menu-category-layout"), "stacked");
    assert.equal(harness.container.querySelectorAll(".ping-editor__menu-category-row").length, 2);
    assert.equal(harness.container.querySelector('[data-menu-category-id="constants"]'), null);
    assert.equal(harness.query("palette-menu-category-modifiers").textContent.trim(), "mods");

    harness.click(harness.query("palette-menu-category-routing"));
    await harness.flush();
    assert.equal(harness.query("palette-menu-category-routing").classList.contains("is-active"), true);

    harness.click(harness.query("palette-menu-category-basic"));
    await harness.flush();
    assert.equal(harness.query("palette-menu-category-basic").classList.contains("is-active"), true);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(styles, /\.ping-editor__menu-categories\s*\{[\s\S]*display:\s*grid;/);
    assert.match(
      styles,
      /\.ping-editor__menu-category-row\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--ping-menu-category-columns\),\s*minmax\(0,\s*1fr\)\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__menu-category\.is-active\s*\{[\s\S]*background:\s*var\(--ping-chrome-notice-soft\);[\s\S]*color:\s*var\(--ping-chrome-notice\);[\s\S]*border-color:\s*var\(--ping-chrome-notice-border\);/,
    );
    assert.doesNotMatch(
      styles,
      /\.ping-editor__menu-category\.is-active\s*\{[\s\S]*box-shadow:\s*inset 0 -2px 0/,
    );
    assert.doesNotMatch(styles, /\.ping-editor__menu-categories\s*\{[^}]*overflow-x:\s*auto;/);
    assert.match(
      styles,
      /\.ping-editor__menu\s*\{[\s\S]*border-radius:\s*24px;[\s\S]*background:\s*rgba\(251,\s*250,\s*248,\s*0\.97\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__menu-item\s*\{[\s\S]*border-radius:\s*16px;[\s\S]*background:\s*var\(--ping-chrome-card-strong\);/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("add-node menu search filters across all nodes and clears back to the active category", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-action="open-menu"]'));
    await harness.flush();

    harness.click(harness.query("palette-menu-category-routing"));
    await harness.flush();

    assert.equal(harness.query("palette-menu-category-routing").getAttribute("aria-pressed"), "true");
    assert.ok(harness.query("palette-menu-mux"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-pulse"]'), null);

    const searchInput = harness.query("palette-menu-search");
    searchInput.value = "pulse";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.equal(harness.container.querySelector(".ping-editor__menu-categories"), null);
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-search-summary"]'), null);
    assert.ok(harness.query("palette-menu-pulse"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-mux"]'), null);

    const clearedInput = harness.query("palette-menu-search");
    clearedInput.value = "";
    clearedInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.ok(harness.query("palette-menu-category-routing"));
    assert.equal(harness.query("palette-menu-category-routing").getAttribute("aria-pressed"), "true");
    assert.ok(harness.query("palette-menu-mux"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-pulse"]'), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("add-node menu autofocuses search and preserves focus while filtering", async () => {
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
    assert.equal(dom.window.document.activeElement, searchInput);

    searchInput.value = "pul";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    const updatedSearchInput = harness.query("palette-menu-search");
    assert.equal(dom.window.document.activeElement, updatedSearchInput);
    assert.equal(updatedSearchInput.value, "pul");
    assert.ok(harness.query("palette-menu-pulse"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("add-node menu auto-selects the top search result and Enter creates it immediately", async () => {
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
    searchInput.value = "dro";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    const dropItem = harness.query("palette-menu-drop");
    assert.equal(dropItem.getAttribute("data-menu-item-active"), "true");
    assert.equal(dropItem.classList.contains("is-active"), true);

    const updatedSearchInput = harness.query("palette-menu-search");
    updatedSearchInput.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="palette-menu"]'), null);
    assert.equal(harness.snapshot.nodes.find((node) => node.id === "node-1")?.type, "drop");
    assert.equal(dom.window.document.activeElement, harness.query("inline-param-node-1"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("add-node menu arrow keys move the selected search result before Enter creates it", async () => {
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
    searchInput.value = "de";
    searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    assert.equal(harness.query("palette-menu-demux").getAttribute("data-menu-item-active"), "true");
    assert.equal(harness.query("palette-menu-decay").getAttribute("data-menu-item-active"), "false");

    const updatedSearchInput = harness.query("palette-menu-search");
    updatedSearchInput.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.query("palette-menu-demux").getAttribute("data-menu-item-active"), "false");
    assert.equal(harness.query("palette-menu-decay").getAttribute("data-menu-item-active"), "true");

    const afterArrowSearchInput = harness.query("palette-menu-search");
    afterArrowSearchInput.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-testid="palette-menu"]'), null);
    assert.equal(harness.snapshot.nodes.find((node) => node.id === "node-1")?.type, "decay");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("add-node menu stays clickable through viewport-only rerenders", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    const harness = createEditorHarness({
      runtime: {
        ...runtime,
        pulsePhase: 0,
        getNodePulseState() {
          this.pulsePhase = (this.pulsePhase ?? 0) + 0.25;
          return [{ nodeId: "node-a", progress: this.pulsePhase % 1, receivedTick: 1 }];
        },
      },
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-action="open-menu"]'));
    await harness.flush();

    const menu = harness.query("palette-menu");
    const setItemBefore = harness.query("palette-menu-set");
    assert.ok(menu);
    assert.ok(setItemBefore);

    await harness.flush(2);

    const setItemAfter = harness.query("palette-menu-set");
    assert.equal(setItemAfter, setItemBefore);

    harness.click(setItemAfter);
    await harness.flush();

    assert.ok(harness.query("node-node-1"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu"]'), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("groups sidebar hides remove for in-use groups and opens the dialog clear of the sidebar", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-group", type: "group", groupRef: "group-a", pos: { x: 4, y: 4 }, rot: 0, params: {} }],
        edges: [],
        groups: {
          "group-a": {
            id: "group-a",
            name: "Group A",
            graph: {
              nodes: [{ id: "inner-add", type: "add", pos: { x: 0, y: 0 }, rot: 0, params: { param: 1 } }],
              edges: [],
            },
            inputs: [],
            outputs: [],
            controls: [],
          },
        },
      },
    });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="groups"]'));
    await harness.flush();

    assert.equal(
      harness.container.querySelector('[data-action="remove-group"][data-group-id="group-a"]'),
      null,
    );

    harness.click(harness.container.querySelector('[data-action="edit-group"][data-group-id="group-a"]'));
    await harness.flush();

    assert.equal(harness.query("group-config").classList.contains("is-sidebar-open"), true);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor__group-dialog\.is-sidebar-open\s*\{[\s\S]*right:\s*calc\(min\(320px,\s*48vw,\s*560px\)\s*\+\s*22px\);/,
    );
    assert.match(styles, /\.ping-editor__group-header\s*\{[\s\S]*padding-top:\s*4px;/);
    assert.match(
      styles,
      /\.ping-editor__group-dialog\s+\.ping-editor__panel-button:hover,[\s\S]*transform:\s*none;[\s\S]*border-color:\s*var\(--ping-chrome-notice-border\);/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor sidebar spans the full editor height and scrolls internally", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const sidebar = harness.query("editor-sidebar");
    assert.equal(sidebar.getAttribute("style"), null);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(styles, /\.ping-editor\s*\{[\s\S]*position:\s*relative;[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*0;[\s\S]*right:\s*0;[\s\S]*bottom:\s*0;/);
    assert.match(styles, /\.ping-editor__sidebar-content\s*\{[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*height:\s*100%;/);
    assert.match(styles, /\.ping-editor__sidebar\s*\{[\s\S]*overflow:\s*visible;/);
    assert.match(styles, /\.ping-editor__sidebar-content\s*\{[\s\S]*overflow:\s*hidden;/);
    assert.match(styles, /\.ping-editor__panel-scroll\s*\{[\s\S]*overflow:\s*auto;/);
    assert.doesNotMatch(
      styles,
      /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;[\s\S]*gap:\s*18px;/,
    );
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__toolbar-docs-button\s*\{[\s\S]*display:\s*inline-flex;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*52px;[\s\S]*left:\s*0;[\s\S]*right:\s*0;[\s\S]*width:\s*100%;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar\s*\{[\s\S]*border-left:\s*0;[\s\S]*border-right:\s*0;[\s\S]*overflow:\s*visible;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar\.is-collapsed\s*\{[\s\S]*display:\s*none;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar-toggle,\s*\.ping-editor__sidebar\.is-collapsed \.ping-editor__sidebar-toggle\s*\{[\s\S]*top:\s*0;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar-toggle-icon--desktop\s*\{[\s\S]*display:\s*none;[\s\S]*\.ping-editor__sidebar-toggle-icon--mobile\s*\{[\s\S]*display:\s*inline-flex;/);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor renders custom sidebar tabs and actions", async () => {
  const dom = setupDom();

  try {
    const sidebarActions = [];
    const harness = createEditorHarness({
      sidebarExtensions: {
        tabs: [
          {
            id: "outputs",
            label: "outputs",
            markup: `
              <section class="ping-editor__panel-section">
                <h2 class="ping-editor__panel-title">Outputs</h2>
                <p data-testid="custom-sidebar-panel">Custom panel</p>
              </section>
            `,
            testId: "tab-outputs",
          },
        ],
        actions: [
          {
            id: "open-import",
            label: "load project",
            testId: "open-import",
          },
        ],
      },
      onSidebarAction(actionId) {
        sidebarActions.push(actionId);
      },
    });
    await harness.flush();

    harness.click(harness.query("tab-outputs"));
    await harness.flush();
    assert.match(harness.query("custom-sidebar-panel").textContent, /custom panel/i);
    assert.ok(harness.query("open-import").closest(".ping-editor__sidebar-actions"));
    assert.equal(harness.query("open-import").closest(".ping-editor__tabs"), null);

    harness.click(harness.query("open-import"));
    await harness.flush();
    assert.deepEqual(sidebarActions, ["open-import"]);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor styles save action buttons without hover lift and with feedback states", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;

    assert.match(
      styles,
      /\.ping-editor__save-action-button\s*\{[\s\S]*transition:\s*[\s\S]*background-color 120ms ease/,
    );
    assert.match(
      styles,
      /\.ping-editor__save-action-button:hover,\s*\.ping-editor__save-action-button:active,\s*\.ping-editor__save-action-button\.is-feedback-active,\s*\.ping-editor__save-action-button\.is-feedback-success\s*\{[\s\S]*transform:\s*none;/,
    );
    assert.match(
      styles,
      /\.ping-editor__save-action-button:active,\s*\.ping-editor__save-action-button\.is-feedback-active\s*\{[\s\S]*color:\s*var\(--ping-chrome-accent-strong\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__save-action-button\.is-feedback-success\s*\{[\s\S]*box-shadow:\s*0 0 0 3px rgba\(141,\s*69,\s*54,\s*0\.16\);/,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor no longer exposes an inspect sidebar tab", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    assert.equal(harness.container.querySelector('[data-tab="inspect"]'), null);
    assert.equal(harness.container.querySelector('[data-testid="inspect-name"]'), null);
    assert.equal(harness.container.querySelector('[data-testid="inspect-param"]'), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("creating a param node auto-focuses the inline param field with the default value selected", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");

    const inlineParamInput = harness.query("inline-param-node-1");

    assert.ok(inlineParamInput);
    assert.equal(inlineParamInput.getAttribute("id"), "inline-param-node-1");
    assert.equal(inlineParamInput.getAttribute("name"), "inline-param-node-1");
    assert.equal(dom.window.document.activeElement, inlineParamInput);
    assert.equal(inlineParamInput.value, "1");
    assert.equal(inlineParamInput.selectionStart, 0);
    assert.equal(inlineParamInput.selectionEnd, 1);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("inline param field matches node label typography and zoom scaling", async () => {
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

    const beforeNode = harness.query("node-node-a");
    const beforeLabel = beforeNode.querySelector(".ping-editor__node-label");
    const beforeInlineParam = harness.query("inline-param-node-a");
    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    const beforeLabelFontSize = Number(beforeLabel.getAttribute("font-size"));
    const beforeInlineParamFontSize = Number.parseFloat(beforeInlineParam.style.fontSize);
    const beforeInlineParamWidth = Number.parseFloat(beforeInlineParam.style.width);

    assert.equal(beforeInlineParamFontSize, beforeLabelFontSize);
    assert.equal(beforeInlineParam.style.fontWeight, String(DEFAULT_UI_CONFIG.node.labelFontWeight));
    assert.equal(beforeInlineParam.style.padding, "0px 5px");
    assert.equal(/\.ping-editor__inline-param\s*\{[^}]*box-shadow:/m.test(styles), false);
    assert.equal(/\.ping-editor__inline-param:focus\s*\{[^}]*box-shadow:/m.test(styles), false);

    dispatchWheel(dom.window, harness.query("editor-viewport"), {
      deltaY: -40,
      ctrlKey: true,
      clientX: 320,
      clientY: 240,
    });
    await harness.flush();

    const afterNode = harness.query("node-node-a");
    const afterLabel = afterNode.querySelector(".ping-editor__node-label");
    const afterInlineParam = harness.query("inline-param-node-a");
    const afterLabelFontSize = Number(afterLabel.getAttribute("font-size"));
    const afterInlineParamFontSize = Number.parseFloat(afterInlineParam.style.fontSize);
    const afterInlineParamWidth = Number.parseFloat(afterInlineParam.style.width);

    assert.equal(afterInlineParamFontSize, afterLabelFontSize);
    assert.ok(afterInlineParamFontSize > beforeInlineParamFontSize);
    assert.ok(afterInlineParamWidth > beforeInlineParamWidth);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("inline param field pulses with the node body even while focused", async () => {
  const dom = setupDom();

  try {
    const runtime = createRuntimeStub();
    runtime.nodePulses = [{ nodeId: "node-a", progress: 0.5 }];
    const harness = createEditorHarness({
      runtime,
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 3 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush(5);

    const inlineParamInput = harness.query("inline-param-node-a");
    inlineParamInput.focus();
    await harness.flush(2);

    assert.equal(inlineParamInput.getAttribute("id"), "inline-param-node-a");
    assert.equal(inlineParamInput.getAttribute("name"), "inline-param-node-a");
    assert.equal(dom.window.document.activeElement, inlineParamInput);
    assert.match(
      inlineParamInput.getAttribute("style") ?? "",
      /transform:scale\(1\.\d{4}\);transform-origin:[^;]+;/,
    );

    const refreshedInlineParamInput = harness.query("inline-param-node-a");
    assert.equal(refreshedInlineParamInput.getAttribute("id"), "inline-param-node-a");
    assert.equal(refreshedInlineParamInput.getAttribute("name"), "inline-param-node-a");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("creating a param node preserves pending inline-param focus until deferred graph sync completes", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({ deferGraphOpsMs: 40 });
    await harness.flush();

    harness.click(harness.container.querySelector('[data-action="open-menu"]'));
    await harness.flush();
    harness.click(harness.query("palette-menu-pulse"));
    await harness.flush(1);

    assert.equal(harness.query("inline-param-node-1"), null);

    await new Promise((resolve) => dom.window.setTimeout(resolve, 60));
    await harness.flush();

    const inlineParamInput = harness.query("inline-param-node-1");

    assert.ok(inlineParamInput);
    assert.equal(dom.window.document.activeElement, inlineParamInput);
    assert.equal(inlineParamInput.value, "1");
    assert.equal(inlineParamInput.selectionStart, 0);
    assert.equal(inlineParamInput.selectionEnd, 1);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("inline param edits commit on Enter", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "set");

    const inlineParamInput = harness.query("inline-param-node-1");
    inlineParamInput.value = "11";
    inlineParamInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dispatchKeydown(dom.window, inlineParamInput, "Enter");
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-1")?.params.param,
      8,
    );
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some(
            (op) => op.type === "setParam" && op.payload.id === "node-1" && op.payload.param === 8,
          ),
      ),
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("inline param edits commit on blur and escape restores the last committed value", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "add", pos: { x: 2, y: 2 }, rot: 0, params: { param: 3 } }],
        edges: [],
        groups: {},
      },
      selection: { kind: "node", nodeId: "node-a" },
    });
    await harness.flush();

    const inlineParamInput = harness.query("inline-param-node-a");
    inlineParamInput.focus();
    inlineParamInput.value = "6";
    inlineParamInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    harness.query("editor-viewport").focus();
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.params.param,
      6,
    );

    const updatedInlineParamInput = harness.query("inline-param-node-a");
    updatedInlineParamInput.focus();
    updatedInlineParamInput.value = "7";
    updatedInlineParamInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dispatchKeydown(dom.window, updatedInlineParamInput, "Escape");
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.params.param,
      6,
    );
    assert.equal(harness.query("inline-param-node-a").value, "6");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("nodes without params do not render the inline param field", async () => {
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

    assert.equal(harness.container.querySelector('[data-testid="inline-param-node-a"]'), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("node labels render in the middle vertical third of the node face", async () => {
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

    const nodeElement = harness.query("node-node-a");
    const nodeLabel = nodeElement.querySelector(".ping-editor__node-label");
    const screenBox = getNodeScreenBox(nodeElement);
    const labelX = Number(nodeLabel.getAttribute("x"));
    const labelY = Number(nodeLabel.getAttribute("y"));

    assert.equal(nodeElement.querySelector(".ping-editor__node-icon"), null);
    assert.equal(Number(nodeLabel.getAttribute("font-size")), DEFAULT_UI_CONFIG.node.labelFontSizePx);
    assert.equal(Number(nodeLabel.getAttribute("font-weight")), DEFAULT_UI_CONFIG.node.labelFontWeight);
    assert.ok(Math.abs(labelX - (screenBox.x + screenBox.width / 2)) < 0.01);
    assert.ok(labelY > screenBox.y + screenBox.height / 3);
    assert.ok(labelY < screenBox.y + (screenBox.height * 2) / 3);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("sidebar wheel events do not pan the canvas", async () => {
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

    const before = getPortScreenPoint(harness.query("port-node-a-out-0"));
    dispatchWheel(dom.window, harness.query("editor-sidebar"), {
      deltaX: 36,
      deltaY: 48,
      clientX: 1120,
      clientY: 240,
    });
    await harness.flush();

    const after = getPortScreenPoint(harness.query("port-node-a-out-0"));
    assert.deepEqual(after, before);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
