import { createDefaultSampleSlots, createEmptyGraphSnapshot, DEFAULT_TEMPO_BPM } from "@ping/core";

import { mergeUIConfig } from "../config/defaults.js";
import { DEFAULT_PALETTE_MENU_CATEGORY_ID } from "../panels/palette.js";
import { getViewportSize } from "../render/panzoom.js";
import { createCanvasController } from "./canvas-controller.js";
import { focusElementWithoutScroll } from "./focus-state.js";
import { clampCamera, clampParamInput, getNodeWorldBounds, snapWorldPoint } from "./geometry.js";
import { createGroupDraft, createGroupEditDraft } from "./group-config.js";
import { createInlineParamController } from "./inline-param.js";
import { createInputController } from "./input-controller.js";
import { createInspectDslController } from "./inspect-dsl-controller.js";
import { selectionToFocusTarget } from "./panel-markup.js";
import { createRenderController } from "./render-controller.js";
import {
  clearDeletedSelection,
  createDefaultCamera,
  createEmptyDragState,
  createEmptyGroupSelection,
  createEmptyHover,
  createEmptySelection,
  normalizeGroupSelection,
  normalizeSelection,
} from "./state.js";
import {
  buildCreateGroupOps,
  buildUpdateGroupOps,
  canRemoveGroup,
  createAddNodeOp,
  createDeleteNodeSetOps,
  createDeleteSelectionOps,
  createGraphOpsOutput,
  createNodeRecord,
  createRenameNodeOp,
  createRotateNodeOp,
  createSetParamOp,
  createUndoOutput,
} from "./ops.js";
import {
  cloneSlots,
  cloneValue,
  createDeterministicId,
  createEmptyNoticeList,
  createEmptyRoutes,
  createIdFactory,
  createLocalIssue,
  createViewportFallback,
  isInteractiveTarget,
  normalizeSidebarExtensions,
  normalizeSlots,
  normalizeTempo,
  readFileAsDataUrl,
  reconcileSampleFileLabels,
  selectionEquals,
  sidebarExtensionsRequireRender,
  getSidebarTabIds,
  syncRangeValue,
} from "./utils.js";

