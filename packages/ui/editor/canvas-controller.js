import { getPortAnchor, resolveRoutingConfig, routeEdge } from "@ping/core";

import { applyWheelPan, applyWheelZoom, getWorldCursorFromPointer } from "../render/panzoom.js";
import { hitPort } from "./hittest.js";
import {
  buildObstacleAwarePreviewRoute,
  createEmptyRoute,
  getNodeWorldBounds,
  snapWorldPoint,
} from "./geometry.js";
import {
  canCreateEdge,
  createEdgeRecord,
  createMoveNodeSetOps,
  normalizeEdgeEndpoints,
} from "./ops.js";
import { createEmptyDragState, createEmptyHover, createEmptySelection, toggleGroupSelection } from "./state.js";
import { EDGE_CREATE_PREVIEW_EDGE_ID, hoverEquals } from "./utils.js";

export function createCanvasController({
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
  createDeterministicId,
  isInteractiveTarget,
  handleRotateSelection,
  emitUndo,
  emitGraphOps,
}) {
  function clearTransientStates() {
    state.drag = createEmptyDragState();
    state.pan = null;
    state.pointerPress = null;
    state.dragStarted = false;
    state.boxSelection = null;
    state.edgeCreatePointerActive = false;
    state.suppressViewportClick = false;
  }

  function getPortHitFromTarget(target) {
    const portElement = target?.closest?.("[data-port-node-id]");

    if (!portElement) {
      return null;
    }

    return {
      kind: "port",
      nodeId: portElement.getAttribute("data-port-node-id"),
      portSlot: Number(portElement.getAttribute("data-port-slot")),
      direction: portElement.getAttribute("data-port-direction"),
    };
  }

  function getNodeHitFromTarget(target) {
    const nodeElement = target?.closest?.("[data-node-id]");

    if (!nodeElement) {
      return null;
    }

    return {
      kind: "node",
      nodeId: nodeElement.getAttribute("data-node-id"),
    };
  }

  function getEdgeHitFromTarget(target) {
    const edgeElement = target?.closest?.("[data-edge-id]");

    if (!edgeElement) {
      return null;
    }

    return {
      kind: "edge",
      edgeId: edgeElement.getAttribute("data-edge-id"),
    };
  }

  function getCornerHitFromTarget(target) {
    const cornerElement = target?.closest?.("[data-corner-edge-id]");

    if (!cornerElement) {
      return null;
    }

    return {
      kind: "corner",
      edgeId: cornerElement.getAttribute("data-corner-edge-id"),
      cornerIndex: Number(cornerElement.getAttribute("data-corner-index")),
    };
  }

  function getPortHitFromPointerEvent(event) {
    const targetHit = getPortHitFromTarget(event.target);

    if (targetHit) {
      return targetHit;
    }

    if (!state.viewport) {
      return null;
    }

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

    return hitPort(
      state.snapshot,
      state.registry,
      worldPoint,
      state.config.port.hoverRadiusPx / state.config.grid.GRID_PX,
    );
  }

  function completeEdgeCreate(portHit) {
    const normalizedEndpoints = normalizeEdgeEndpoints(state.drag.from, portHit);
    const canConnect = canCreateEdge(state.snapshot, state.registry, state.drag.from, portHit);

    if (!normalizedEndpoints || !canConnect) {
      pushLocalIssue(
        "UI_EDGE_REJECTED",
        "That connection would violate the single-cable or port-direction rules.",
      );
      return false;
    }

    const edge = createEdgeRecord(
      createDeterministicId("edge"),
      normalizedEndpoints.from,
      normalizedEndpoints.to,
      state.drag.tempCorners,
    );
    emitUndo("create edge");
    emitGraphOps(
      [
        {
          type: "addEdge",
          payload: { edge },
        },
      ],
      "create edge",
    );
    clearTransientStates();
    closeMenu();
    return true;
  }

  function getEdgeCreatePreviewPortHit(portHit) {
    if (state.drag.kind !== "edge-create") {
      return null;
    }

    if (!portHit || portHit.direction === state.drag.from.direction) {
      return null;
    }

    return canCreateEdge(state.snapshot, state.registry, state.drag.from, portHit)
      ? portHit
      : null;
  }

  function addEdgeCreateCorner(worldPoint) {
    if (state.drag.kind !== "edge-create") {
      return;
    }

    state.drag = {
      ...state.drag,
      tempCorners: [...state.drag.tempCorners, snapWorldPoint(worldPoint, state.config)],
      cursor: worldPoint,
    };
    markDirty();
  }

  function beginNodeDrag(nodeId, startWorld, startScreen) {
    const nodeIds = getNodeDragIds(nodeId);
    const startPositions = Object.fromEntries(
      nodeIds
        .map((entryNodeId) => [entryNodeId, getRenderableNodePosition(entryNodeId)])
        .filter(([, pos]) => pos),
    );

    if (Object.keys(startPositions).length === 0) {
      return;
    }

    state.pointerPress = {
      kind: "node",
      nodeId,
      nodeIds,
      startWorld,
      startScreen,
      startPositions,
    };
    state.dragStarted = false;
  }

  function beginCornerDrag(edgeId, cornerIndex, startWorld, startScreen) {
    const edge = state.snapshot.edges.find((entry) => entry.id === edgeId);
    const point = edge?.manualCorners?.[cornerIndex];

    if (!point) {
      return;
    }

    state.pointerPress = {
      kind: "corner",
      edgeId,
      cornerIndex,
      startWorld,
      startScreen,
      startPoint: { ...point },
    };
    state.dragStarted = false;
  }

  function beginBoxSelection(startWorld, mode) {
    state.boxSelection = {
      start: startWorld,
      current: startWorld,
      mode,
    };
    markDirty();
  }

  function commitBoxSelection() {
    if (!state.boxSelection) {
      return;
    }

    const start = state.boxSelection.start;
    const end = state.boxSelection.current;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const nextSelection = state.boxSelection.mode === "add" ? [...getSelectedNodeIds()] : [];

    for (const node of state.snapshot.nodes) {
      const bounds = getNodeWorldBounds(state.snapshot, node, state.registry);
      const overlaps =
        bounds.x < maxX &&
        bounds.x + bounds.width > minX &&
        bounds.y < maxY &&
        bounds.y + bounds.height > minY;

      if (overlaps && !nextSelection.includes(node.id)) {
        nextSelection.push(node.id);
      }
    }

    setNodeSetSelection(nextSelection, nextSelection[nextSelection.length - 1] ?? null);
    state.boxSelection = null;
    markDirty();
  }

  function commitNodeDrag() {
    if (state.drag.kind !== "node") {
      return;
    }

    const snappedPositions = Object.fromEntries(
      Object.entries(state.drag.currentPositions ?? state.drag.startPositions).map(([nodeId, pos]) => [
        nodeId,
        snapWorldPoint(pos, state.config),
      ]),
    );
    const ops = createMoveNodeSetOps(state.drag.startPositions, snappedPositions);

    if (ops.length > 0) {
      setNodePositionOverridesForIds(snappedPositions);
      emitUndo("move node");
      emitGraphOps(ops, ops.length > 1 ? "move nodes" : "move node");
    } else {
      clearNodePositionOverrides(state.drag.nodeIds);
    }

    clearTransientStates();
    markDirty();
  }

  function commitCornerDrag() {
    if (state.drag.kind !== "corner") {
      return;
    }

    const snapped = snapWorldPoint(state.drag.currentPoint, state.config);

    if (
      snapped.x !== state.drag.startPoint.x ||
      snapped.y !== state.drag.startPoint.y
    ) {
      emitUndo("move corner");
      emitGraphOps(
        [
          {
            type: "moveCorner",
            payload: {
              edgeId: state.drag.edgeId,
              index: state.drag.cornerIndex,
              point: snapped,
            },
          },
        ],
        "move corner",
      );
    }

    clearTransientStates();
    markDirty();
  }

  function cancelEdgeCreate() {
    if (state.drag.kind !== "edge-create") {
      return;
    }

    clearTransientStates();
    markDirty();
  }

  function updateHoverFromTarget(target) {
    const hover =
      getPortHitFromTarget(target) ??
      getCornerHitFromTarget(target) ??
      getEdgeHitFromTarget(target) ??
      getNodeHitFromTarget(target) ??
      createEmptyHover();

    if (hoverEquals(state.hover, hover)) {
      return;
    }

    state.hover = hover;
    markViewportDirty();
  }

  function handlePointerDown(event) {
    if (!state.viewport || isInteractiveTarget(event.target)) {
      return;
    }

    focusViewport();
    state.suppressViewportClick = false;

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
    const screenPoint = {
      x: event.clientX - getViewportRect().left,
      y: event.clientY - getViewportRect().top,
    };

    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;
    const multiSelectModifier = event.shiftKey || event.metaKey || event.ctrlKey;

    const portHit = getPortHitFromPointerEvent(event);

    if (event.button === 0 && state.drag.kind === "edge-create" && !state.edgeCreatePointerActive) {
      if (portHit?.direction !== undefined) {
        if (portHit.direction !== state.drag.from.direction) {
          const completed = completeEdgeCreate(portHit);

          if (completed) {
            state.suppressViewportClick = true;
          }
          return;
        }

        return;
      }

      return;
    }

    if (event.button === 0 && (portHit?.direction === "out" || portHit?.direction === "in")) {
      clearNodeSetSelection();
      state.drag = {
        kind: "edge-create",
        from: {
          nodeId: portHit.nodeId,
          portSlot: portHit.portSlot,
          direction: portHit.direction,
        },
        cursor: worldPoint,
        tempCorners: [],
        previewTargetPort: null,
      };
      state.edgeCreatePointerActive = true;
      emitSelection(createEmptySelection());
      closeMenu();
      markDirty();
      return;
    }

    const cornerHit = getCornerHitFromTarget(event.target);

    if (event.button === 0 && cornerHit) {
      clearNodeSetSelection();
      emitSelection(cornerHit);
      beginCornerDrag(cornerHit.edgeId, cornerHit.cornerIndex, worldPoint, screenPoint);
      return;
    }

    const edgeHit = getEdgeHitFromTarget(event.target);

    if (event.button === 0 && edgeHit) {
      clearNodeSetSelection();
      emitSelection(edgeHit);
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (event.button === 0 && nodeHit) {
      if (multiSelectModifier) {
        const toggled = toggleGroupSelection(getSeededGroupSelection(), nodeHit.nodeId);
        setNodeSetSelection(toggled.nodeIds, nodeHit.nodeId);
        state.suppressViewportClick = true;
        return;
      }

      setNodeSetSelection(
        getNodeDragIds(nodeHit.nodeId),
        nodeHit.nodeId,
      );
      beginNodeDrag(nodeHit.nodeId, worldPoint, screenPoint);
      return;
    }

    if (event.button === 0) {
      closeMenu();
      beginBoxSelection(worldPoint, multiSelectModifier ? "add" : "replace");
    }
  }

  function shouldThrottlePreview(now) {
    if (state.drag.kind === "none" && !state.pan && !state.boxSelection) {
      return false;
    }

    return now - state.lastPreviewUpdateAt < state.previewThrottleMs;
  }

  function handlePointerMove(event) {
    if (!state.viewport) {
      return;
    }

    const now = performance.now();

    if (shouldThrottlePreview(now)) {
      return;
    }

    state.lastPreviewUpdateAt = now;
    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
    const screenPoint = {
      x: event.clientX - getViewportRect().left,
      y: event.clientY - getViewportRect().top,
    };
    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;

    if (state.boxSelection) {
      state.boxSelection = {
        ...state.boxSelection,
        current: worldPoint,
      };
      markDirty();
      return;
    }

    if (state.pointerPress?.kind === "node") {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= state.config.interaction.dragThresholdPx) {
        state.drag = {
          kind: "node",
          nodeIds: [...state.pointerPress.nodeIds],
          startPositions: state.pointerPress.startPositions,
          currentPositions: state.pointerPress.startPositions,
        };
        state.dragStarted = true;
      }

      if (state.drag.kind === "node") {
        const delta = {
          x: worldPoint.x - state.pointerPress.startWorld.x,
          y: worldPoint.y - state.pointerPress.startWorld.y,
        };
        const currentPositions = Object.fromEntries(
          Object.entries(state.pointerPress.startPositions).map(([nodeId, pos]) => [
            nodeId,
            {
              x: pos.x + delta.x,
              y: pos.y + delta.y,
            },
          ]),
        );
        state.drag = {
          ...state.drag,
          currentPositions,
        };
        setNodePositionOverridesForIds(currentPositions);
        markViewportDirty({ inlineParamLayer: true });
        return;
      }
    }

    if (state.pointerPress?.kind === "corner") {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= state.config.interaction.dragThresholdPx) {
        state.drag = {
          kind: "corner",
          edgeId: state.pointerPress.edgeId,
          cornerIndex: state.pointerPress.cornerIndex,
          startPoint: state.pointerPress.startPoint,
          currentPoint: state.pointerPress.startPoint,
        };
        state.dragStarted = true;
      }

      if (state.drag.kind === "corner") {
        state.drag = {
          ...state.drag,
          currentPoint: worldPoint,
        };
        markViewportDirty();
        return;
      }
    }

    if (state.drag.kind === "edge-create") {
      const portHit = getPortHitFromPointerEvent(event);
      const previewTargetPort = getEdgeCreatePreviewPortHit(portHit);
      const nextHover = portHit ?? createEmptyHover();

      if (!hoverEquals(state.hover, nextHover)) {
        state.hover = nextHover;
      }

      state.drag = {
        ...state.drag,
        cursor: worldPoint,
        previewTargetPort,
      };
      markViewportDirty();
      return;
    }

    if (!event.target?.closest?.(".ping-editor__viewport") || isInteractiveTarget(event.target)) {
      return;
    }

    updateHoverFromTarget(event.target);
  }

  function handlePointerUp(event) {
    if (state.drag.kind === "edge-create" && state.edgeCreatePointerActive) {
      const portHit = getPortHitFromPointerEvent(event);

      state.edgeCreatePointerActive = false;

      if (portHit && portHit.direction !== state.drag.from.direction) {
        completeEdgeCreate(portHit);
        return;
      }

      if (state.viewport) {
        state.drag = {
          ...state.drag,
          cursor: getWorldCursorFromPointer(event, state.viewport, state.camera, state.config),
          previewTargetPort: null,
        };
      }
      markViewportDirty();
      return;
    }

    if (state.drag.kind === "edge-create") {
      return;
    }

    if (state.boxSelection) {
      commitBoxSelection();
      state.suppressViewportClick = true;
      clearTransientStates();
      return;
    }

    if (state.drag.kind === "node") {
      commitNodeDrag();
      return;
    }

    if (state.drag.kind === "corner") {
      commitCornerDrag();
      return;
    }

    if (state.pointerPress?.kind === "node" && !state.dragStarted) {
      emitSelection({ kind: "node", nodeId: state.pointerPress.nodeId });
      clearTransientStates();
      return;
    }

    if (state.pointerPress?.kind === "corner" && !state.dragStarted) {
      emitSelection({
        kind: "corner",
        edgeId: state.pointerPress.edgeId,
        cornerIndex: state.pointerPress.cornerIndex,
      });
      clearTransientStates();
      return;
    }

    clearTransientStates();
  }

  function handleViewportClick(event) {
    if (!state.viewport || event.target.closest("[data-action], input, select, button, label")) {
      return;
    }

    if (state.suppressViewportClick) {
      state.suppressViewportClick = false;
      return;
    }

    const portHit = getPortHitFromTarget(event.target);

    if (state.drag.kind === "edge-create") {
      if (state.edgeCreatePointerActive) {
        return;
      }

      if (portHit && portHit.direction !== state.drag.from.direction) {
        completeEdgeCreate(portHit);
        return;
      }

      if (portHit) {
        return;
      }

      const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
      addEdgeCreateCorner(worldPoint);
      return;
    }

    const cornerHit = getCornerHitFromTarget(event.target);

    if (cornerHit) {
      clearNodeSetSelection();
      emitSelection(cornerHit);
      return;
    }

    const edgeHit = getEdgeHitFromTarget(event.target);

    if (edgeHit) {
      clearNodeSetSelection();
      emitSelection(edgeHit);
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (nodeHit) {
      emitSelection(nodeHit);
      return;
    }

    clearNodeSetSelection();
    emitSelection(createEmptySelection());
  }

  function handleContextMenu(event) {
    const nodeHit = getNodeHitFromTarget(event.target);

    if (state.drag.kind === "edge-create") {
      event.preventDefault();
      cancelEdgeCreate();
      return;
    }

    if (nodeHit) {
      event.preventDefault();
      setNodeSetSelection([nodeHit.nodeId], nodeHit.nodeId);
      handleRotateSelection();
    }
  }

  function handleWheel(event) {
    if (!state.viewport) {
      return;
    }

    const target = event.target;

    if (!target?.closest?.(".ping-editor__viewport")) {
      return;
    }

    if (target.closest(".ping-editor__group-dialog, .ping-editor__menu") || isInteractiveTarget(target)) {
      return;
    }

    event.preventDefault();
    state.camera =
      event.ctrlKey || event.metaKey
        ? applyWheelZoom(state.camera, event, state.viewport, state.config)
        : applyWheelPan(state.camera, event, state.viewport, state.config);
    markViewportDirty({ inlineParamLayer: true });
  }

  function buildPreviewRouteForRender() {
    if (state.drag.kind !== "edge-create") {
      return null;
    }

    const previewTargetPort = getEdgeCreatePreviewPortHit(state.drag.previewTargetPort);

    if (previewTargetPort) {
      const normalizedEndpoints = normalizeEdgeEndpoints(state.drag.from, previewTargetPort);

      if (normalizedEndpoints) {
        try {
          return routeEdge(
            EDGE_CREATE_PREVIEW_EDGE_ID,
            {
              ...state.snapshot,
              edges: [
                ...state.snapshot.edges,
                {
                  id: EDGE_CREATE_PREVIEW_EDGE_ID,
                  from: {
                    nodeId: normalizedEndpoints.from.nodeId,
                    portSlot: normalizedEndpoints.from.portSlot,
                  },
                  to: {
                    nodeId: normalizedEndpoints.to.nodeId,
                    portSlot: normalizedEndpoints.to.portSlot,
                  },
                  manualCorners: state.drag.tempCorners.map((point) => ({ ...point })),
                },
              ],
            },
            state.registry,
          );
        } catch {
          return createEmptyRoute();
        }
      }
    }

    try {
      const fromAnchor = getPortAnchor(
        state.snapshot.nodes.find((entry) => entry.id === state.drag.from.nodeId),
        state.drag.from.direction,
        state.drag.from.portSlot,
        state.snapshot,
        state.registry,
        EDGE_CREATE_PREVIEW_EDGE_ID,
      );
      const previewRoutingConfig = resolveRoutingConfig();

      return buildObstacleAwarePreviewRoute({
        snapshot: state.snapshot,
        registry: state.registry,
        fromAnchor,
        toPoint: state.drag.cursor,
        bendPreference: previewRoutingConfig.bendPreference,
        tempCorners: state.drag.tempCorners,
        stubLength: previewRoutingConfig.stubLength,
      });
    } catch {
      return null;
    }
  }

  function getViewportCursor() {
    return state.pan
      ? "grabbing"
      : state.boxSelection
        ? "crosshair"
        : state.drag.kind === "node"
          ? "grabbing"
          : state.drag.kind === "corner"
            ? "move"
            : state.drag.kind === "edge-create"
              ? "crosshair"
              : state.hover.kind === "port"
                ? "crosshair"
                : state.hover.kind === "node"
                  ? "grab"
                  : state.hover.kind === "edge"
                    ? "pointer"
                    : state.hover.kind === "corner"
                      ? "move"
                      : "default";
  }

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleViewportClick,
    handleContextMenu,
    handleWheel,
    buildPreviewRouteForRender,
    getViewportCursor,
  };
}
