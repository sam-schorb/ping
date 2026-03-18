import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultSampleSlots, DEFAULT_TEMPO_BPM, routeGraph } from "@ping/core";
import { createEditor, DEFAULT_UI_CONFIG } from "../src/index.js";
import {
  createEditorHarness,
  createRuntimeStub,
  flushFrames,
  setupDom,
  TEST_PALETTE,
  TEST_REGISTRY,
} from "./helpers/harness.js";

function getPortScreenPoint(portElement) {
  return {
    x: Number(portElement.getAttribute("cx")),
    y: Number(portElement.getAttribute("cy")),
  };
}

function getNodeScreenBox(nodeElement) {
  const nodeRect = nodeElement.querySelector(".ping-editor__node");

  return {
    x: Number(nodeRect.getAttribute("x")),
    y: Number(nodeRect.getAttribute("y")),
    width: Number(nodeRect.getAttribute("width")),
    height: Number(nodeRect.getAttribute("height")),
  };
}

function getNodeIconBox(nodeElement) {
  const icon = nodeElement.querySelector(".ping-editor__node-icon");

  return {
    x: Number(icon.getAttribute("x")),
    y: Number(icon.getAttribute("y")),
    width: Number(icon.getAttribute("width")),
    height: Number(icon.getAttribute("height")),
  };
}

