"use client";

import {
  buildGraph,
  buildPalette,
  buildRegistryIndex,
  createAudioBridge,
  createCompiledGraphPatch,
  createDoughSampleMap,
  createProjectRoutingCache,
  createDefaultSampleSlots,
  DEFAULT_TEMPO_BPM,
  getLayout,
  getNodeDefinition,
  GraphModel,
  parseProject,
  routeProjectGraph,
  Runtime,
  serialiseProject,
  validateGraph,
} from "@ping/core";
import { Editor } from "@ping/ui/react";
import { Dough, doughsamples } from "dough-synth/dough.js";
import { startTransition, useEffect, useRef, useState } from "react";

const REGISTRY_INDEX = buildRegistryIndex();
const REGISTRY_API = Object.freeze({
  getNodeDefinition(type) {
    return getNodeDefinition(type, REGISTRY_INDEX);
  },
  getLayout,
});
const PALETTE = buildPalette();
const INITIAL_TEMPO_BPM = DEFAULT_TEMPO_BPM;
const GRAPH_HISTORY_LIMIT = 100;
const SIDEBAR_ACTION_PULSE_MS = 180;
const COPY_ACTION_SUCCESS_MS = 900;
const DOUGH_BASE_PATH = "/dough/";

function cloneGraphSnapshot(snapshot) {
  if (typeof structuredClone === "function") {
    return structuredClone(snapshot);
  }

  return JSON.parse(JSON.stringify(snapshot));
}

function createHistoryEntry(snapshot, reason = "") {
  return {
    snapshot: cloneGraphSnapshot(snapshot),
    reason,
  };
}

function pushHistoryEntry(entries, entry) {
  return [...entries, entry].slice(-GRAPH_HISTORY_LIMIT);
}

function traceAudio(message, details) {
  if (details === undefined) {
    console.log(`[ping-audio] ${message}`);
    return;
  }

  console.log(`[ping-audio] ${message}`, details);
}

function instrumentDough(dough) {
  if (!dough || dough.__pingInstrumented) {
    return dough;
  }

  const wrap = (methodName) => {
    const original = dough[methodName];

    if (typeof original !== "function") {
      return;
    }

    dough[methodName] = async function wrappedMethod(...args) {
      traceAudio(`dough.${methodName}:start`, args[0]);

      try {
        const result = await original.apply(this, args);
        traceAudio(`dough.${methodName}:done`, args[0]);
        return result;
      } catch (error) {
        traceAudio(`dough.${methodName}:error`, {
          args: args[0],
          message: error?.message ?? "unknown error",
        });
        throw error;
      }
    };
  };

  wrap("resume");
  wrap("prepare");
  wrap("evaluate");
  wrap("send");
  wrap("maybeLoadFile");
  wrap("stopWorklet");

  if (dough.ready && typeof dough.ready.then === "function") {
    dough.ready.then(
      () => {
        traceAudio("dough.ready:resolved", {
          sampleRate: dough.sampleRate,
          maxVoices: dough.MAX_VOICES,
          maxEvents: dough.MAX_EVENTS,
        });
      },
      (error) => {
        traceAudio("dough.ready:rejected", {
          message: error?.message ?? "unknown error",
        });
      },
    );
  }

  dough.__pingInstrumented = true;
  return dough;
}

const eagerDoughState = {
  instance: null,
  error: null,
};

function createEagerDough() {
  // Dough expects an onTick callback on every clock message even though the
  // bridge takes over scheduling by wrapping the worklet port later.
  const dough = instrumentDough(
    new Dough({
      base: DOUGH_BASE_PATH,
      onTick() {},
    }),
  );
  traceAudio("setupAudio:dough-created", {
    base: dough.base,
    sampleRate: dough.sampleRate,
  });
  return dough;
}

if (typeof window !== "undefined") {
  try {
    eagerDoughState.instance = createEagerDough();
  } catch (error) {
    eagerDoughState.error = error;
    traceAudio("setupAudio:dough-create-failed", {
      message: error?.message ?? "unknown error",
    });
  }
}

