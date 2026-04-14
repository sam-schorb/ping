import { getPortAnchor, resolveManualCornerDrag, resolveRoutingConfig, routeEdge } from "@ping/core";

import {
  applyPinchGesture,
  applyScreenDeltaPan,
  applyWheelPan,
  applyWheelZoom,
  getWorldCursorFromPointer,
} from "../render/panzoom.js";
import { hitCorner, hitEdge, hitPort } from "./hittest.js";
import {
  buildObstacleAwarePreviewRoute,
  createEmptyRoute,
  findEdgeCornerInsertTarget,
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
  function samePoint(a, b) {
    return a?.x === b?.x && a?.y === b?.y;
  }

  function clearTransientStates({ preserveViewportClick = false } = {}) {
    state.drag = createEmptyDragState();
    state.pan = null;
    state.touchGesture = { kind: "none" };
    state.pointerPress = null;
    state.dragStarted = false;
    state.boxSelection = null;
    state.edgeCreatePointerActive = false;
    if (!preserveViewportClick) {
      state.suppressViewportClick = false;
    }
  }

  function isTargetInsideViewport(target) {
    return Boolean(state.viewport && target && state.viewport.contains(target));
  }

  function isTouchPointerEvent(event) {
    return event?.pointerType === "touch";
  }

  function isTouchContextMenuEvent(event) {
    return event?.pointerType === "touch" || state.lastPointerType === "touch";
  }

  function setTouchGesture(gesture) {
    state.touchGesture = gesture;
    state.pan = gesture.kind === "none" ? null : gesture;
  }

  function getPointerScreenPoint(event) {
    const rect = getViewportRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function toWorldDistanceFromScreenPx(distancePx) {
    return distancePx / Math.max(1e-6, state.config.grid.GRID_PX * state.camera.scale);
  }

  function getPointerDragThresholdPx(pointerType) {
    return pointerType === "touch"
      ? state.config.interaction.touchDragThresholdPx ?? state.config.interaction.dragThresholdPx
      : state.config.interaction.dragThresholdPx;
  }

  function getPortHitRadiusWorld(pointerType) {
    return toWorldDistanceFromScreenPx(
      pointerType === "touch"
        ? state.config.port.touchHoverRadiusPx ?? state.config.port.hoverRadiusPx
        : state.config.port.hoverRadiusPx,
    );
  }

  function getCornerHitRadiusWorld(pointerType) {
    return toWorldDistanceFromScreenPx(
      pointerType === "touch"
        ? state.config.edge.touchCornerHitRadiusPx ?? state.config.port.touchHoverRadiusPx ?? state.config.port.hoverRadiusPx
        : state.config.port.hoverRadiusPx,
    );
  }

  function getEdgeHitToleranceWorld(pointerType) {
    return toWorldDistanceFromScreenPx(
      pointerType === "touch"
        ? state.config.edge.touchHitTolerancePx ?? state.config.edge.hoverWidthPx
        : state.config.edge.hoverWidthPx,
    );
  }

  function rememberTouchPointer(event, screenPoint) {
    if (!isTouchPointerEvent(event)) {
      return;
    }

    state.touchPointers.set(event.pointerId, {
      pointerId: event.pointerId,
      screenPoint: { ...screenPoint },
    });
  }

  function updateTouchPointer(event, screenPoint) {
    if (!isTouchPointerEvent(event) || !state.touchPointers.has(event.pointerId)) {
      return;
    }

    state.touchPointers.set(event.pointerId, {
      pointerId: event.pointerId,
      screenPoint: { ...screenPoint },
    });
  }

  function forgetTouchPointer(pointerId) {
    state.touchPointers.delete(pointerId);
  }

  function capturePointer(event) {
    if (!state.viewport || !Number.isInteger(event?.pointerId)) {
      return;
    }

    try {
      state.viewport.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore capture failures from synthetic or unsupported environments.
    }
  }

  function releasePointer(pointerId) {
    if (!state.viewport || !Number.isInteger(pointerId)) {
      return;
    }

    try {
      if (!state.viewport.hasPointerCapture?.(pointerId)) {
        state.viewport.releasePointerCapture?.(pointerId);
        return;
      }

      state.viewport.releasePointerCapture(pointerId);
    } catch {
      // Ignore release failures from synthetic or unsupported environments.
    }
  }

  function getTrackedTouchGesturePoints(pointerIds = null) {
    const sourceIds = Array.isArray(pointerIds) ? pointerIds : Array.from(state.touchPointers.keys());

    return sourceIds
      .map((pointerId) => state.touchPointers.get(pointerId))
      .filter((entry) => entry && entry.screenPoint)
      .map((entry) => ({
        pointerId: entry.pointerId,
        screenPoint: entry.screenPoint,
      }));
  }

  function getTouchGestureMetrics(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }

    const [first, second] = points;

    return {
      midpoint: {
        x: (first.screenPoint.x + second.screenPoint.x) / 2,
        y: (first.screenPoint.y + second.screenPoint.y) / 2,
      },
      distance: Math.hypot(
        second.screenPoint.x - first.screenPoint.x,
        second.screenPoint.y - first.screenPoint.y,
      ),
    };
  }

  function cancelTouchSinglePointerInteractionForPinch() {
    if (state.drag.kind === "node") {
      clearNodePositionOverrides(state.drag.nodeIds);
      state.drag = createEmptyDragState();
    } else if (state.drag.kind === "corner") {
      state.drag = createEmptyDragState();
    } else if (state.drag.kind === "edge-create" && state.edgeCreatePointerActive) {
      state.edgeCreatePointerActive = false;
      state.drag = {
        ...state.drag,
        previewTargetPort: null,
      };
    }

    state.pointerPress = null;
    state.dragStarted = false;
    state.boxSelection = null;
  }

  function beginTouchPinch() {
    const points = getTrackedTouchGesturePoints().slice(0, 2);
    const metrics = getTouchGestureMetrics(points);

    if (!metrics) {
      return false;
    }

    cancelTouchSinglePointerInteractionForPinch();
    setTouchGesture({
      kind: "pinch",
      pointerIds: points.map((point) => point.pointerId),
      startCamera: { ...state.camera },
      startMidpoint: metrics.midpoint,
      startDistance: metrics.distance,
      currentMidpoint: metrics.midpoint,
      currentDistance: metrics.distance,
    });
    state.suppressViewportClick = true;
    markViewportDirty({ inlineParamLayer: true });
    return true;
  }

  function beginTouchPan(pointerId, screenPoint) {
    setTouchGesture({
      kind: "pan",
      pointerId,
      startCamera: { ...state.camera },
      startScreen: { ...screenPoint },
      currentScreen: { ...screenPoint },
      moved: false,
    });
    markViewportDirty({ inlineParamLayer: true });
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
      getPortHitRadiusWorld(event.pointerType),
    );
  }

  function getCornerHitFromPointerEvent(event) {
    const targetHit = getCornerHitFromTarget(event.target);

    if (targetHit || !isTouchPointerEvent(event) || !state.viewport) {
      return targetHit;
    }

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

    return hitCorner(
      state.snapshot,
      state.routes,
      worldPoint,
      getCornerHitRadiusWorld(event.pointerType),
    );
  }

  function getEdgeHitFromPointerEvent(event) {
    const targetHit = getEdgeHitFromTarget(event.target);

    if (targetHit || !isTouchPointerEvent(event) || !state.viewport) {
      return targetHit;
    }

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

    return hitEdge(
      state.snapshot,
      state.routes,
      state.registry,
      worldPoint,
      getEdgeHitToleranceWorld(event.pointerType),
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

  function startEdgeCreate(portHit, worldPoint, { suppressViewportClick = false } = {}) {
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
    if (suppressViewportClick) {
      state.suppressViewportClick = true;
    }
    emitSelection(createEmptySelection());
    closeMenu();
    markDirty();
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

  function undoEdgeCreateCorner() {
    if (state.drag.kind !== "edge-create" || state.drag.tempCorners.length === 0) {
      return false;
    }

    state.drag = {
      ...state.drag,
      tempCorners: state.drag.tempCorners.slice(0, -1),
    };
    markDirty();
    return true;
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
      pointerId: state.lastPointerPointerId,
      pointerType: state.lastPointerType,
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
      pointerId: state.lastPointerPointerId,
      pointerType: state.lastPointerType,
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

    let resolvedPoint = state.drag.resolvedPoint ?? state.drag.startPoint;

    if (!state.drag.resolvedPoint) {
      try {
        resolvedPoint = resolveManualCornerDrag({
          snapshot: state.snapshot,
          registry: state.registry,
          edgeId: state.drag.edgeId,
          cornerIndex: state.drag.cornerIndex,
          desiredPoint: state.drag.currentPoint ?? state.drag.startPoint,
        }).resolvedPoint;
      } catch {
        resolvedPoint = state.drag.startPoint;
      }
    }

    if (
      resolvedPoint.x !== state.drag.startPoint.x ||
      resolvedPoint.y !== state.drag.startPoint.y
    ) {
      emitUndo("move corner");
      emitGraphOps(
        [
          {
            type: "moveCorner",
            payload: {
              edgeId: state.drag.edgeId,
              index: state.drag.cornerIndex,
              point: resolvedPoint,
            },
          },
        ],
        "move corner",
      );
    }

    clearTransientStates();
    markDirty();
  }

  function tryInsertEdgeCorner(edgeId, worldPoint) {
    if (state.selection.kind !== "edge" || state.selection.edgeId !== edgeId) {
      return false;
    }

    const insertTarget = findEdgeCornerInsertTarget(
      state.snapshot,
      state.routes,
      state.registry,
      edgeId,
      worldPoint,
    );

    if (!insertTarget) {
      return false;
    }

    focusViewport();
    emitUndo("add corner");
    emitGraphOps(
      [
        {
          type: "addCorner",
          payload: {
            edgeId: insertTarget.edgeId,
            index: insertTarget.index,
            point: insertTarget.point,
          },
        },
      ],
      "add corner",
    );
    return true;
  }

  function cancelEdgeCreate({ preserveViewportClick = false } = {}) {
    if (state.drag.kind !== "edge-create") {
      return;
    }

    clearTransientStates({ preserveViewportClick });
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
    if (!state.viewport || !isTargetInsideViewport(event.target) || isInteractiveTarget(event.target)) {
      return;
    }

    focusViewport();
    state.suppressViewportClick = false;

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
    const screenPoint = getPointerScreenPoint(event);
    const touchPointer = isTouchPointerEvent(event);

    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;
    state.lastPointerPointerId = event.pointerId;
    state.lastPointerType = event.pointerType;
    const multiSelectModifier = event.shiftKey || event.metaKey || event.ctrlKey;
    rememberTouchPointer(event, screenPoint);
    capturePointer(event);

    if (touchPointer && state.touchPointers.size >= 2) {
      beginTouchPinch();
      return;
    }

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

        state.suppressViewportClick = true;

        if (
          portHit.nodeId === state.drag.from.nodeId &&
          portHit.portSlot === state.drag.from.portSlot &&
          portHit.direction === state.drag.from.direction
        ) {
          cancelEdgeCreate({ preserveViewportClick: true });
          return;
        }

        startEdgeCreate(portHit, worldPoint, { suppressViewportClick: true });
        return;
      }

      return;
    }

    if (event.button === 0 && (portHit?.direction === "out" || portHit?.direction === "in")) {
      startEdgeCreate(portHit, worldPoint, {
        suppressViewportClick: touchPointer,
      });
      return;
    }

    const cornerHit = getCornerHitFromPointerEvent(event);

    if (event.button === 0 && cornerHit) {
      clearNodeSetSelection();
      if (touchPointer) {
        state.suppressViewportClick = true;
      }
      emitSelection(cornerHit);
      beginCornerDrag(cornerHit.edgeId, cornerHit.cornerIndex, worldPoint, screenPoint);
      return;
    }

    const edgeHit = getEdgeHitFromPointerEvent(event);

    if (event.button === 0 && edgeHit) {
      clearNodeSetSelection();
      if (touchPointer) {
        state.suppressViewportClick = true;
      }
      emitSelection(edgeHit);
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (event.button === 0 && nodeHit) {
      if (!touchPointer && multiSelectModifier) {
        const toggled = toggleGroupSelection(getSeededGroupSelection(), nodeHit.nodeId);
        setNodeSetSelection(toggled.nodeIds, nodeHit.nodeId);
        state.suppressViewportClick = true;
        return;
      }

      if (touchPointer) {
        state.suppressViewportClick = true;
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
      if (touchPointer) {
        beginTouchPan(event.pointerId, screenPoint);
        return;
      }

      beginBoxSelection(worldPoint, multiSelectModifier ? "add" : "replace");
    }
  }

  function shouldThrottlePreview(now) {
    if (state.drag.kind === "none" && state.touchGesture.kind === "none" && !state.boxSelection) {
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
    const screenPoint = getPointerScreenPoint(event);
    const touchPointer = isTouchPointerEvent(event);
    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;
    state.lastPointerPointerId = event.pointerId;
    state.lastPointerType = event.pointerType;
    updateTouchPointer(event, screenPoint);

    if (state.touchGesture.kind === "pinch" && state.touchGesture.pointerIds.includes(event.pointerId)) {
      const points = getTrackedTouchGesturePoints(state.touchGesture.pointerIds);
      const metrics = getTouchGestureMetrics(points);

      if (metrics) {
        state.camera = applyPinchGesture(
          state.touchGesture.startCamera,
          {
            startMidpoint: state.touchGesture.startMidpoint,
            currentMidpoint: metrics.midpoint,
            startDistance: state.touchGesture.startDistance,
            currentDistance: metrics.distance,
          },
          state.viewport,
          state.config,
        );
        setTouchGesture({
          ...state.touchGesture,
          currentMidpoint: metrics.midpoint,
          currentDistance: metrics.distance,
        });
        markViewportDirty({ inlineParamLayer: true });
      }
      return;
    }

    if (state.touchGesture.kind === "pan" && state.touchGesture.pointerId === event.pointerId) {
      const distance = Math.hypot(
        screenPoint.x - state.touchGesture.startScreen.x,
        screenPoint.y - state.touchGesture.startScreen.y,
      );
      const moved =
        state.touchGesture.moved || distance >= getPointerDragThresholdPx(event.pointerType);

      setTouchGesture({
        ...state.touchGesture,
        currentScreen: screenPoint,
        moved,
      });

      if (moved) {
        state.camera = applyScreenDeltaPan(
          state.touchGesture.startCamera,
          {
            x: screenPoint.x - state.touchGesture.startScreen.x,
            y: screenPoint.y - state.touchGesture.startScreen.y,
          },
          state.viewport,
          state.config,
        );
        markViewportDirty({ inlineParamLayer: true });
      }
      return;
    }

    if (state.boxSelection) {
      state.boxSelection = {
        ...state.boxSelection,
        current: worldPoint,
      };
      markDirty();
      return;
    }

    if (state.pointerPress?.kind === "node" && state.pointerPress.pointerId === event.pointerId) {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= getPointerDragThresholdPx(state.pointerPress.pointerType)) {
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

    if (state.pointerPress?.kind === "corner" && state.pointerPress.pointerId === event.pointerId) {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= getPointerDragThresholdPx(state.pointerPress.pointerType)) {
        const initialRoute = state.routes?.edgeRoutes?.get(state.pointerPress.edgeId) ?? null;
        state.drag = {
          kind: "corner",
          edgeId: state.pointerPress.edgeId,
          cornerIndex: state.pointerPress.cornerIndex,
          startPoint: state.pointerPress.startPoint,
          currentPoint: state.pointerPress.startPoint,
          desiredPoint: state.pointerPress.startPoint,
          resolvedPoint: state.pointerPress.startPoint,
          resolvedRoute: initialRoute,
          resolveStatus: "exact",
        };
        state.dragStarted = true;
      }

      if (state.drag.kind === "corner") {
        const desiredPoint = snapWorldPoint(worldPoint, state.config);

        if (samePoint(state.drag.desiredPoint, desiredPoint)) {
          state.drag = {
            ...state.drag,
            currentPoint: worldPoint,
          };
          return;
        }

        let resolution;

        try {
          resolution = resolveManualCornerDrag({
            snapshot: state.snapshot,
            registry: state.registry,
            edgeId: state.drag.edgeId,
            cornerIndex: state.drag.cornerIndex,
            desiredPoint,
          });
        } catch {
          resolution = {
            status: "blocked",
            resolvedPoint: state.drag.resolvedPoint ?? state.drag.startPoint,
            route: state.drag.resolvedRoute ?? null,
          };
        }

        state.drag = {
          ...state.drag,
          currentPoint: worldPoint,
          desiredPoint,
          resolvedPoint: resolution.resolvedPoint,
          resolvedRoute: resolution.route,
          resolveStatus: resolution.status,
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

    if (touchPointer || !event.target?.closest?.(".ping-editor__viewport") || isInteractiveTarget(event.target)) {
      return;
    }

    updateHoverFromTarget(event.target);
  }

  function handlePointerUp(event) {
    const touchPointer = isTouchPointerEvent(event);

    if (touchPointer) {
      const wasPinchPointer =
        state.touchGesture.kind === "pinch" && state.touchGesture.pointerIds.includes(event.pointerId);
      const wasPanPointer =
        state.touchGesture.kind === "pan" && state.touchGesture.pointerId === event.pointerId;

      forgetTouchPointer(event.pointerId);
      releasePointer(event.pointerId);

      if (wasPinchPointer) {
        setTouchGesture({ kind: "none" });
        state.suppressViewportClick = true;
        markViewportDirty({ inlineParamLayer: true });
        return;
      }

      if (wasPanPointer) {
        const moved = state.touchGesture.moved;
        setTouchGesture({ kind: "none" });
        if (moved) {
          state.suppressViewportClick = true;
        }
        markViewportDirty({ inlineParamLayer: true });
        return;
      }
    }

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
      clearTransientStates({ preserveViewportClick: state.suppressViewportClick });
      return;
    }

    if (state.pointerPress?.kind === "corner" && !state.dragStarted) {
      emitSelection({
        kind: "corner",
        edgeId: state.pointerPress.edgeId,
        cornerIndex: state.pointerPress.cornerIndex,
      });
      clearTransientStates({ preserveViewportClick: state.suppressViewportClick });
      return;
    }

    clearTransientStates({ preserveViewportClick: state.suppressViewportClick });
  }

  function handlePointerCancel(event) {
    const touchPointer = isTouchPointerEvent(event);

    if (touchPointer) {
      forgetTouchPointer(event.pointerId);
    }
    releasePointer(event.pointerId);

    if (state.touchGesture.kind === "pinch" && state.touchGesture.pointerIds.includes(event.pointerId)) {
      setTouchGesture({ kind: "none" });
      markViewportDirty({ inlineParamLayer: true });
      return;
    }

    if (state.touchGesture.kind === "pan" && state.touchGesture.pointerId === event.pointerId) {
      setTouchGesture({ kind: "none" });
      markViewportDirty({ inlineParamLayer: true });
      return;
    }

    if (state.drag.kind === "node") {
      clearNodePositionOverrides(state.drag.nodeIds);
      clearTransientStates();
      markViewportDirty({ inlineParamLayer: true });
      return;
    }

    if (state.drag.kind === "corner") {
      clearTransientStates();
      markViewportDirty();
      return;
    }

    if (state.drag.kind === "edge-create" && state.edgeCreatePointerActive) {
      state.edgeCreatePointerActive = false;
      state.drag = {
        ...state.drag,
        previewTargetPort: null,
      };
      markViewportDirty();
      return;
    }

    if (state.pointerPress) {
      clearTransientStates();
      markViewportDirty();
    }
  }

  function handleViewportClick(event) {
    if (
      !state.viewport ||
      !isTargetInsideViewport(event.target) ||
      event.target.closest("[data-action], input, select, button, label")
    ) {
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

    if (portHit) {
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
      if (
        event.detail >= 2 &&
        state.drag.kind === "none" &&
        state.touchGesture.kind === "none"
      ) {
        const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

        if (tryInsertEdgeCorner(edgeHit.edgeId, worldPoint)) {
          state.skipNextEdgeDoubleClickId = edgeHit.edgeId;
          return;
        }
      }

      state.skipNextEdgeDoubleClickId = null;
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

  function handleDoubleClick(event) {
    if (!state.viewport || !isTargetInsideViewport(event.target) || isInteractiveTarget(event.target)) {
      return;
    }

    if (event.button !== 0 || state.drag.kind !== "none" || state.touchGesture.kind !== "none") {
      return;
    }

    const edgeHit = getEdgeHitFromTarget(event.target);

    if (!edgeHit) {
      return;
    }

    if (state.skipNextEdgeDoubleClickId === edgeHit.edgeId) {
      state.skipNextEdgeDoubleClickId = null;
      return;
    }

    if (state.selection.kind !== "edge" || state.selection.edgeId !== edgeHit.edgeId) {
      return;
    }

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

    if (tryInsertEdgeCorner(edgeHit.edgeId, worldPoint)) {
      event.preventDefault();
    }
  }

  function handleContextMenu(event) {
    if (!isTargetInsideViewport(event.target)) {
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (state.drag.kind === "edge-create") {
      event.preventDefault();
      cancelEdgeCreate();
      return;
    }

    if (isTouchContextMenuEvent(event)) {
      event.preventDefault();
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
    return state.touchGesture.kind !== "none" || state.pan
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
    handlePointerCancel,
    handleViewportClick,
    handleDoubleClick,
    handleContextMenu,
    handleWheel,
    cancelEdgeCreate,
    undoEdgeCreateCorner,
    buildPreviewRouteForRender,
    getViewportCursor,
  };
}