function createRoundedRectPath(x, y, width, height, radius) {
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

async function createNodeFromMenu(harness, type) {
  harness.click(harness.container.querySelector('[data-action="open-menu"]'));
  await harness.flush();
  harness.click(harness.query(`palette-menu-${type}`));
  await harness.flush();
}

function dispatchWheel(window, element, options = {}) {
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

test("editor renders palette, fallback routes, diagnostics, and sample controls", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor orders inspect before console and uses compact history controls", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    const tabIds = [...harness.container.querySelectorAll(".ping-editor__tabs [data-tab]")]
      .map((tab) => tab.getAttribute("data-tab"));

    assert.deepEqual(tabIds.slice(0, 4), ["inspect", "console", "groups", "samples"]);
    assert.equal(harness.query("undo-button").getAttribute("aria-label"), "Undo");
    assert.equal(harness.query("redo-button").getAttribute("aria-label"), "Redo");
    assert.equal(harness.query("undo-button").textContent.trim(), "←");
    assert.equal(harness.query("redo-button").textContent.trim(), "→");
    assert.equal(harness.query("reset-pulses").textContent.trim(), "Reset");
    assert.equal(
      harness.query("reset-pulses").nextElementSibling?.classList.contains("ping-editor__toolbar-field"),
      true,
    );
    assert.equal(
      harness.query("tempo-input").closest("label")?.classList.contains("ping-editor__toolbar-field"),
      true,
    );
    assert.equal(harness.container.querySelector('[data-testid="selection-label"]'), null);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor\s*\{[\s\S]*--ping-chrome-top:\s*#f49595;[\s\S]*--ping-chrome-bottom:\s*#ffcfa3;[\s\S]*--ping-chrome-accent:\s*#9a523f;/,
    );
    assert.match(
      styles,
      /\.ping-editor__toolbar\s*\{[\s\S]*gap:\s*6px;[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*5px 10px;[\s\S]*background:\s*var\(--ping-chrome-shell\);/,
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
    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
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
    assert.equal(harness.container.querySelector('[data-tab="groups"]'), null);

    harness.click(harness.query("sidebar-toggle"));
    await harness.flush();
    assert.equal(harness.query("editor-sidebar").classList.contains("is-collapsed"), false);
    assert.equal(harness.query("sidebar-toggle").getAttribute("aria-label"), "Close sidebar");
    assert.equal(
      harness.container.querySelector('[data-tab="groups"]').classList.contains("is-active"),
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
          { id: "node-c", type: "output", pos: { x: 10, y: 2 }, rot: 0, params: {} },
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
    assert.equal(harness.query("palette-menu-category-constants").textContent.trim(), "consts");
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
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor\s*\{[\s\S]*gap:\s*18px;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar\s*\{[\s\S]*position:\s*relative;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar-toggle,\s*\.ping-editor__sidebar\.is-collapsed \.ping-editor__sidebar-toggle\s*\{[\s\S]*top:\s*0;/);
    assert.match(styles, /@media \(max-width:\s*1180px\)\s*\{[\s\S]*\.ping-editor__sidebar-toggle-icon\s*\{[\s\S]*transform:\s*rotate\(90deg\);/);

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

test("editor exposes inspect as a dedicated sidebar tab", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    harness.click(harness.container.querySelector('[data-tab="inspect"]'));
    await harness.flush();
    assert.match(harness.container.textContent, /select a node, cable, or corner/i);

    harness.click(harness.container.querySelector('[data-tab="console"]'));
    await harness.flush();

    await createNodeFromMenu(harness, "add");
    await harness.flush();

    harness.click(harness.query("node-node-1"));
    await harness.flush();

    assert.equal(
      harness.container.querySelector('[data-tab="console"]').classList.contains("is-active"),
      true,
    );
    assert.equal(
      harness.container.querySelector('[data-tab="inspect"]').classList.contains("has-notice"),
      true,
    );
    assert.equal(
      harness.container.querySelector('[data-tab="inspect"]').getAttribute("aria-label"),
      "inspect (selection available)",
    );
    assert.equal(harness.container.querySelector('[data-testid="inspect-name"]'), null);

    const styles = harness.container.querySelector("[data-ping-editor-style]").textContent;
    assert.match(
      styles,
      /\.ping-editor__tab\.has-notice,\s*\.ping-editor__tab\.has-notice:hover,\s*\.ping-editor__tab\.has-notice:focus-visible\s*\{[^}]*color:\s*var\(--ping-chrome-notice\);/,
    );
    assert.match(
      styles,
      /\.ping-editor__tab\.is-active\s*\{[\s\S]*background:\s*var\(--ping-chrome-plate\);[\s\S]*box-shadow:\s*inset 0 -2px 0 var\(--ping-chrome-accent\);/,
    );
    assert.doesNotMatch(styles, /\.ping-editor__tab-notice\b/);

    harness.click(harness.container.querySelector('[data-tab="inspect"]'));
    await harness.flush();

    assert.equal(
      harness.container.querySelector('[data-tab="inspect"]').classList.contains("is-active"),
      true,
    );
    assert.equal(
      harness.container.querySelector('[data-tab="inspect"]').classList.contains("has-notice"),
      true,
    );
    assert.ok(harness.query("inspect-name"));
    assert.ok(harness.query("inspect-param"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("pulse inspect uses the single param field as rate control", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          {
            id: "node-pulse",
            type: "pulse",
            pos: { x: 2, y: 2 },
            rot: 0,
            params: { param: 4 },
          },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    harness.click(harness.query("node-node-pulse"));
    await harness.flush();
    harness.click(harness.container.querySelector('[data-tab="inspect"]'));
    await harness.flush();

    const rateInput = harness.query("inspect-param");

    assert.equal(rateInput.previousElementSibling?.textContent, "Rate");
    assert.equal(rateInput.value, "4");

    rateInput.value = "11";
    rateInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-pulse")?.params.param,
      8,
    );
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some(
            (op) =>
              op.type === "setParam" &&
              op.payload.id === "node-pulse" &&
              op.payload.param === 8,
          ),
      ),
    );

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

test("editor can create nodes, connect, move, rotate, and delete", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "output");

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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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
          { id: "node-c", type: "output", pos: { x: 12, y: 2 }, rot: 0, params: {} },
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
          { id: "node-c", type: "output", pos: { x: 12, y: 2 }, rot: 0, params: {} },
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
          { id: "node-c", type: "output", pos: { x: 12, y: 2 }, rot: 0, params: {} },
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
          { id: "node-c", type: "output", pos: { x: 10, y: 2 }, rot: 0, params: {} },
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
          { id: "node-c", type: "output", pos: { x: 12, y: 2 }, rot: 0, params: {} },
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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

test("copy shortcuts are ignored while typing in inspect fields", async () => {
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

    harness.click(harness.query("node-node-a"));
    await harness.flush();
    harness.click(harness.container.querySelector('[data-tab="inspect"]'));
    await harness.flush();

    const nameInput = harness.query("inspect-name");
    nameInput.focus();
    const copiedData = harness.dispatchClipboard("copy", {
      target: nameInput,
    });

    assert.deepEqual(copiedData, {});

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor supports drag-based cable creation with manual corners", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "output");

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

test("editor does not pan the canvas while an edge preview is active", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "output");

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
    await createNodeFromMenu(harness, "output");

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

test("editor normalizes reverse-grab cable creation to output-to-input", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness();
    await harness.flush();

    await createNodeFromMenu(harness, "pulse");
    await createNodeFromMenu(harness, "output");

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
          { id: "node-c", type: "output", pos: { x: 10, y: 2 }, rot: 0, params: {} },
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
    harness.click(harness.query("group-confirm"));
    await harness.flush();

    assert.equal(Object.keys(harness.snapshot.groups).length, 1);
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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

test("diagnostic focus selects the target without recentering the camera", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "output", pos: { x: 20, y: 14 }, rot: 0, params: {} },
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } }],
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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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
    assert.ok(Number(afterIcon.getAttribute("width")) > Number(beforeIcon.getAttribute("width")));
    assert.ok(Number(afterThumb.getAttribute("r")) > Number(beforeThumb.getAttribute("r")));

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
          { id: "node-b", type: "output", pos: { x: 8, y: 2 }, rot: 0, params: {} },
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

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("node labels hide and icons recenter when zoomed far out", async () => {
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

    const beforeNode = harness.query("node-node-a");
    const beforeIconBox = getNodeIconBox(beforeNode);
    assert.ok(beforeNode.querySelector(".ping-editor__node-label"));

    for (let index = 0; index < 8; index += 1) {
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

    assert.equal(afterNode.querySelector(".ping-editor__node-label"), null);
    assert.ok(iconBox.width > beforeIconBox.width);
    assert.ok(iconBox.height > beforeIconBox.height);
    assert.ok(Math.abs(iconBox.x - (nodeBox.x + (nodeBox.width - iconBox.width) / 2)) < 0.01);
    assert.ok(Math.abs(iconBox.y - (nodeBox.y + (nodeBox.height - iconBox.height) / 2)) < 0.01);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("editor supports menu creation, inspect rename/param edits, and context-menu rotate", async () => {
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
    assert.ok(harness.query("palette-menu-output"));
    assert.ok(harness.query("palette-menu-add"));
    assert.equal(harness.container.querySelector(".ping-editor__menu-item-copy"), null);
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-mux"]'), null);

    harness.click(harness.query("palette-menu-category-routing"));
    await harness.flush();
    assert.equal(harness.query("palette-menu-category-routing").getAttribute("aria-pressed"), "true");
    assert.ok(harness.query("palette-menu-mux"));
    assert.equal(harness.container.querySelector('[data-testid="palette-menu-pulse"]'), null);

    harness.click(harness.query("palette-menu-category-basic"));
    await harness.flush();
    harness.click(harness.query("palette-menu-add"));
    await harness.flush();

    assert.ok(harness.query("node-node-1"));
    harness.click(harness.query("node-node-1"));
    await harness.flush();

    assert.equal(
      harness.container.querySelector('[data-tab="inspect"]').classList.contains("has-notice"),
      true,
    );
    harness.click(harness.container.querySelector('[data-tab="inspect"]'));
    await harness.flush();

    const nameInput = harness.query("inspect-name");
    nameInput.value = "Accent Gate";
    nameInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await harness.flush();

    const paramInput = harness.query("inspect-param");
    paramInput.value = "11";
    paramInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
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
    assert.equal(node.name, "Accent Gate");
    assert.equal(node.params.param, 8);
    assert.equal(node.rot, 90);
    assert.ok(
      harness.outputs.some(
        (output) =>
          output.type === "graph/ops" &&
          output.payload.ops.some((op) => op.type === "renameNode"),
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

    harness.click(harness.query("group-confirm"));
    await harness.flush();

    assert.equal(harness.snapshot.groups["group-a"].name, "Edited Group");
    assert.equal(harness.snapshot.groups["group-a"].outputs.length, 0);
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

test("keyboard add-node creation uses the menu-open pointer anchor and restores viewport focus", async () => {
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

    const addMenuItem = harness.query("palette-menu-add");
    addMenuItem.focus();
    harness.click(addMenuItem);
    await harness.flush();

    assert.deepEqual(harness.snapshot.nodes.find((node) => node.id === "node-1")?.pos, {
      x: Math.round(firstOpenPoint.clientX / DEFAULT_UI_CONFIG.grid.GRID_PX),
      y: Math.round(firstOpenPoint.clientY / DEFAULT_UI_CONFIG.grid.GRID_PX),
    });
    assert.equal(dom.window.document.activeElement, harness.query("editor-viewport"));

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
    pulseMenuItem.focus();
    harness.click(pulseMenuItem);
    await harness.flush();

    assert.deepEqual(harness.snapshot.nodes.find((node) => node.id === "node-2")?.pos, {
      x: Math.round(secondOpenPoint.clientX / DEFAULT_UI_CONFIG.grid.GRID_PX),
      y: Math.round(secondOpenPoint.clientY / DEFAULT_UI_CONFIG.grid.GRID_PX),
    });
    assert.equal(dom.window.document.activeElement, harness.query("editor-viewport"));

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
          { id: "node-c", type: "output", pos: { x: 10, y: 2 }, rot: 0, params: {} },
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