function getEagerDough() {
  if (eagerDoughState.error) {
    throw eagerDoughState.error;
  }

  if (!eagerDoughState.instance) {
    eagerDoughState.instance = createEagerDough();
  }

  return eagerDoughState.instance;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createPingModel() {
  return new GraphModel({
    getNodeDefinition: REGISTRY_API.getNodeDefinition,
  });
}

function clampSelection(selection, snapshot) {
  if (selection.kind === "node" && snapshot.nodes.some((node) => node.id === selection.nodeId)) {
    return selection;
  }

  if (selection.kind === "edge" && snapshot.edges.some((edge) => edge.id === selection.edgeId)) {
    return selection;
  }

  if (
    selection.kind === "corner" &&
    snapshot.edges.some(
      (edge) =>
        edge.id === selection.edgeId &&
        Array.isArray(edge.manualCorners) &&
        edge.manualCorners[selection.cornerIndex],
    )
  ) {
    return selection;
  }

  return { kind: "none" };
}

function buildSidebarIconButtonMarkup({ actionId, testId, label, iconMarkup }) {
  return `
    <button
      class="ping-editor__mini-button ping-editor__icon-button ping-editor__save-action-button"
      type="button"
      data-action="trigger-sidebar-action"
      data-sidebar-action-id="${escapeHtml(actionId)}"
      data-testid="${escapeHtml(testId)}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
    >
      ${iconMarkup}
    </button>
  `;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  try {
    textarea.select();
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function buildProjectJsonPanelMarkup(projectJson) {
  const importIcon = `
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V6m0 0 3 3m-3-3-3 3M3 3.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
  const downloadIcon = `
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 2v7m0 0 3-3m-3 3-3-3M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;
  const copyIcon = `
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="6" y="5" width="7" height="8" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M5 11H4.5A1.5 1.5 0 0 1 3 9.5v-5A1.5 1.5 0 0 1 4.5 3H9a1.5 1.5 0 0 1 1.5 1.5V5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `;

  return `
    <section class="ping-editor__panel-section">
      <div class="ping-editor__action-row">
        ${buildSidebarIconButtonMarkup({
          actionId: "open-import",
          testId: "open-import",
          label: "Load project JSON",
          iconMarkup: importIcon,
        })}
        ${buildSidebarIconButtonMarkup({
          actionId: "download-project-json",
          testId: "download-project-json",
          label: "Download project JSON",
          iconMarkup: downloadIcon,
        })}
        ${buildSidebarIconButtonMarkup({
          actionId: "copy-project-json",
          testId: "copy-project-json",
          label: "Copy project JSON",
          iconMarkup: copyIcon,
        })}
      </div>
      <textarea class="ping-editor__panel-textarea" readonly aria-label="Project JSON" data-testid="project-json">${escapeHtml(projectJson)}</textarea>
    </section>
  `;
}

export function Ping() {
  const [initialModel] = useState(() => createPingModel());
  const modelRef = useRef(initialModel);
  const [runtime] = useState(() => new Runtime({ registry: REGISTRY_API }));
  const [previewRuntime] = useState(() => new Runtime({ registry: REGISTRY_API }));
  const routingCacheRef = useRef(createProjectRoutingCache());
  const compiledGraphRef = useRef(null);
  const graphUpdateModeRef = useRef("replace");
  const doughRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBridgeRef = useRef(null);
  const audioBridgeActiveRef = useRef(false);
  const audioArmPromiseRef = useRef(null);
  const pendingAudioArmRef = useRef(false);
  const resetTransportClockRef = useRef(null);
  const armAudioEngineRef = useRef(null);
  const requestAudioArmRef = useRef(null);
  const reportAudioInitErrorRef = useRef(null);
  const transportRef = useRef({
    originTimeSec: 0,
    originTick: 0,
    bpm: INITIAL_TEMPO_BPM,
  });
  const slotsRef = useRef(createDefaultSampleSlots());
  const tempoRef = useRef(INITIAL_TEMPO_BPM);
  const fileInputRef = useRef(null);
  const [snapshot, setSnapshot] = useState(() => initialModel.getSnapshot());
  const [routes, setRoutes] = useState(() =>
    routeProjectGraph(initialModel.getSnapshot(), REGISTRY_API),
  );
  const [diagnostics, setDiagnostics] = useState([]);
  const [selection, setSelection] = useState({ kind: "none" });
  const [tempo, setTempo] = useState(INITIAL_TEMPO_BPM);
  const [slots, setSlots] = useState(() => createDefaultSampleSlots());
  const [supplementalDiagnostics, setSupplementalDiagnostics] = useState([]);
  const [audioStatus, setAudioStatus] = useState("booting");
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const pendingUndoEntryRef = useRef(null);
  const sidebarActionFeedbackTimersRef = useRef(new Map());
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  function getSidebarActionButton(actionId) {
    if (typeof document === "undefined") {
      return null;
    }

    const button = document.querySelector(`[data-sidebar-action-id="${actionId}"]`);
    return button instanceof HTMLElement ? button : null;
  }

  function queueSidebarActionFeedbackClass(actionId, className, durationMs) {
    if (typeof window === "undefined") {
      return;
    }

    const button = getSidebarActionButton(actionId);

    if (!button) {
      return;
    }

    const timerKey = `${actionId}:${className}`;
    const existingTimerId = sidebarActionFeedbackTimersRef.current.get(timerKey);

    if (existingTimerId !== undefined) {
      window.clearTimeout(existingTimerId);
    }

    button.classList.add(className);

    const timerId = window.setTimeout(() => {
      getSidebarActionButton(actionId)?.classList.remove(className);
      sidebarActionFeedbackTimersRef.current.delete(timerKey);
    }, durationMs);

    sidebarActionFeedbackTimersRef.current.set(timerKey, timerId);
  }

  function pulseSidebarActionFeedback(actionId, { success = false } = {}) {
    queueSidebarActionFeedbackClass(actionId, "is-feedback-active", SIDEBAR_ACTION_PULSE_MS);

    if (success) {
      queueSidebarActionFeedbackClass(actionId, "is-feedback-success", COPY_ACTION_SUCCESS_MS);
    }
  }

  function getClockTimeSec(preferredAudioContext = null) {
    const audioContext = preferredAudioContext ?? audioContextRef.current;

    if (audioContext) {
      return audioContext.currentTime;
    }

    return performance.now() / 1000;
  }

  async function syncDoughSampleSlots(nextSlots = slotsRef.current) {
    const sampleMap = createDoughSampleMap(nextSlots);
    await doughsamples(sampleMap, "");
    traceAudio("syncDoughSampleSlots:done", {
      slotCount: nextSlots?.length ?? 0,
      sampleKeys: Object.keys(sampleMap),
    });
  }

  function createBridgeTransport() {
    const transport = transportRef.current;

    if (!(transport.bpm > 0)) {
      return null;
    }

    const secondsPerTick = 60 / transport.bpm;

    return {
      bpm: transport.bpm,
      ticksPerBeat: 1,
      originSec: transport.originTimeSec - transport.originTick * secondsPerTick,
    };
  }

  function syncAudioBridgeTransport() {
    const bridge = audioBridgeRef.current;

    if (!bridge) {
      return;
    }

    const nextTransport = createBridgeTransport();

    if (!audioBridgeActiveRef.current) {
      if (nextTransport) {
        bridge.updateTransport(nextTransport);
        traceAudio("syncAudioBridgeTransport:updated-while-inactive", {
          transport: nextTransport,
        });
      } else {
        traceAudio("syncAudioBridgeTransport:inactive-no-transport");
      }
      return;
    }

    if (nextTransport) {
      bridge.updateTransport(nextTransport);
      bridge.start();
      traceAudio("syncAudioBridgeTransport:start", {
        transport: nextTransport,
      });
      return;
    }

    bridge.stop();
    traceAudio("syncAudioBridgeTransport:stop-no-transport");
  }

  function resetTransportClock(nextBpm, nextTick = 0, originTimeSec = getClockTimeSec()) {
    transportRef.current = {
      originTimeSec,
      originTick: nextTick,
      bpm: nextBpm > 0 ? nextBpm : 0,
    };
    syncAudioBridgeTransport();
  }

  resetTransportClockRef.current = resetTransportClock;

  function getNowTick(nowTimeSec = getClockTimeSec()) {
    const transport = transportRef.current;

    if (!(transport.bpm > 0)) {
      return transport.originTick;
    }

    return transport.originTick + (nowTimeSec - transport.originTimeSec) * (transport.bpm / 60);
  }

  function pushOutput(output) {
    traceAudio("output", output);
  }

  function syncHistoryState() {
    const nextState = {
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    };

    setHistoryState((current) =>
      current.canUndo === nextState.canUndo && current.canRedo === nextState.canRedo ? current : nextState,
    );
  }

  function resetGraphHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingUndoEntryRef.current = null;
    syncHistoryState();
  }

  function replaceGraphSnapshot(nextSnapshot) {
    modelRef.current = new GraphModel({
      getNodeDefinition: REGISTRY_API.getNodeDefinition,
      snapshot: cloneGraphSnapshot(nextSnapshot),
    });
    graphUpdateModeRef.current = "replace";
    const resolvedSnapshot = modelRef.current.getSnapshot();

    startTransition(() => {
      setSnapshot(resolvedSnapshot);
      setSelection((current) => clampSelection(current, resolvedSnapshot));
    });
  }

  function commitPendingUndoEntry() {
    if (!pendingUndoEntryRef.current) {
      return;
    }

    undoStackRef.current = pushHistoryEntry(undoStackRef.current, pendingUndoEntryRef.current);
    redoStackRef.current = [];
    pendingUndoEntryRef.current = null;
    syncHistoryState();
  }

  function performUndo() {
    const entry = undoStackRef.current.at(-1);

    if (!entry) {
      return;
    }

    pendingUndoEntryRef.current = null;
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = pushHistoryEntry(
      redoStackRef.current,
      createHistoryEntry(modelRef.current.getSnapshot(), entry.reason),
    );
    syncHistoryState();
    replaceGraphSnapshot(entry.snapshot);
  }

  function performRedo() {
    const entry = redoStackRef.current.at(-1);

    if (!entry) {
      return;
    }

    pendingUndoEntryRef.current = null;
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = pushHistoryEntry(
      undoStackRef.current,
      createHistoryEntry(modelRef.current.getSnapshot(), entry.reason),
    );
    syncHistoryState();
    replaceGraphSnapshot(entry.snapshot);
  }

  function reportAudioInitError(error) {
    pendingAudioArmRef.current = false;
    audioBridgeActiveRef.current = false;
    traceAudio("reportAudioInitError", {
      message: error?.message ?? "unknown error",
      stack: error?.stack,
    });
    setAudioStatus("error");
    pushOutput({
      type: "audio/warning",
      payload: {
        code: "AUDIO_INIT_FAIL",
        message: `Audio init failed: ${error?.message ?? "unknown error"}.`,
      },
    });
  }

  reportAudioInitErrorRef.current = reportAudioInitError;

  async function preloadActiveSamples(dough, slots = slotsRef.current) {
    if (!dough?.maybeLoadFile) {
      traceAudio("preloadActiveSamples:skip-no-maybeLoadFile");
      return;
    }

    const seenSlotIds = new Set();

    for (const slot of slots ?? []) {
      if (!slot?.id || seenSlotIds.has(slot.id)) {
        continue;
      }

      seenSlotIds.add(slot.id);

      if (typeof slot.path !== "string" || slot.path.trim() === "") {
        traceAudio("preloadActiveSamples:skip-empty-slot", slot);
        continue;
      }

      try {
        traceAudio("preloadActiveSamples:slot:start", slot);
        await dough.maybeLoadFile({
          s: slot.id,
          n: 0,
        });
        traceAudio("preloadActiveSamples:slot:done", slot);
      } catch (error) {
        traceAudio("preloadActiveSamples:slot:error", {
          slot,
          message: error?.message ?? "unknown error",
        });
        pushOutput({
          type: "audio/warning",
          payload: {
            code: "AUDIO_PRELOAD_FAIL",
            message: `Failed to preload sample slot "${slot.id}": ${error?.message ?? "unknown error"}.`,
          },
        });
      }
    }
  }

  async function armAudioEngine(dough = doughRef.current) {
    if (!dough) {
      traceAudio("armAudioEngine:skip-no-dough");
      return;
    }

    if (audioArmPromiseRef.current) {
      traceAudio("armAudioEngine:reuse-pending-promise");
      return audioArmPromiseRef.current;
    }

    const armPromise = (async () => {
      traceAudio("armAudioEngine:start", {
        tempo: tempoRef.current,
        slots: slotsRef.current,
      });
      const audioContext = (await dough.initAudio) ?? null;
      traceAudio("armAudioEngine:initAudio-resolved", {
        state: audioContext?.state,
        currentTime: audioContext?.currentTime,
        sampleRate: audioContext?.sampleRate,
      });
      await dough.ready;
      traceAudio("armAudioEngine:dough-ready");

      if (doughRef.current !== dough) {
        traceAudio("armAudioEngine:abort-dough-changed-before-resume");
        return;
      }

      await dough.resume?.();
      traceAudio("armAudioEngine:resume-done", {
        state: audioContext?.state,
        currentTime: audioContext?.currentTime,
      });

      if (doughRef.current !== dough) {
        traceAudio("armAudioEngine:abort-dough-changed-before-preload");
        return;
      }

      await syncDoughSampleSlots(slotsRef.current);
      traceAudio("armAudioEngine:slot-map-ready", {
        slots: slotsRef.current,
      });
      await preloadActiveSamples(dough);

      if (doughRef.current !== dough) {
        traceAudio("armAudioEngine:abort-dough-changed-before-clock-reset");
        return;
      }

      audioContextRef.current = audioContext;
      runtime.resetPulses();
      if (compiledGraphRef.current) {
        previewRuntime.setGraph(compiledGraphRef.current);
      } else {
        previewRuntime.resetPulses();
      }
      const originTimeSec = getClockTimeSec(audioContext);
      audioBridgeActiveRef.current = true;
      traceAudio("armAudioEngine:resetTransportClock", {
        tempo: tempoRef.current,
        originTimeSec,
      });
      resetTransportClock(tempoRef.current, 0, originTimeSec);
      traceAudio("armAudioEngine:bridge-metrics-after-reset", audioBridgeRef.current?.getMetrics?.());
      setAudioStatus("running");
      pushOutput({
        type: "audio/status",
        payload: {
          message: "Audio armed.",
        },
      });
    })();

    audioArmPromiseRef.current = armPromise;

    try {
      await armPromise;
    } finally {
      if (audioArmPromiseRef.current === armPromise) {
        audioArmPromiseRef.current = null;
      }

      traceAudio("armAudioEngine:complete", {
        audioStatus,
        bridgeMetrics: audioBridgeRef.current?.getMetrics?.(),
      });
    }
  }

  armAudioEngineRef.current = armAudioEngine;

  function requestAudioArm() {
    traceAudio("requestAudioArm", {
      audioStatus,
      hasDough: Boolean(doughRef.current),
      pendingAudioArm: pendingAudioArmRef.current,
    });

    if (audioStatus === "running" || audioStatus === "arming") {
      return;
    }

    const dough = doughRef.current;

    if (!dough) {
      pendingAudioArmRef.current = true;
      return;
    }

    pendingAudioArmRef.current = false;
    setAudioStatus("arming");
    void armAudioEngineRef.current?.(dough).catch((error) => {
      reportAudioInitErrorRef.current?.(error);
    });
  }

  requestAudioArmRef.current = requestAudioArm;

  function handleEditorOutput(output) {
    pushOutput(output);

    if (output.type === "ui/undoSnapshot") {
      pendingUndoEntryRef.current = createHistoryEntry(output.payload.snapshot, output.payload.reason);
      return;
    }

    if (output.type === "ui/requestUndo") {
      performUndo();
      return;
    }

    if (output.type === "ui/requestRedo") {
      performRedo();
      return;
    }

    if (output.type === "ui/selectionChanged") {
      startTransition(() => {
        setSelection(output.payload);
      });
      return;
    }

    if (output.type === "audio/updateTempo") {
      const nowTick = getNowTick();
      const nextBpm = output.payload.bpm;
      traceAudio("handleEditorOutput:updateTempo", {
        previousTempo: tempoRef.current,
        nextBpm,
        nowTick,
      });
      setTempo(nextBpm);
      tempoRef.current = nextBpm;
      resetTransportClock(nextBpm, nowTick);
      return;
    }

    if (output.type === "audio/updateSlots") {
      const nextSlots = output.payload.slots.map((slot) => ({ ...slot }));
      traceAudio("handleEditorOutput:updateSlots", nextSlots);
      setSlots(nextSlots);
      slotsRef.current = nextSlots;
      return;
    }

    if (output.type === "runtime/resetPulses") {
      traceAudio("handleEditorOutput:resetPulses");
      runtime.resetPulses();
      previewRuntime.resetPulses();
      return;
    }

    if (output.type !== "graph/ops") {
      return;
    }

    const result = modelRef.current.applyOps(output.payload.ops);

    if (!result.ok) {
      pendingUndoEntryRef.current = null;
      traceAudio("handleEditorOutput:graphOps-apply-failed", result);
      return;
    }

    commitPendingUndoEntry();
    graphUpdateModeRef.current = "ops";
    startTransition(() => {
      setSnapshot(modelRef.current.getSnapshot());
    });
  }

  useEffect(() => {
    const nextRoutes = routeProjectGraph(
      snapshot,
      REGISTRY_API,
      undefined,
      null,
      routingCacheRef.current,
    );
    traceAudio("graph:routeGraph", {
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      routeErrorCount: nextRoutes.errors?.length ?? 0,
    });
    setRoutes(nextRoutes);

    const nextDiagnostics = [...(nextRoutes.errors ?? [])];

    if (nextRoutes.errors?.length) {
      setDiagnostics([...nextDiagnostics, ...supplementalDiagnostics]);
      return;
    }

    const validation = validateGraph(snapshot, REGISTRY_API, nextRoutes.edgeDelays);
    nextDiagnostics.push(...validation.errors, ...validation.warnings);

    if (validation.ok) {
      const build = buildGraph(snapshot, REGISTRY_API, nextRoutes.edgeDelays, {
        includeDebugMaps: true,
      });

      if (build.ok) {
        const previousCompiledGraph = compiledGraphRef.current;
        const updateMode = graphUpdateModeRef.current;
        compiledGraphRef.current = build.graph;
        traceAudio("graph:buildGraph:ok", {
          compiledNodeCount: build.graph.nodes.length,
          compiledEdgeCount: build.graph.edges.length,
          edgeDelays: nextRoutes.edgeDelays,
        });

        if (updateMode === "ops" && previousCompiledGraph) {
          const patch = createCompiledGraphPatch(previousCompiledGraph, build.graph);
          traceAudio("graph:applyPatch", {
            removedNodes: patch.removedNodes.length,
            removedEdges: patch.removedEdges.length,
            addedNodes: patch.addedNodes.length,
            addedEdges: patch.addedEdges.length,
            updatedEdges: patch.updatedEdges.length,
            updatedParams: patch.updatedParams.length,
          });
          runtime.applyPatch(patch);
          previewRuntime.applyPatch(patch);
        } else {
          traceAudio("graph:setGraph", {
            updateMode,
            compiledNodeCount: build.graph.nodes.length,
            compiledEdgeCount: build.graph.edges.length,
          });
          runtime.setGraph(build.graph);
          previewRuntime.setGraph(build.graph);
          resetTransportClockRef.current?.(tempoRef.current ?? INITIAL_TEMPO_BPM, 0);
        }

        graphUpdateModeRef.current = "replace";
      } else {
        traceAudio("graph:buildGraph:failed", build);
        nextDiagnostics.push(...build.errors, ...build.warnings);
      }
    }

    setDiagnostics([...nextDiagnostics, ...supplementalDiagnostics]);
    setSelection((current) => clampSelection(current, snapshot));
  }, [previewRuntime, runtime, snapshot, supplementalDiagnostics]);

  useEffect(() => {
    const feedbackTimers = sidebarActionFeedbackTimersRef.current;

    return () => {
      for (const timerId of feedbackTimers.values()) {
        window.clearTimeout(timerId);
      }

      feedbackTimers.clear();
    };
  }, []);

  useEffect(() => {
    let frameId = 0;

    function tickPreview() {
      const transport = transportRef.current;
      const nowTimeSec = getClockTimeSec();
      const nowTick =
        transport.bpm > 0
          ? transport.originTick + (nowTimeSec - transport.originTimeSec) * (transport.bpm / 60)
          : transport.originTick;
      const lastTick = previewRuntime.getMetrics()?.lastTickProcessed ?? 0;

      if (nowTick > lastTick) {
        previewRuntime.queryWindow(lastTick, nowTick);
      }

      frameId = window.requestAnimationFrame(tickPreview);
    }

    frameId = window.requestAnimationFrame(tickPreview);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [previewRuntime]);

  useEffect(() => {
    slotsRef.current = slots;
    traceAudio("slots:sync", slots);
    audioBridgeRef.current?.updateSlots(slots);
  }, [slots]);

  useEffect(() => {
    tempoRef.current = tempo;
    traceAudio("tempo:sync", { tempo });
  }, [tempo]);

  useEffect(() => {
    let disposed = false;

    async function setupAudio() {
      traceAudio("setupAudio:start");

      try {
        if (disposed) {
          traceAudio("setupAudio:aborted-disposed-before-init");
          return;
        }

        doughRef.current = getEagerDough();

        const bridge = createAudioBridge({
          runtime,
          registry: REGISTRY_API,
          dough: doughRef.current,
          transport: createBridgeTransport() ?? undefined,
          getSlots: () => slotsRef.current,
          loadSamples: syncDoughSampleSlots,
          onWarning(warning) {
            traceAudio("bridge:onWarning", warning);
            pushOutput({
              type: "audio/warning",
              payload: warning,
            });

            if (warning.code === "AUDIO_DOH_EVAL_FAIL") {
              setAudioStatus("error");
            }
          },
          logger: {
            log(message, details) {
              console.log(message, details);
            },
            debug(message, details) {
              console.log(message, details);
            },
            warn(message, details) {
              console.warn(message, details);
            },
          },
        });

        audioBridgeRef.current = bridge;
        traceAudio("setupAudio:bridge-created", {
          transport: createBridgeTransport(),
          bridgeMetrics: bridge.getMetrics(),
        });
        setAudioStatus("awaiting-gesture");

        if (pendingAudioArmRef.current) {
          traceAudio("setupAudio:consuming-pending-arm-request");
          requestAudioArmRef.current?.();
        }
      } catch (error) {
        reportAudioInitErrorRef.current?.(error);
      }
    }

    void setupAudio();

    return () => {
      disposed = true;
      traceAudio("setupAudio:cleanup:start");
      audioBridgeActiveRef.current = false;
      audioArmPromiseRef.current = null;
      audioContextRef.current = null;
      audioBridgeRef.current?.stop();
      audioBridgeRef.current = null;

      const dough = doughRef.current;
      doughRef.current = null;

      if (dough?.worklet) {
        void dough.stopWorklet?.();
      }

      traceAudio("setupAudio:cleanup:done");
    };
  }, [runtime]);

  useEffect(() => {
    window.__PING_AUDIO_DEBUG__ = {
      get bridgeMetrics() {
        return audioBridgeRef.current?.getMetrics?.();
      },
      get audioContextState() {
        return audioContextRef.current?.state ?? null;
      },
      get audioContextTime() {
        return audioContextRef.current?.currentTime ?? null;
      },
      get transport() {
        return transportRef.current;
      },
      get tempo() {
        return tempoRef.current;
      },
      get slots() {
        return slotsRef.current;
      },
      runtime,
      previewRuntime,
      dough: doughRef.current,
    };

    traceAudio("debug-handle:installed");

    return () => {
      delete window.__PING_AUDIO_DEBUG__;
    };
  }, [previewRuntime, runtime]);

  function handleImportFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      traceAudio("handleImportFile:skip-no-file");
      return;
    }

    traceAudio("handleImportFile:start", {
      name: file.name,
      size: file.size,
      type: file.type,
    });
    void file.text().then((text) => {
      const result = parseProject(text);

      if (!result.ok) {
        traceAudio("handleImportFile:parse-failed", result);
        setSupplementalDiagnostics([...result.errors, ...result.warnings]);
        return;
      }

      modelRef.current = new GraphModel({
        getNodeDefinition: REGISTRY_API.getNodeDefinition,
        snapshot: result.project.graph,
      });
      resetGraphHistory();
      graphUpdateModeRef.current = "replace";
      setSnapshot(modelRef.current.getSnapshot());
      setSlots(result.project.samples);
      slotsRef.current = result.project.samples;
      setTempo(result.project.settings.tempo);
      tempoRef.current = result.project.settings.tempo;
      resetTransportClock(result.project.settings.tempo, 0);
      traceAudio("handleImportFile:loaded", {
        tempo: result.project.settings.tempo,
        slots: result.project.samples,
        nodeCount: result.project.graph.nodes.length,
        edgeCount: result.project.graph.edges.length,
      });
      setSelection({ kind: "none" });
      setSupplementalDiagnostics(result.warnings);
    });

    event.target.value = "";
  }

  let projectJson = "";

  try {
    projectJson = JSON.stringify(
      serialiseProject({
        graph: snapshot,
        samples: slots,
        settings: { tempo },
        project: { name: "Ping Project" },
      }),
      null,
      2,
    );
  } catch (error) {
    projectJson = JSON.stringify({ error: error.message }, null, 2);
  }

  const sidebarExtensions = {
    tabs: [
      {
        id: "save",
        label: "project",
        markup: buildProjectJsonPanelMarkup(projectJson),
        testId: "tab-save",
      },
    ],
    actions: [],
  };

  async function handleSidebarAction(actionId) {
    if (actionId === "download-project-json") {
      const blob = new Blob([projectJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ping-project.json";
      link.click();
      URL.revokeObjectURL(url);
      pulseSidebarActionFeedback(actionId);
      return;
    }

    if (actionId === "copy-project-json") {
      try {
        const copied = await copyTextToClipboard(projectJson);

        if (copied) {
          pulseSidebarActionFeedback(actionId, { success: true });
        }
      } catch {}
      return;
    }

    if (actionId === "open-import") {
      fileInputRef.current?.click();
    }
  }

  return (
    <main className="ping-app-shell">
      <section className="ping-app-shell__editor" onClickCapture={requestAudioArm}>
        <input
          ref={fileInputRef}
          hidden
          type="file"
          name="project-import"
          accept="application/json,.json"
          onChange={handleImportFile}
          data-testid="project-import"
        />
        <Editor
          snapshot={snapshot}
          routes={routes}
          diagnostics={diagnostics}
          palette={PALETTE}
          selection={selection}
          canUndo={historyState.canUndo}
          canRedo={historyState.canRedo}
          onOutput={handleEditorOutput}
          onSidebarAction={handleSidebarAction}
          sidebarExtensions={sidebarExtensions}
          registry={REGISTRY_API}
          runtime={previewRuntime}
          slots={slots}
          tempo={tempo}
        />
      </section>
    </main>
  );
}