export function createEditor({ registry, runtime, onOutput, onSidebarAction, sidebarExtensions, config }) {
  const resolvedConfig = mergeUIConfig(undefined, config ?? {});
  const SIDEBAR_COLLAPSE_BREAKPOINT_PX = 1180;
  const COMPACT_TOOLBAR_BREAKPOINT_PX = 720;
  const state = {
    registry,
    runtime,
    config: resolvedConfig,
    root: null,
    viewport: null,
    viewportCanvas: null,
    inlineParamLayer: null,
    snapshot: createEmptyGraphSnapshot(),
    routes: createEmptyRoutes(),
    diagnostics: [],
    localIssues: createEmptyNoticeList(),
    inspectDslDraft: null,
    palette: [],
    selection: createEmptySelection(),
    groupSelection: createEmptyGroupSelection(),
    hover: createEmptyHover(),
    drag: createEmptyDragState(),
    pan: null,
    touchGesture: { kind: "none" },
    touchPointers: new Map(),
    camera: createDefaultCamera(),
    viewportSize: createViewportFallback(),
    sampleFileLabels: new Map(),
    menu: {
      open: false,
      screen: { x: 48, y: 48 },
      world: { x: 2, y: 2 },
      category: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      query: "",
      focusSearch: false,
      activeItemId: null,
      scrollActiveItem: false,
    },
    sidebarExtensions: normalizeSidebarExtensions(sidebarExtensions),
    sidebarCollapsed: false,
    sidebarAutoMode: true,
    sidebarResponsiveInitialized: false,
    activeTab: "console",
    slots: createDefaultSampleSlots(),
    tempo: DEFAULT_TEMPO_BPM,
    tempoPopoverOpen: false,
    thumbs: [],
    nodePulseStates: [],
    frameId: null,
    dirty: true,
    mounted: false,
    thumbOnlyDirty: false,
    viewportOnlyDirty: false,
    lastFrameAt: null,
    frameDurationMs: 16,
    previewThrottleMs: 0,
    lastPreviewUpdateAt: 0,
    previewRenderState: null,
    inlineParamEdit: null,
    inlineParamLayerDirty: false,
    inlineParamBlurCommitTimer: null,
    inlineParamFocusFrameId: null,
    inlineParamAutofocusTimer: null,
    rendering: false,
    boxSelection: null,
    lastPointerWorld: { x: 2, y: 2 },
    lastPointerScreen: { x: 48, y: 48 },
    lastPointerPointerId: 1,
    lastPointerType: "mouse",
    nodePositionOverrides: new Map(),
    pointerPress: null,
    dragStarted: false,
    edgeCreatePointerActive: false,
    suppressViewportClick: false,
    skipNextEdgeDoubleClickId: null,
    groupDraft: null,
    idCounters: createIdFactory(),
    creationOffset: 0,
    sidebarTabsScrollLeft: 0,
    menuCategoriesScrollLeft: 0,
    groupDialogScrollTop: 0,
    history: {
      canUndo: false,
      canRedo: false,
    },
    clipboardPayload: null,
    lastClipboardSignature: null,
    pasteRepeatCount: 0,
  };

  function markDirty() {
    state.dirty = true;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
    state.inlineParamLayerDirty = false;
  }

  function markViewportDirty({ inlineParamLayer = false } = {}) {
    if (state.dirty && !state.thumbOnlyDirty && !state.viewportOnlyDirty) {
      if (inlineParamLayer) {
        state.inlineParamLayerDirty = true;
      }
      return;
    }

    state.dirty = true;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = true;
    if (inlineParamLayer) {
      state.inlineParamLayerDirty = true;
    }
  }

  function emitOutput(output) {
    onOutput?.(output);
  }

  function updateTempo(value, { emit = false, control = null } = {}) {
    const nextTempo = normalizeTempo(value);
    const changed = nextTempo !== state.tempo;
    state.tempo = nextTempo;

    const tempoInputs = state.root?.querySelectorAll?.("[data-action='tempo']") ?? [];

    for (const tempoInput of tempoInputs) {
      if (tempoInput === control || !tempoInput?.matches?.("[data-action='tempo']")) {
        continue;
      }

      syncRangeValue(tempoInput, nextTempo);
    }

    if (control?.matches?.("[data-action='tempo']")) {
      syncRangeValue(control, nextTempo);
    }

    if (changed && emit) {
      emitOutput({
        type: "audio/updateTempo",
        payload: { bpm: nextTempo },
      });
    }

    return changed;
  }

  function requestUndo() {
    if (!state.history.canUndo) {
      return;
    }

    emitOutput({ type: "ui/requestUndo" });
    focusViewport();
  }

  function requestRedo() {
    if (!state.history.canRedo) {
      return;
    }

    emitOutput({ type: "ui/requestRedo" });
    focusViewport();
  }

  function pushLocalIssue(code, message, extra = {}) {
    state.localIssues = [
      createLocalIssue(code, message, extra),
      ...state.localIssues,
    ].slice(0, 6);
    markDirty();
  }

  function emitSelection(nextSelection) {
    const normalized = clearDeletedSelection(normalizeSelection(nextSelection), state.snapshot);

    if (!selectionEquals(state.selection, normalized)) {
      state.selection = normalized;
      emitOutput({
        type: "ui/selectionChanged",
        payload: normalized,
      });
    } else {
      state.selection = normalized;
    }

    markDirty();
  }

  function getExistingNodeIdSet(nodeIds) {
    const existingIds = new Set(state.snapshot.nodes.map((node) => node.id));
    return normalizeGroupSelection({
      nodeIds: nodeIds.filter((nodeId) => existingIds.has(nodeId)),
    });
  }

  function getSelectedNodeIds() {
    const normalized = getExistingNodeIdSet(state.groupSelection.nodeIds);

    if (
      normalized.nodeIds.length === 0 &&
      state.selection.kind === "node" &&
      state.snapshot.nodes.some((node) => node.id === state.selection.nodeId)
    ) {
      return [state.selection.nodeId];
    }

    return normalized.nodeIds;
  }

  function setNodeSetSelection(nodeIds, preferredNodeId = null) {
    const normalized = getExistingNodeIdSet(nodeIds);
    state.groupSelection = normalized;

    if (normalized.nodeIds.length === 0) {
      emitSelection(createEmptySelection());
      return;
    }

    const nextPrimaryNodeId = normalized.nodeIds.includes(preferredNodeId)
      ? preferredNodeId
      : normalized.nodeIds[normalized.nodeIds.length - 1];
    emitSelection({ kind: "node", nodeId: nextPrimaryNodeId });
  }

  function clearNodeSetSelection() {
    state.groupSelection = createEmptyGroupSelection();
  }

  function getRenderableNodePosition(nodeId) {
    return (
      state.nodePositionOverrides.get(nodeId) ??
      state.snapshot.nodes.find((node) => node.id === nodeId)?.pos ??
      null
    );
  }

  function setNodePositionOverridesForIds(positionsByNodeId) {
    const nextOverrides = new Map(
      Array.from(state.nodePositionOverrides.entries()).filter(
        ([nodeId]) => !Object.hasOwn(positionsByNodeId, nodeId),
      ),
    );

    for (const [nodeId, pos] of Object.entries(positionsByNodeId)) {
      nextOverrides.set(nodeId, pos);
    }

    state.nodePositionOverrides = nextOverrides;
  }

  function clearNodePositionOverrides(nodeIds) {
    const nodeIdSet = new Set(nodeIds);
    state.nodePositionOverrides = new Map(
      Array.from(state.nodePositionOverrides.entries()).filter(([nodeId]) => !nodeIdSet.has(nodeId)),
    );
  }

  function getNodeDragIds(nodeId) {
    const selectedNodeIds = getSelectedNodeIds();

    if (selectedNodeIds.includes(nodeId)) {
      return selectedNodeIds;
    }

    return [nodeId];
  }

  function getClipboardSignature(payload) {
    return JSON.stringify(payload);
  }

  function getViewportCenterWorld() {
    return {
      x:
        (state.viewportSize.width / 2 - state.camera.x) /
        (state.camera.scale * state.config.grid.GRID_PX),
      y:
        (state.viewportSize.height / 2 - state.camera.y) /
        (state.camera.scale * state.config.grid.GRID_PX),
    };
  }

  function getPasteTargetPosition() {
    const pointerInsideViewport =
      state.lastPointerScreen.x >= 0 &&
      state.lastPointerScreen.y >= 0 &&
      state.lastPointerScreen.x <= state.viewportSize.width &&
      state.lastPointerScreen.y <= state.viewportSize.height;
    const base = pointerInsideViewport ? state.lastPointerWorld : getViewportCenterWorld();
    const repeatOffset = state.pasteRepeatCount * 2;

    return snapWorldPoint(
      {
        x: base.x + repeatOffset,
        y: base.y + repeatOffset,
      },
      state.config,
    );
  }

  function rememberClipboardPayload(payload) {
    state.clipboardPayload = cloneValue(payload);
    state.lastClipboardSignature = getClipboardSignature(payload);
    state.pasteRepeatCount = 0;
  }

  function focusViewport() {
    if (!state.viewport?.focus) {
      return;
    }

    if (state.root?.ownerDocument?.activeElement === state.viewport) {
      return;
    }

    focusElementWithoutScroll(state.viewport);
  }

  function getViewportRect() {
    return state.viewport?.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: state.viewportSize.width,
      height: state.viewportSize.height,
    };
  }

  function updateViewportSize() {
    if (!state.viewport) {
      return;
    }

    const size = getViewportSize(state.viewport);

    if (size.width > 0 && size.height > 0) {
      const responsiveWidth = state.root?.getBoundingClientRect?.().width ?? size.width;
      let responsiveChanged = false;

      if (state.sidebarAutoMode && !state.sidebarResponsiveInitialized) {
        const nextCollapsed = responsiveWidth <= SIDEBAR_COLLAPSE_BREAKPOINT_PX;

        if (state.sidebarCollapsed !== nextCollapsed) {
          state.sidebarCollapsed = nextCollapsed;
          responsiveChanged = true;
        }
        state.sidebarResponsiveInitialized = true;
      } else if (state.sidebarAutoMode) {
        const nextCollapsed = responsiveWidth <= SIDEBAR_COLLAPSE_BREAKPOINT_PX;

        if (state.sidebarCollapsed !== nextCollapsed) {
          state.sidebarCollapsed = nextCollapsed;
          responsiveChanged = true;
        }
      }

      if (responsiveWidth > COMPACT_TOOLBAR_BREAKPOINT_PX && state.tempoPopoverOpen) {
        state.tempoPopoverOpen = false;
        responsiveChanged = true;
      }

      const nextCamera = clampCamera(state.camera, size, state.config);
      const sizeChanged =
        state.viewportSize.width !== size.width || state.viewportSize.height !== size.height;
      const cameraChanged =
        state.camera.x !== nextCamera.x ||
        state.camera.y !== nextCamera.y ||
        state.camera.scale !== nextCamera.scale;

      if (sizeChanged || cameraChanged || responsiveChanged) {
        state.viewportSize = size;
        state.camera = nextCamera;
        markDirty();
      }
    }
  }

  function getNextCreatePosition(candidateNodeTemplate = null) {
    const base = state.menu.open
      ? state.menu.world
      : state.lastPointerWorld ?? getViewportCenterWorld();
    const step = 4;
    const maxCandidates = 256;

    function getSpiralOffset(index) {
      if (index === 0) {
        return { x: 0, y: 0 };
      }

      let x = 0;
      let y = 0;
      let segmentLength = 1;
      let traversed = 0;
      const directions = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ];

      for (let directionIndex = 0; traversed < index; directionIndex = (directionIndex + 1) % directions.length) {
        const direction = directions[directionIndex];

        for (let stepIndex = 0; stepIndex < segmentLength && traversed < index; stepIndex += 1) {
          x += direction.x * step;
          y += direction.y * step;
          traversed += 1;
        }

        if (directionIndex % 2 === 1) {
          segmentLength += 1;
        }
      }

      return { x, y };
    }

    function intersectsExistingNode(candidateNode) {
      const candidateBounds = getNodeWorldBounds(state.snapshot, candidateNode, state.registry);

      return state.snapshot.nodes.some((existingNode) => {
        const existingBounds = getNodeWorldBounds(state.snapshot, existingNode, state.registry);

        return (
          candidateBounds.x < existingBounds.x + existingBounds.width &&
          candidateBounds.x + candidateBounds.width > existingBounds.x &&
          candidateBounds.y < existingBounds.y + existingBounds.height &&
          candidateBounds.y + candidateBounds.height > existingBounds.y
        );
      });
    }

    for (
      let candidateIndex = state.creationOffset;
      candidateIndex < state.creationOffset + maxCandidates;
      candidateIndex += 1
    ) {
      const offset = getSpiralOffset(candidateIndex);
      const candidatePosition = snapWorldPoint(
        {
          x: base.x + offset.x,
          y: base.y + offset.y,
        },
        state.config,
      );
      const candidateNode = {
        id: "__candidate__",
        type: candidateNodeTemplate?.type ?? "out",
        groupRef: candidateNodeTemplate?.groupRef,
        pos: candidatePosition,
        rot: candidateNodeTemplate?.rot ?? 0,
        params: candidateNodeTemplate?.params ?? {},
      };

      if (!intersectsExistingNode(candidateNode)) {
        state.creationOffset = candidateIndex + 1;
        return candidatePosition;
      }
    }

    state.creationOffset += 1;
    return snapWorldPoint(base, state.config);
  }

  function emitUndo(reason) {
    emitOutput(createUndoOutput(state.snapshot, reason));
  }

  function emitGraphOps(ops, reason) {
    if (!Array.isArray(ops) || ops.length === 0) {
      return;
    }

    emitOutput(createGraphOpsOutput(ops, reason));
  }

  const inspectDslController = createInspectDslController({
    state,
    markDirty,
    emitUndo,
    emitGraphOps,
  });

  const inlineParamController = createInlineParamController({
    state,
    markViewportDirty,
    handleSetParam,
  });

  function openMenuAt(screen, world) {
    inlineParamController.clearInlineParamBlurCommitTimer();
    inlineParamController.clearInlineParamAutofocusTimer();
    if (state.inlineParamFocusFrameId !== null) {
      window.cancelAnimationFrame(state.inlineParamFocusFrameId);
      state.inlineParamFocusFrameId = null;
    }
    state.inlineParamEdit = null;
    state.menu = {
      ...state.menu,
      open: true,
      screen: { ...screen },
      world: { ...world },
      category: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      query: "",
      focusSearch: true,
      activeItemId: null,
      scrollActiveItem: false,
    };
    state.menuCategoriesScrollLeft = 0;
    state.creationOffset = 0;
    markDirty();
  }

  function closeMenu({ restoreViewportFocus = false } = {}) {
    if (!state.menu.open) {
      if (restoreViewportFocus) {
        focusViewport();
      }
      return;
    }

    state.menu = {
      ...state.menu,
      open: false,
    };
    if (restoreViewportFocus) {
      focusViewport();
    }
    markDirty();
  }

  function createEditorId(prefix) {
    return createDeterministicId(prefix, state);
  }

  function createGroupNodeRecord(groupRef) {
    const candidateNodeTemplate = {
      type: "group",
      groupRef,
      rot: 0,
      params: {},
    };

    return {
      id: createEditorId("node"),
      type: "group",
      groupRef,
      pos: getNextCreatePosition(candidateNodeTemplate),
      rot: 0,
      params: {},
    };
  }

  function handleCreateNode(type, groupRef = null) {
    const definition = groupRef ? state.registry.getNodeDefinition("group") : state.registry.getNodeDefinition(type);
    const shouldFocusInlineParam = !groupRef && definition?.hasParam;

    if (!definition && !groupRef) {
      pushLocalIssue("UI_UNKNOWN_NODE_TYPE", `Node type "${type}" is not available in the registry.`);
      return;
    }

    const node = groupRef
      ? createGroupNodeRecord(groupRef)
      : createNodeRecord(
          createEditorId("node"),
          definition,
          getNextCreatePosition({
            type: definition.type,
            rot: 0,
            params: { param: definition.defaultParam ?? 1 },
          }),
        );

    if (!groupRef && definition?.hasParam) {
      const value = String(node.params?.param ?? definition.defaultParam ?? 1);
      state.inlineParamEdit = {
        nodeId: node.id,
        draftValue: value,
        selectionStart: 0,
        selectionEnd: value.length,
        selectAllOnFocus: true,
      };
    } else if (state.inlineParamEdit?.nodeId === node.id) {
      state.inlineParamEdit = null;
    }

    emitUndo("create node");
    emitGraphOps([createAddNodeOp(node)], "create node");
    setNodeSetSelection([node.id], node.id);
    closeMenu({ restoreViewportFocus: !shouldFocusInlineParam });

    if (shouldFocusInlineParam) {
      inlineParamController.requestInlineParamAutofocus(node.id);
    }
  }

  function handleRotateSelection() {
    if (state.selection.kind !== "node") {
      return;
    }

    const node = state.snapshot.nodes.find((entry) => entry.id === state.selection.nodeId);

    if (!node) {
      return;
    }

    emitUndo("rotate node");
    emitGraphOps([createRotateNodeOp(node.id, ((node.rot ?? 0) + 90) % 360)], "rotate node");
  }

  function handleDeleteSelection() {
    const nodeIds = getSelectedNodeIds();
    const ops =
      nodeIds.length > 0
        ? createDeleteNodeSetOps(state.snapshot, nodeIds)
        : createDeleteSelectionOps(state.snapshot, state.selection);

    if (ops.length === 0) {
      return;
    }

    emitUndo("delete selection");
    clearNodeSetSelection();
    emitSelection(createEmptySelection());
    emitGraphOps(ops, "delete selection");
  }

  function handleRenameNode(nodeId, name) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

    if (!node || (node.name ?? "") === name) {
      return;
    }

    emitUndo("rename node");
    emitGraphOps([createRenameNodeOp(nodeId, name)], "rename node");
  }

  function handleSetParam(nodeId, value) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

    if (!node) {
      return;
    }

    const nextValue = clampParamInput(value);

    if ((node.params?.param ?? 1) === nextValue) {
      return;
    }

    const reason = node.type === "pulse" ? "set pulse rate" : "set param";
    emitUndo(reason);
    emitGraphOps([createSetParamOp(nodeId, nextValue)], reason);
  }

  function handleRemoveGroup(groupId) {
    if (!canRemoveGroup(state.snapshot, groupId)) {
      pushLocalIssue("UI_GROUP_IN_USE", `Group "${groupId}" cannot be removed while an instance still exists.`, {
        severity: "error",
      });
      return;
    }

    emitUndo("remove group");
    emitGraphOps(
      [
        {
          type: "removeGroup",
          payload: {
            groupId,
          },
        },
      ],
      "remove group",
    );
  }

  function getSeededGroupSelection() {
    return normalizeGroupSelection({ nodeIds: getSelectedNodeIds() });
  }

  function handleGroupOpen() {
    const draft = createGroupDraft(state);

    if (draft.candidates.nodes.length === 0) {
      pushLocalIssue(
        "UI_GROUP_EMPTY",
        "Grouping requires at least one internally connected selection.",
      );
      return;
    }

    state.groupDraft = draft;
    state.groupDialogScrollTop = 0;
    markDirty();
  }

  function handleGroupEdit(groupId) {
    const group = state.snapshot.groups?.[groupId];

    if (!group) {
      pushLocalIssue("UI_GROUP_NOT_FOUND", `Group "${groupId}" was not found.`, {
        severity: "error",
      });
      return;
    }

    state.groupDraft = createGroupEditDraft(state, group);
    state.groupDialogScrollTop = 0;
    markDirty();
  }

  function handleGroupMove(kind, index, direction) {
    if (!state.groupDraft) {
      return;
    }

    const list = state.groupDraft.mappings[kind];

    if (index < 0 || index >= list.length || index + direction < 0 || index + direction >= list.length) {
      return;
    }

    const nextList = [...list];
    const [entry] = nextList.splice(index, 1);
    nextList.splice(index + direction, 0, entry);
    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: nextList,
      },
    };
    markDirty();
  }

  function handleGroupRemoveMapping(kind, mappingId) {
    if (!state.groupDraft) {
      return;
    }

    const active = state.groupDraft.mappings[kind];
    const index = active.findIndex((entry) => entry.id === mappingId);

    if (index < 0) {
      return;
    }

    const removed = active[index];
    const restoreBucket =
      kind === "controls" && removed.restoreBucket === "unavailable"
        ? "unavailable"
        : "available";

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: active.filter((entry) => entry.id !== mappingId),
      },
      available: {
        ...state.groupDraft.available,
        [kind]:
          restoreBucket === "available"
            ? [...state.groupDraft.available[kind], removed]
            : state.groupDraft.available[kind],
      },
      unavailable: {
        ...state.groupDraft.unavailable,
        [kind]:
          restoreBucket === "unavailable"
            ? [...state.groupDraft.unavailable[kind], removed]
            : state.groupDraft.unavailable[kind],
      },
      restoreSelection: {
        ...state.groupDraft.restoreSelection,
        [kind]:
          restoreBucket === "available"
            ? state.groupDraft.restoreSelection[kind] || removed.id
            : state.groupDraft.restoreSelection[kind],
      },
    };
    markDirty();
  }

  function handleGroupRestore(kind) {
    if (!state.groupDraft) {
      return;
    }

    const mappingId = state.groupDraft.restoreSelection[kind];
    const available = state.groupDraft.available[kind];
    const entry = available.find((item) => item.id === mappingId);

    if (!entry) {
      return;
    }

    const nextAvailable = available.filter((item) => item.id !== mappingId);

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: [
          ...state.groupDraft.mappings[kind],
          {
            ...entry,
            restoreBucket: entry.restoreBucket ?? "available",
          },
        ],
      },
      available: {
        ...state.groupDraft.available,
        [kind]: nextAvailable,
      },
      restoreSelection: {
        ...state.groupDraft.restoreSelection,
        [kind]: nextAvailable[0]?.id ?? "",
      },
    };
    markDirty();
  }

  function handleGroupExposeInstead(kind, mappingId) {
    if (!state.groupDraft || kind !== "controls") {
      return;
    }

    const blocked = state.groupDraft.unavailable.controls.find((entry) => entry.id === mappingId);

    if (!blocked) {
      return;
    }

    const confirmMessage =
      "This will disconnect the internal control cable to this input and expose it at the group boundary.";
    const confirmFn = state.root?.ownerDocument?.defaultView?.confirm;
    let confirmed = true;

    if (typeof confirmFn === "function") {
      try {
        confirmed = confirmFn(confirmMessage);
      } catch {
        confirmed = false;
      }
    }

    if (!confirmed) {
      return;
    }

    const nextUnavailable = state.groupDraft.unavailable.controls.filter(
      (entry) => entry.id !== mappingId,
    );

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        controls: [
          ...state.groupDraft.mappings.controls,
          {
            ...blocked,
            restoreBucket: "unavailable",
          },
        ],
      },
      unavailable: {
        ...state.groupDraft.unavailable,
        controls: nextUnavailable,
      },
    };
    markDirty();
  }

  function handleGroupCommit() {
    if (!state.groupDraft) {
      return;
    }

    if (state.groupDraft.mode === "edit") {
      const result = buildUpdateGroupOps({
        snapshot: state.snapshot,
        groupId: state.groupDraft.groupId,
        groupName: state.groupDraft.name.trim() || state.groupDraft.groupId,
        mappings: state.groupDraft.mappings,
        preserveInternalCableDelays: state.groupDraft.preserveInternalCableDelays,
      });

      if (!result.ok) {
        pushLocalIssue("UI_GROUP_UPDATE_FAILED", result.reason, { severity: "error" });
        return;
      }

      emitUndo("update group");
      emitGraphOps(result.ops, "update group");
      state.groupDraft = null;
      state.groupDialogScrollTop = 0;
      markDirty();
      return;
    }

    const groupId = createEditorId("group");
    const groupNodeId = createEditorId("node");
    const result = buildCreateGroupOps({
      snapshot: state.snapshot,
      registry: state.registry,
      groupSelection: state.groupSelection,
      groupId,
      groupName: state.groupDraft.name.trim() || groupId,
      groupNodeId,
      groupPosition: getNextCreatePosition({ type: "group", rot: 0, params: {} }),
      mappings: state.groupDraft.mappings,
      preserveInternalCableDelays: state.groupDraft.preserveInternalCableDelays,
    });

    if (!result.ok) {
      pushLocalIssue("UI_GROUP_BUILD_FAILED", result.reason, { severity: "error" });
      return;
    }

    emitUndo("create group");
    emitGraphOps(result.ops, "create group");
    state.groupDraft = null;
    state.groupDialogScrollTop = 0;
    setNodeSetSelection([groupNodeId], groupNodeId);
  }

  function commitSampleSlots(nextSlots, labelUpdate = null) {
    const nextLabels = new Map(state.sampleFileLabels);

    if (labelUpdate?.slotId) {
      if (typeof labelUpdate.fileLabel === "string" && labelUpdate.fileLabel.trim() !== "") {
        nextLabels.set(labelUpdate.slotId, labelUpdate.fileLabel.trim());
      } else {
        nextLabels.delete(labelUpdate.slotId);
      }
    }

    state.slots = nextSlots;
    state.sampleFileLabels = reconcileSampleFileLabels(nextLabels, nextSlots);
    emitOutput({
      type: "audio/updateSlots",
      payload: {
        slots: cloneSlots(nextSlots),
      },
    });
    markDirty();
  }

  async function handleFileInputChange(input) {
    const slotId = input.getAttribute("data-slot-id");
    const file = input.files?.[0];

    if (!slotId || !file) {
      return;
    }

    try {
      const nextPath = await readFileAsDataUrl(file);
      const nextSlots = state.slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              path: nextPath,
            }
          : { ...slot },
      );

      commitSampleSlots(nextSlots, {
        fileLabel: file.name,
        slotId,
      });
    } finally {
      input.value = "";
    }
  }

  const canvasController = createCanvasController({
    state,
    markDirty,
    markViewportDirty,
    pushLocalIssue,
    clearNodeSetSelection,
    emitSelection,
    setNodeSetSelection,
    getSeededGroupSelection,
    closeMenu,
    focusViewport,
    getViewportRect,
    getRenderableNodePosition,
    setNodePositionOverridesForIds,
    clearNodePositionOverrides,
    getNodeDragIds,
    getSelectedNodeIds,
    createDeterministicId: createEditorId,
    isInteractiveTarget,
    handleRotateSelection,
    emitUndo,
    emitGraphOps,
  });

  const inputController = createInputController({
    state,
    onSidebarAction,
    markDirty,
    defaultPaletteMenuCategoryId: DEFAULT_PALETTE_MENU_CATEGORY_ID,
    emitOutput,
    selectionToFocusTarget,
    updateTempo,
    requestUndo,
    requestRedo,
    openMenuAt,
    closeMenu,
    focusViewport,
    getViewportCenterWorld,
    handleCreateNode,
    handleRotateSelection,
    handleDeleteSelection,
    handleCancelEdgeCreate: canvasController.cancelEdgeCreate,
    handleUndoEdgeCreateCorner: canvasController.undoEdgeCreateCorner,
    handleRenameNode,
    handleSetParam,
    handleGroupOpen,
    handleGroupEdit,
    handleGroupMove,
    handleGroupRemoveMapping,
    handleGroupRestore,
    handleGroupExposeInstead,
    handleGroupCommit,
    handleRemoveGroup,
    handleInspectDslInput: inspectDslController.handleInspectDslInput,
    insertInspectDslNewline: inspectDslController.insertInspectDslNewline,
    handleApplyInspectDsl: inspectDslController.handleApplyInspectDsl,
    handleReloadInspectDsl: inspectDslController.handleReloadInspectDsl,
    handleJumpDocsCategory: inspectDslController.handleJumpDocsCategory,
    handleFileInputChange,
    getSelectedNodeIds,
    clearNodeSetSelection,
    emitSelection,
    setNodeSetSelection,
    emitUndo,
    emitGraphOps,
    rememberClipboardPayload,
    getClipboardSignature,
    getPasteTargetPosition,
    createDeterministicId: createEditorId,
    beginInlineParamEdit: inlineParamController.beginInlineParamEdit,
    clearInlineParamBlurCommitTimer: inlineParamController.clearInlineParamBlurCommitTimer,
    commitInlineParamValue: inlineParamController.commitInlineParamValue,
    cancelInlineParamEdit: inlineParamController.cancelInlineParamEdit,
  });

  const renderController = createRenderController({
    state,
    markViewportDirty,
    syncInspectDslDraft: inspectDslController.syncInspectDslDraft,
    buildInlineParamLayerMarkup: inlineParamController.buildInlineParamLayerMarkup,
    syncInlineParamEditFromDom: inlineParamController.syncInlineParamEditFromDom,
    restoreInlineParamFocus: inlineParamController.restoreInlineParamFocus,
    scheduleInlineParamFocusRestore: inlineParamController.scheduleInlineParamFocusRestore,
    buildPreviewRouteForRender: canvasController.buildPreviewRouteForRender,
    getViewportCursor: canvasController.getViewportCursor,
    focusViewport,
    updateViewportSize,
  });

  const handleRootClick = (event) =>
    inputController.handleRootClick(event, canvasController.handleViewportClick);

  function mount(element) {
    state.root = element;
    state.mounted = true;
    const initialWidth = element.getBoundingClientRect?.().width ?? 0;

    if (state.sidebarAutoMode && initialWidth > 0) {
      state.sidebarCollapsed = initialWidth <= SIDEBAR_COLLAPSE_BREAKPOINT_PX;
      state.sidebarResponsiveInitialized = true;
    }
    renderController.render();
    updateViewportSize();

    state.root.addEventListener("click", handleRootClick);
    state.root.addEventListener("dblclick", canvasController.handleDoubleClick);
    state.root.addEventListener("change", inputController.handleChange);
    state.root.addEventListener("input", inputController.handleInput);
    state.root.addEventListener("focusin", inputController.handleFocusIn);
    state.root.addEventListener("focusout", inputController.handleFocusOut);
    state.root.addEventListener("keydown", inputController.handleKeyDown);
    state.root.addEventListener("pointerdown", canvasController.handlePointerDown);
    state.root.addEventListener("pointermove", canvasController.handlePointerMove);
    state.root.addEventListener("pointercancel", canvasController.handlePointerCancel);
    state.root.addEventListener("contextmenu", canvasController.handleContextMenu);
    state.root.addEventListener("wheel", canvasController.handleWheel, { passive: false });
    state.root.ownerDocument.addEventListener("keydown", inputController.handleDocumentKeyDown);
    state.root.ownerDocument.addEventListener("copy", inputController.handleCopy);
    state.root.ownerDocument.addEventListener("cut", inputController.handleCut);
    state.root.ownerDocument.addEventListener("paste", inputController.handlePaste);
    window.addEventListener("pointerup", canvasController.handlePointerUp);
    window.addEventListener("pointercancel", canvasController.handlePointerCancel);
    window.addEventListener("resize", updateViewportSize);
    state.frameId = window.requestAnimationFrame(renderController.tick);
  }

  function unmount() {
    if (!state.root) {
      return;
    }

    state.mounted = false;
    window.cancelAnimationFrame(state.frameId);
    state.root.removeEventListener("click", handleRootClick);
    state.root.removeEventListener("dblclick", canvasController.handleDoubleClick);
    state.root.removeEventListener("change", inputController.handleChange);
    state.root.removeEventListener("input", inputController.handleInput);
    state.root.removeEventListener("focusin", inputController.handleFocusIn);
    state.root.removeEventListener("focusout", inputController.handleFocusOut);
    state.root.removeEventListener("keydown", inputController.handleKeyDown);
    state.root.removeEventListener("pointerdown", canvasController.handlePointerDown);
    state.root.removeEventListener("pointermove", canvasController.handlePointerMove);
    state.root.removeEventListener("pointercancel", canvasController.handlePointerCancel);
    state.root.removeEventListener("contextmenu", canvasController.handleContextMenu);
    state.root.removeEventListener("wheel", canvasController.handleWheel);
    state.root.ownerDocument.removeEventListener("keydown", inputController.handleDocumentKeyDown);
    state.root.ownerDocument.removeEventListener("copy", inputController.handleCopy);
    state.root.ownerDocument.removeEventListener("cut", inputController.handleCut);
    state.root.ownerDocument.removeEventListener("paste", inputController.handlePaste);
    inlineParamController.clearInlineParamBlurCommitTimer();
    inlineParamController.clearInlineParamAutofocusTimer();
    if (state.inlineParamFocusFrameId !== null) {
      window.cancelAnimationFrame(state.inlineParamFocusFrameId);
      state.inlineParamFocusFrameId = null;
    }
    window.removeEventListener("pointerup", canvasController.handlePointerUp);
    window.removeEventListener("pointercancel", canvasController.handlePointerCancel);
    window.removeEventListener("resize", updateViewportSize);
    state.root.innerHTML = "";
    state.root = null;
    state.viewport = null;
    state.viewportCanvas = null;
    state.inlineParamLayer = null;
    state.touchPointers.clear();
    state.touchGesture = { kind: "none" };
  }

  return {
    mount,
    unmount,
    setSnapshot(snapshot) {
      state.snapshot = snapshot ?? createEmptyGraphSnapshot();
      if (state.inlineParamEdit) {
        const inlineParamNode = state.snapshot.nodes.find((entry) => entry.id === state.inlineParamEdit.nodeId);

        if (!inlineParamNode || !inlineParamController.getInlineParamNodeDefinition(inlineParamNode)) {
          state.inlineParamEdit = null;
        }
      }
      state.nodePositionOverrides = new Map(
        Array.from(state.nodePositionOverrides.entries()).filter(([nodeId, overridePos]) => {
          const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

          if (!node) {
            return false;
          }

          return node.pos.x !== overridePos.x || node.pos.y !== overridePos.y;
        }),
      );
      state.selection = clearDeletedSelection(state.selection, state.snapshot);
      state.groupSelection = normalizeGroupSelection({
        nodeIds: state.groupSelection.nodeIds.filter((nodeId) =>
          state.snapshot.nodes.some((node) => node.id === nodeId),
        ),
      });
      if (
        state.groupDraft?.mode === "edit" &&
        !state.snapshot.groups?.[state.groupDraft.groupId]
      ) {
        state.groupDraft = null;
      }
      markDirty();
    },
    setRoutes(routes) {
      state.routes = routes ?? createEmptyRoutes();
      markDirty();
    },
    setDiagnostics(issues) {
      state.diagnostics = Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : [];
      markDirty();
    },
    setPalette(palette) {
      state.palette = Array.isArray(palette) ? palette.map((entry) => ({ ...entry })) : [];
      markDirty();
    },
    setSelection(selection) {
      state.selection = clearDeletedSelection(normalizeSelection(selection), state.snapshot);
      markDirty();
    },
    setSlots(slots) {
      state.slots = normalizeSlots(slots);
      state.sampleFileLabels = reconcileSampleFileLabels(state.sampleFileLabels, state.slots);
      markDirty();
    },
    setTempo(tempo) {
      updateTempo(tempo);
    },
    setSidebarExtensions(extensions) {
      const nextSidebarExtensions = normalizeSidebarExtensions(extensions);
      const nextActiveTab = getSidebarTabIds(nextSidebarExtensions).has(state.activeTab) ? state.activeTab : "console";
      const shouldRender =
        nextActiveTab !== state.activeTab ||
        sidebarExtensionsRequireRender(state.sidebarExtensions, nextSidebarExtensions, nextActiveTab);

      state.sidebarExtensions = nextSidebarExtensions;

      if (nextActiveTab !== state.activeTab) {
        state.activeTab = nextActiveTab;
      }

      if (shouldRender) {
        markDirty();
      }
    },
    setHistory(history) {
      state.history = {
        canUndo: history?.canUndo === true,
        canRedo: history?.canRedo === true,
      };
      markDirty();
    },
  };
}
