"use client";

import { buildRegistryIndex, getLayout, getNodeDefinition } from "@ping/core";
import { useLayoutEffect, useRef } from "react";

import { createEditor } from "../editor/createEditor.js";

const DEFAULT_REGISTRY_INDEX = buildRegistryIndex();

const DEFAULT_REGISTRY_API = Object.freeze({
  getNodeDefinition(type) {
    return getNodeDefinition(type, DEFAULT_REGISTRY_INDEX);
  },
  getLayout,
});

const DEFAULT_RUNTIME_API = Object.freeze({
  getThumbState() {
    return [];
  },
  getMetrics() {
    return { lastTickProcessed: 0 };
  },
  resetPulses() {},
});

export function Editor({
  snapshot,
  routes,
  diagnostics,
  palette,
  selection,
  canUndo = false,
  canRedo = false,
  onOutput,
  onSidebarAction,
  sidebarExtensions,
  registry = DEFAULT_REGISTRY_API,
  runtime = DEFAULT_RUNTIME_API,
  config,
  slots,
  tempo,
}) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const outputRef = useRef(onOutput);
  const sidebarActionRef = useRef(onSidebarAction);
  outputRef.current = onOutput;
  sidebarActionRef.current = onSidebarAction;

  useLayoutEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }

    const editor = createEditor({
      registry,
      runtime,
      onOutput(output) {
        outputRef.current?.(output);
      },
      onSidebarAction(actionId) {
        sidebarActionRef.current?.(actionId);
      },
      config,
    });

    editor.mount(hostRef.current);
    editor.setSnapshot(snapshot);
    editor.setRoutes(routes);
    editor.setDiagnostics(diagnostics);
    editor.setPalette(palette);
    editor.setSelection(selection);
    editor.setHistory?.({ canUndo, canRedo });
    editor.setSlots?.(slots);
    editor.setTempo?.(tempo);
    editor.setSidebarExtensions?.(sidebarExtensions);
    editorRef.current = editor;

    return () => {
      editor.unmount();
      editorRef.current = null;
    };
  }, [config, registry, runtime]);

  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.setSnapshot(snapshot);
    editor.setRoutes(routes);
    editor.setDiagnostics(diagnostics);
    editor.setPalette(palette);
    editor.setSelection(selection);
    editor.setHistory?.({ canUndo, canRedo });
    editor.setSlots?.(slots);
    editor.setSidebarExtensions?.(sidebarExtensions);
  }, [canRedo, canUndo, diagnostics, palette, routes, selection, sidebarExtensions, slots, snapshot]);

  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.setTempo?.(tempo);
  }, [tempo]);

  return <div ref={hostRef} style={{ height: "100%", minHeight: 0 }} />;
}
