import assert from "node:assert/strict";

import {
  buildPalette,
  buildRegistryIndex,
  createDefaultSampleSlots,
  DEFAULT_TEMPO_BPM,
  getLayout,
  getNodeDefinition,
  GraphModel,
  routeProjectGraph,
  validateGraph,
} from "@ping/core";
import { JSDOM } from "jsdom";

import { createEditor } from "../../editor/createEditor.js";

const REGISTRY_INDEX = buildRegistryIndex();

export const TEST_REGISTRY = Object.freeze({
  getNodeDefinition(type) {
    return getNodeDefinition(type, REGISTRY_INDEX);
  },
  getLayout,
});

export const TEST_PALETTE = buildPalette();

function createPointerEvent(window, type, options = {}) {
  return new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    shiftKey: options.shiftKey ?? false,
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
  });
}

export async function flushFrames(window, count = 3) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 5));
  }
}

function scheduleLater(window, delayMs, callback) {
  return window.setTimeout(callback, delayMs);
}

export function setupDom() {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    CustomEvent: globalThis.CustomEvent,
    File: globalThis.File,
    FileReader: globalThis.FileReader,
    MouseEvent: globalThis.MouseEvent,
    PointerEvent: globalThis.PointerEvent,
    performance: globalThis.performance,
    navigator: globalThis.navigator,
  };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.File = window.File;
  globalThis.FileReader = window.FileReader;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.PointerEvent = window.MouseEvent;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: window.navigator,
  });

  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;

  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.dataset?.rectWidth || this.dataset?.rectHeight) {
      const width = Number(this.dataset.rectWidth ?? 0);
      const height = Number(this.dataset.rectHeight ?? 0);
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width,
        height,
        right: width,
        bottom: height,
      };
    }

    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 960,
      height: 640,
      right: 960,
      bottom: 640,
    };
  };

  const originalRaf = window.requestAnimationFrame.bind(window);
  const originalCancelRaf = window.cancelAnimationFrame.bind(window);
  let rafId = 1;
  const rafTimers = new Map();

  window.requestAnimationFrame = (callback) => {
    const id = rafId;
    rafId += 1;
    const timer = window.setTimeout(() => callback(window.performance.now()), 5);
    rafTimers.set(id, timer);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const timer = rafTimers.get(id);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      rafTimers.delete(id);
    }
  };

  return {
    window,
    cleanup() {
      window.HTMLElement.prototype.getBoundingClientRect = originalRect;
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCancelRaf;
      dom.window.close();
      globalThis.window = originalGlobals.window;
      globalThis.document = originalGlobals.document;
      globalThis.HTMLElement = originalGlobals.HTMLElement;
      globalThis.SVGElement = originalGlobals.SVGElement;
      globalThis.CustomEvent = originalGlobals.CustomEvent;
      globalThis.File = originalGlobals.File;
      globalThis.FileReader = originalGlobals.FileReader;
      globalThis.MouseEvent = originalGlobals.MouseEvent;
      globalThis.PointerEvent = originalGlobals.PointerEvent;
      globalThis.performance = originalGlobals.performance;
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
    },
  };
}

export function createRuntimeStub() {
  return {
    resetCount: 0,
    thumbs: [],
    projectedThumbs: null,
    nodePulses: [],
    projectedNodePulses: null,
    presentedActivity: null,
    lastTickProcessed: 1,
    getThumbState() {
      return this.thumbs;
    },
    getProjectedThumbState() {
      return this.projectedThumbs ?? this.thumbs;
    },
    getNodePulseState() {
      return this.nodePulses;
    },
    getProjectedNodePulseState() {
      return this.projectedNodePulses ?? this.nodePulses;
    },
    getPresentedActivity() {
      return (
        this.presentedActivity ?? {
          thumbs: this.getProjectedThumbState(),
          nodePulseStates: this.getProjectedNodePulseState(),
        }
      );
    },
    getMetrics() {
      return { lastTickProcessed: this.lastTickProcessed };
    },
    resetPulses() {
      this.resetCount += 1;
    },
  };
}

