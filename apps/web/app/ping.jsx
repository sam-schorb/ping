"use client";

import {
  buildGraph,
  buildPalette,
  buildRegistryIndex,
  createAudioSession,
  createCompiledGraphPatch,
  createDoughAudioEngine,
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
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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

function traceAudio() {}

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
  const audioSessionRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioSchedulingActiveRef = useRef(false);
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

  function getAudibleLatencySec(preferredAudioContext = null) {
    const audioContext = preferredAudioContext ?? audioContextRef.current;

    if (!audioContext) {
      return 0;
    }

    const baseLatency = Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency : 0;
    const outputLatency = Number.isFinite(audioContext.outputLatency)
      ? audioContext.outputLatency
      : 0;

    return Math.max(0, baseLatency + outputLatency);
  }

  function getAudibleClockTimeSec(preferredAudioContext = null) {
    const audioContext = preferredAudioContext ?? audioContextRef.current;
    return Math.max(0, getClockTimeSec(audioContext) - getAudibleLatencySec(audioContext));
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

  function syncAudioSessionTransport() {
    const session = audioSessionRef.current;

    if (!session) {
      return;
    }

    const nextTransport = createBridgeTransport();
    session.updateTransport(nextTransport ?? undefined);

    if (!audioSchedulingActiveRef.current) {
      if (nextTransport) {
        traceAudio("syncAudioSessionTransport:updated-while-inactive", {
          transport: nextTransport,
        });
      } else {
        traceAudio("syncAudioSessionTransport:inactive-no-transport");
      }
      return;
    }

    if (nextTransport) {
      session.setSchedulingActive(true);
      traceAudio("syncAudioSessionTransport:start", {
        transport: nextTransport,
      });
      return;
    }

    session.setSchedulingActive(false);
    traceAudio("syncAudioSessionTransport:stop-no-transport");
  }

  function resetTransportClock(nextBpm, nextTick = 0, originTimeSec = getClockTimeSec()) {
    transportRef.current = {
      originTimeSec,
      originTick: nextTick,
      bpm: nextBpm > 0 ? nextBpm : 0,
    };
    syncAudioSessionTransport();
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
    audioSchedulingActiveRef.current = false;
    audioSessionRef.current?.setSchedulingActive(false);
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

  async function armAudioEngine(session = audioSessionRef.current) {
    if (!session) {
      traceAudio("armAudioEngine:skip-no-session");
      return;
    }

    traceAudio("armAudioEngine:start", {
      tempo: tempoRef.current,
      slots: slotsRef.current,
    });
    const audioContext = await session.arm();
    traceAudio("armAudioEngine:initAudio-resolved", {
      state: audioContext?.state,
      currentTime: audioContext?.currentTime,
      sampleRate: audioContext?.sampleRate,
    });
    traceAudio("armAudioEngine:latency", {
      baseLatency: audioContext?.baseLatency,
      outputLatency: audioContext?.outputLatency,
      audibleLatencySec: getAudibleLatencySec(audioContext),
    });

    audioContextRef.current = audioContext;
    runtime.resetPulses();
    if (compiledGraphRef.current) {
      previewRuntime.setGraph(compiledGraphRef.current);
    } else {
      previewRuntime.resetPulses();
    }
    const originTimeSec = getClockTimeSec(audioContext);
    audioSchedulingActiveRef.current = true;
    traceAudio("armAudioEngine:resetTransportClock", {
      tempo: tempoRef.current,
      originTimeSec,
    });
    resetTransportClock(tempoRef.current, 0, originTimeSec);
    traceAudio("armAudioEngine:session-metrics-after-reset", audioSessionRef.current?.getMetrics?.());
    setAudioStatus("running");
    pushOutput({
      type: "audio/status",
      payload: {
        message: "Audio armed.",
      },
    });
    traceAudio("armAudioEngine:complete", {
      audioStatus,
      audioMetrics: audioSessionRef.current?.getMetrics?.(),
    });
  }

  armAudioEngineRef.current = armAudioEngine;

  function requestAudioArm() {
    traceAudio("requestAudioArm", {
      audioStatus,
      hasAudioSession: Boolean(audioSessionRef.current),
      pendingAudioArm: pendingAudioArmRef.current,
    });

    if (audioStatus === "running" || audioStatus === "arming") {
      return;
    }

    const session = audioSessionRef.current;

    if (!session) {
      pendingAudioArmRef.current = true;
      return;
    }

    pendingAudioArmRef.current = false;
    setAudioStatus("arming");
    void armAudioEngineRef.current?.(session).catch((error) => {
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
      const audioContext = audioContextRef.current;
      const baseLatency = Number.isFinite(audioContext?.baseLatency) ? audioContext.baseLatency : 0;
      const outputLatency = Number.isFinite(audioContext?.outputLatency)
        ? audioContext.outputLatency
        : 0;
      const nowTimeSec = Math.max(
        0,
        (audioContext?.currentTime ?? performance.now() / 1000) - (baseLatency + outputLatency),
      );
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
    audioSessionRef.current?.updateSlots(slots);
  }, [slots]);

  useEffect(() => {
    tempoRef.current = tempo;
    traceAudio("tempo:sync", { tempo });
  }, [tempo]);

  useEffect(() => {
    let disposed = false;

    function setupAudio() {
      traceAudio("setupAudio:start");

      try {
        if (disposed) {
          traceAudio("setupAudio:aborted-disposed-before-init");
          return;
        }

        const session = createAudioSession({
          runtime,
          registry: REGISTRY_API,
          engine: createDoughAudioEngine({
            basePath: DOUGH_BASE_PATH,
          }),
          transport: createBridgeTransport() ?? undefined,
          slots: slotsRef.current,
          onWarning(warning) {
            traceAudio("audioSession:onWarning", warning);
            pushOutput({
              type: "audio/warning",
              payload: warning,
            });

            if (warning.code === "AUDIO_DOH_EVAL_FAIL") {
              setAudioStatus("error");
            }
          },
          logger: {
            warn(message, details) {
              console.warn(message, details);
            },
          },
        });

        if (disposed) {
          void session.dispose();
          return;
        }

        audioSessionRef.current = session;
        traceAudio("setupAudio:session-created", {
          transport: createBridgeTransport(),
          audioMetrics: session.getMetrics(),
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

    setupAudio();

    return () => {
      disposed = true;
      traceAudio("setupAudio:cleanup:start");
      audioSchedulingActiveRef.current = false;
      audioContextRef.current = null;

      const session = audioSessionRef.current;
      audioSessionRef.current = null;
      void session?.dispose?.();

      traceAudio("setupAudio:cleanup:done");
    };
  }, [runtime]);

  useEffect(() => {
    window.__PING_AUDIO_DEBUG__ = {
      get audioMetrics() {
        return audioSessionRef.current?.getMetrics?.();
      },
      get audioContextState() {
        return audioContextRef.current?.state ?? null;
      },
      get audioContextTime() {
        return audioContextRef.current?.currentTime ?? null;
      },
      get audibleLatencySec() {
        return getAudibleLatencySec();
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
      audioSession: audioSessionRef.current,
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

  const projectJson = useMemo(() => {
    try {
      return JSON.stringify(
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
      return JSON.stringify({ error: error.message }, null, 2);
    }
  }, [snapshot, slots, tempo]);
  const deferredProjectJson = useDeferredValue(projectJson);
  const sidebarExtensions = useMemo(
    () => ({
      tabs: [
        {
          id: "save",
          label: "project",
          markup: buildProjectJsonPanelMarkup(deferredProjectJson),
          testId: "tab-save",
        },
      ],
      actions: [],
    }),
    [deferredProjectJson],
  );

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