export function createEditorHarness(options = {}) {
  const registry = options.registry ?? TEST_REGISTRY;
  const runtime = options.runtime ?? createRuntimeStub();
  const model = new GraphModel({
    getNodeDefinition: registry.getNodeDefinition,
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
  });
  const outputs = [];
  const container = document.createElement("div");
  container.dataset.rectWidth = "1280";
  container.dataset.rectHeight = "860";
  document.body.append(container);
  let selection = options.selection ?? { kind: "none" };
  let slots = createDefaultSampleSlots();
  let tempo = DEFAULT_TEMPO_BPM;

  const editor = createEditor({
    registry,
    runtime,
    onSidebarAction: options.onSidebarAction,
    sidebarExtensions: options.sidebarExtensions,
    onOutput(output) {
      outputs.push(output);

      if (output.type === "graph/ops") {
        const result = model.applyOps(output.payload.ops);
        assert.equal(result.ok, true, `Graph ops failed: ${JSON.stringify(result.errors)}`);

        if ((options.deferGraphOpsMs ?? 0) > 0) {
          scheduleLater(window, options.deferGraphOpsMs, sync);
        } else {
          sync();
        }
        return;
      }

      if (output.type === "ui/selectionChanged") {
        selection = output.payload;
        editor.setSelection(selection);
        return;
      }

      if (output.type === "audio/updateTempo") {
        tempo = output.payload.bpm;
        editor.setTempo(tempo);
        return;
      }

      if (output.type === "audio/updateSlots") {
        slots = output.payload.slots.map((slot) => ({ ...slot }));
        editor.setSlots(slots);
      }
    },
  });

  function sync() {
    const snapshot = model.getSnapshot();
    const routes = routeProjectGraph(snapshot, registry);
    const validation = validateGraph(snapshot, registry, routes.edgeDelays);
    editor.setSnapshot(snapshot);
    editor.setRoutes(routes);
    editor.setDiagnostics([
      ...(routes.errors ?? []),
      ...validation.errors,
      ...validation.warnings,
    ]);
    editor.setPalette(TEST_PALETTE);
    editor.setSelection(selection);
    editor.setSlots(slots);
    editor.setTempo(tempo);
  }

  editor.mount(container);
  sync();

  return {
    container,
    editor,
    model,
    outputs,
    runtime,
    get snapshot() {
      return model.getSnapshot();
    },
    get selection() {
      return selection;
    },
    get selectedNodeIds() {
      return [...container.querySelectorAll(".ping-editor__node-selection-ring.is-group-selected")]
        .map((element) => element.getAttribute("data-node-id"));
    },
    get slots() {
      return slots;
    },
    get tempo() {
      return tempo;
    },
    query(testId) {
      return container.querySelector(`[data-testid="${testId}"]`);
    },
    click(element, options = {}) {
      element.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: options.button ?? 0,
          clientX: options.clientX ?? 0,
          clientY: options.clientY ?? 0,
          shiftKey: options.shiftKey ?? false,
          ctrlKey: options.ctrlKey ?? false,
          metaKey: options.metaKey ?? false,
        }),
      );
    },
    applyOps(ops) {
      const result = model.applyOps(ops);
      assert.equal(result.ok, true, `Graph ops failed: ${JSON.stringify(result.errors)}`);
      sync();
      return result;
    },
    sync,
    pointerDown(element, options = {}) {
      element.dispatchEvent(createPointerEvent(window, "pointerdown", options));
    },
    pointerMove(element, options = {}) {
      element.dispatchEvent(createPointerEvent(window, "pointermove", options));
    },
    pointerUp(targetOrOptions = {}, options = {}) {
      const hasTarget = targetOrOptions && typeof targetOrOptions.dispatchEvent === "function";
      const eventOptions = hasTarget ? options : targetOrOptions;
      window.dispatchEvent(createPointerEvent(window, "pointerup", eventOptions));
    },
    async flush(count = 3) {
      await flushFrames(window, count);
    },
    dispatchClipboard(type, { target, data = {} } = {}) {
      const clipboardStore = new Map(Object.entries(data));
      const event = new window.Event(type, {
        bubbles: true,
        cancelable: true,
      });

      Object.defineProperty(event, "clipboardData", {
        configurable: true,
        value: {
          getData(format) {
            return clipboardStore.get(format) ?? "";
          },
          setData(format, value) {
            clipboardStore.set(format, value);
          },
        },
      });

      (target ?? document).dispatchEvent(event);
      return Object.fromEntries(clipboardStore.entries());
    },
    unmount() {
      editor.unmount();
      container.remove();
    },
  };
}
