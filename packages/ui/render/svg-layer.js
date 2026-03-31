import { isGroupBackedNodeType, routeEdge } from "@ping/core";

import { resolveIcon } from "../icons/library.js";
import { resolveNodeTheme } from "../theme/node-theme.js";
import {
  createEmptyRoute,
  doesRouteIntersectBounds,
  getNodeScreenBox,
  getNodeWorldBounds,
  getPointAtRouteProgress,
  getPortWorldPoint,
  getResolvedNodeDefinition,
  getResolvedPortLayout,
  resolveRenderableEdgeRoute,
  snapWorldPoint,
  worldToScreen,
} from "../editor/geometry.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getPortTypeLabel(direction, port) {
  if (direction === "out") {
    return "Pulse output";
  }

  return port.role === "control" ? "Control input" : "Pulse input";
}

function getPortTypeIndex(layout, direction, portSlot, port) {
  const ports = direction === "out" ? layout.outputs : layout.inputs;
  const matchingPorts = ports.filter((entry) =>
    direction === "out" ? true : entry.role === port.role,
  );

  if (matchingPorts.length <= 1) {
    return null;
  }

  const roleIndex = matchingPorts.findIndex((entry) => entry.index === port.index);
  return roleIndex >= 0 ? roleIndex + 1 : portSlot + 1;
}

function getGroupInternalNodeLabel(group, nodeId, registry) {
  const internalNode = group?.graph?.nodes?.find((entry) => entry.id === nodeId);

  if (!internalNode) {
    return nodeId;
  }

  const definition = registry.getNodeDefinition(internalNode.type);
  return internalNode.name || definition?.label || internalNode.type || nodeId;
}

function getGroupPortTargetLabel(group, mapping, kind, registry) {
  const nodeLabel = getGroupInternalNodeLabel(group, mapping.nodeId, registry);

  if (kind === "controls") {
    const internalNode = group?.graph?.nodes?.find((entry) => entry.id === mapping.nodeId);
    const definition = internalNode ? registry.getNodeDefinition(internalNode.type) : null;

    if (
      mapping.controlSlot !== undefined &&
      definition?.hasParam &&
      (definition.controlPorts ?? 0) === 1 &&
      mapping.controlSlot === 0
    ) {
      return `${nodeLabel} param`;
    }

    return `${nodeLabel} control ${(mapping.controlSlot ?? 0) + 1}`;
  }

  return `${nodeLabel} ${kind === "inputs" ? "input" : "output"} ${mapping.portSlot + 1}`;
}

function getGroupPortTooltip(snapshot, node, registry, label, direction, portSlot, port) {
  if (!isGroupBackedNodeType(node.type) || typeof node.groupRef !== "string") {
    return null;
  }

  const group = snapshot.groups?.[node.groupRef];

  if (!group) {
    return null;
  }

  let kind = "inputs";
  let mapping = null;

  if (direction === "out") {
    kind = "outputs";
    mapping = group.outputs?.[portSlot] ?? null;
  } else if (port.role === "control") {
    kind = "controls";
    mapping = group.controls?.[portSlot - (group.inputs?.length ?? 0)] ?? null;
  } else {
    mapping = group.inputs?.[portSlot] ?? null;
  }

  if (!mapping) {
    return null;
  }

  const targetLabel = getGroupPortTargetLabel(group, mapping, kind, registry);
  const mappingLabel =
    typeof mapping.label === "string" && mapping.label.trim() !== ""
      ? mapping.label.trim()
      : "";
  const detail =
    mappingLabel && mappingLabel !== targetLabel
      ? `${mappingLabel} (${targetLabel})`
      : targetLabel;

  return `${label}: ${detail}`;
}

function getPortTooltip(snapshot, node, registry, label, layout, direction, portSlot, port) {
  const groupTooltip = getGroupPortTooltip(snapshot, node, registry, label, direction, portSlot, port);

  if (groupTooltip) {
    return groupTooltip;
  }

  const portTypeLabel = getPortTypeLabel(direction, port);
  const portTypeIndex = getPortTypeIndex(layout, direction, portSlot, port);
  const portLabel =
    portTypeIndex === null ? portTypeLabel : `${portTypeLabel} ${portTypeIndex}`;

  return `${label}: ${portLabel}`;
}

function getPortColor(config, direction, port) {
  if (direction === "out") {
    return config.port.signalOut;
  }

  return port.role === "control" ? config.port.control : config.port.signalIn;
}

function getNodeTooltipText(node, definition, label) {
  if (isGroupBackedNodeType(node.type)) {
    return label;
  }

  return definition.description || label || node.type;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const NODE_PULSE_SCALE_DELTA = 0.04;
const NODE_PULSE_REFERENCE_WORLD_SIZE = 3;

function getNodePulseScale(progress, cameraScale, screenBox, config) {
  const zoomScale = Number.isFinite(cameraScale) && cameraScale > 0 ? cameraScale : 1;
  const pulseDelta = clampValue(NODE_PULSE_SCALE_DELTA * zoomScale ** -0.18, 0.03, 0.05);
  const baseScale = 1 + pulseDelta * Math.sin(Math.PI * clampValue(progress, 0, 1));

  if (!screenBox || !config?.grid?.GRID_PX) {
    return baseScale;
  }

  const maxDimensionPx = Math.max(
    Number.isFinite(screenBox.width) ? screenBox.width : 0,
    Number.isFinite(screenBox.height) ? screenBox.height : 0,
  );
  const referenceDimensionPx =
    NODE_PULSE_REFERENCE_WORLD_SIZE * config.grid.GRID_PX * zoomScale;

  if (
    !Number.isFinite(maxDimensionPx) ||
    maxDimensionPx <= 0 ||
    !Number.isFinite(referenceDimensionPx) ||
    referenceDimensionPx <= 0 ||
    maxDimensionPx <= referenceDimensionPx
  ) {
    return baseScale;
  }

  const extraScale = baseScale - 1;
  return 1 + extraScale * (referenceDimensionPx / maxDimensionPx);
}

function createScaleTransform(centerX, centerY, scale) {
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-6) {
    return "";
  }

  return `translate(${centerX} ${centerY}) scale(${scale}) translate(${-centerX} ${-centerY})`;
}

function scaleVisual(base, cameraScale, { power = 0.35, min = base * 0.75, max = base * 1.6 } = {}) {
  return clampValue(base * cameraScale ** power, min, max);
}

function createZoomMetrics(camera, config) {
  const scale = camera?.scale > 0 ? camera.scale : 1;
  const nodeStrokePx = scaleVisual(1.05, scale, {
    power: 0.18,
    min: 0.85,
    max: 1.35,
  });

  return {
    edgeStrokePx: scaleVisual(config.edge.strokeWidthPx, scale, {
      power: 0.38,
      min: 1.5,
      max: 4,
    }),
    edgeOutlineStrokePx: scaleVisual(config.edge.strokeWidthPx + 1, scale, {
      power: 0.34,
      min: 2.4,
      max: 5,
    }),
    portRadiusPx: scaleVisual(config.port.radiusPx, scale, {
      power: 0.42,
      min: 3,
      max: 7,
    }),
    portStrokeWidthPx: scaleVisual(config.port.strokeWidthPx, scale, {
      power: 0.22,
      min: 1,
      max: 1.8,
    }),
    cornerHandleRadiusPx: scaleVisual(config.port.radiusPx + 1, scale, {
      power: 0.42,
      min: 4,
      max: 8,
    }),
    nodeStrokePx,
    nodeSelectionStrokePx: nodeStrokePx * 3,
    nodeCornerRadiusPx: scaleVisual(config.node.cornerRadiusPx, scale, {
      power: 0.4,
      min: 4,
      max: 10,
    }),
    nodePaddingPx: scaleVisual(config.node.paddingPx, scale, {
      power: 0.28,
      min: 4,
      max: 10,
    }),
    iconSizePx: scaleVisual(config.node.iconSizePx, scale, {
      power: 0.38,
      min: 12,
      max: 24,
    }),
    iconStrokeWidthPx: scaleVisual(1.5, scale, {
      power: 0.22,
      min: 1.2,
      max: 2.1,
    }),
    labelFontPx: scaleVisual(config.text.fontSizePx, scale, {
      power: 0.28,
      min: 10,
      max: 16,
    }),
    labelOffsetPx: scaleVisual(config.node.labelOffsetYPx, scale, {
      power: 0.26,
      min: 12,
      max: 18,
    }),
    thumbRadiusPx: scaleVisual(config.thumb.radiusPx, scale, {
      power: 0.42,
      min: 3,
      max: 7,
    }),
    selectionStrokePx: scaleVisual(config.selection.strokeWidthPx, scale, {
      power: 0.24,
      min: 1.5,
      max: 3.5,
    }),
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

function createGridMarkup(viewportSize, camera, config) {
  const step = config.grid.GRID_PX * camera.scale;

  if (!(step > 0)) {
    return "";
  }

  const offsetX = ((camera.x % step) + step) % step;
  const offsetY = ((camera.y % step) + step) % step;
  const dotRadius = Math.max(1.35, config.canvas.gridLineWidthPx * 1.35);
  const patternX = offsetX - step / 2;
  const patternY = offsetY - step / 2;
  const patternId = `ping-editor-grid-${Math.round(step * 1000)}-${Math.round(offsetX * 1000)}-${Math.round(offsetY * 1000)}`;

  return `
    <g class="ping-editor__grid">
      <defs>
        <pattern
          id="${patternId}"
          patternUnits="userSpaceOnUse"
          x="${patternX}"
          y="${patternY}"
          width="${step}"
          height="${step}"
        >
          <circle
            cx="${step / 2}"
            cy="${step / 2}"
            r="${dotRadius}"
            fill="${config.canvas.gridLine}"
          />
        </pattern>
      </defs>
      <rect x="0" y="0" width="${viewportSize.width}" height="${viewportSize.height}" fill="${config.canvas.background}" />
      <rect
        x="0"
        y="0"
        width="${viewportSize.width}"
        height="${viewportSize.height}"
        fill="url(#${patternId})"
      />
    </g>
  `;
}

function getEdgeRoute(snapshot, edge, routes, registry) {
  return resolveRenderableEdgeRoute(edge, snapshot, routes, registry);
}

function shouldShowNodeLabel(screenBox, config, zoomMetrics) {
  const minLabelWidth = Math.max(
    config.node.minSizePx + zoomMetrics.nodePaddingPx,
    zoomMetrics.iconSizePx + zoomMetrics.labelFontPx * 2.25,
  );
  const minLabelHeight = Math.max(
    config.node.minSizePx + zoomMetrics.nodePaddingPx,
    zoomMetrics.iconSizePx + zoomMetrics.nodePaddingPx * 2 + zoomMetrics.labelFontPx * 1.2,
  );

  return screenBox.width >= minLabelWidth && screenBox.height >= minLabelHeight;
}

function getNodeIconLayout(screenBox, config, zoomMetrics, labelVisible) {
  const maxPadding = Math.min(
    zoomMetrics.nodePaddingPx,
    screenBox.width * 0.2,
    screenBox.height * 0.2,
  );
  const padding = Math.max(2, maxPadding);

  if (!labelVisible) {
    const size = Math.max(0, Math.min(screenBox.width, screenBox.height) - padding * 2);

    return {
      x: screenBox.x + (screenBox.width - size) / 2,
      y: screenBox.y + (screenBox.height - size) / 2,
      size,
    };
  }

  const reservedLabelHeight = Math.max(zoomMetrics.labelOffsetPx, zoomMetrics.labelFontPx * 1.3) + padding;
  const size = Math.max(
    0,
    Math.min(
      zoomMetrics.iconSizePx,
      screenBox.width - padding * 2,
      screenBox.height - reservedLabelHeight - padding,
    ),
  );

  return {
    x: screenBox.x + padding + config.node.iconOffsetXPx,
    y: screenBox.y + padding + config.node.iconOffsetYPx,
    size,
  };
}

function createPreviewSnapshot(snapshot, previewState) {
  if (
    previewState?.drag?.kind !== "node" &&
    !(previewState?.nodePositionOverrides?.size > 0)
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    nodes: snapshot.nodes.map((node) => getRenderableNode(node, previewState)),
  };
}

function collectPreviewNodeIds(previewState) {
  const previewNodeIds = new Set();

  if (previewState?.drag?.kind === "node") {
    for (const nodeId of previewState.drag.nodeIds ?? []) {
      previewNodeIds.add(nodeId);
    }
  }

  for (const nodeId of previewState?.nodePositionOverrides?.keys?.() ?? []) {
    previewNodeIds.add(nodeId);
  }

  return previewNodeIds;
}

function createDisplayEdgeRoutes(routes, previewEdgeRoutes) {
  if (!(previewEdgeRoutes instanceof Map) || previewEdgeRoutes.size === 0) {
    return routes;
  }

  return {
    ...routes,
    edgeRoutes: new Map([
      ...(routes?.edgeRoutes?.entries?.() ?? []),
      ...previewEdgeRoutes.entries(),
    ]),
  };
}

export function createHiddenThumbEdgeIds(snapshot, previewState, previewEdgeRoutes = null) {
  if (previewEdgeRoutes instanceof Map) {
    return new Set(previewEdgeRoutes.keys());
  }

  const previewNodeIds = collectPreviewNodeIds(previewState);

  if (previewNodeIds.size === 0) {
    return new Set();
  }

  return new Set(
    snapshot.edges
      .filter(
        (edge) =>
          previewNodeIds.has(edge.from.nodeId) || previewNodeIds.has(edge.to.nodeId),
      )
      .map((edge) => edge.id),
  );
}

function createPreviewBoundsByNodeId(snapshot, previewSnapshot, registry, previewNodeIds) {
  const previewBoundsByNodeId = new Map();

  for (const nodeId of previewNodeIds) {
    const beforeNode = snapshot.nodes.find((node) => node.id === nodeId);
    const afterNode = previewSnapshot.nodes.find((node) => node.id === nodeId);

    if (!beforeNode || !afterNode) {
      continue;
    }

    previewBoundsByNodeId.set(nodeId, {
      before: getNodeWorldBounds(snapshot, beforeNode, registry),
      after: getNodeWorldBounds(previewSnapshot, afterNode, registry),
    });
  }

  return previewBoundsByNodeId;
}

function edgeNeedsPreviewRoute(edge, committedRoute, previewNodeIds, previewBoundsByNodeId, routeErrors) {
  if (previewNodeIds.has(edge.from.nodeId) || previewNodeIds.has(edge.to.nodeId)) {
    return true;
  }

  if (routeErrors.has(edge.id)) {
    return true;
  }

  if (!committedRoute?.points?.length) {
    return false;
  }

  for (const bounds of previewBoundsByNodeId.values()) {
    if (
      doesRouteIntersectBounds(committedRoute, bounds.before) ||
      doesRouteIntersectBounds(committedRoute, bounds.after)
    ) {
      return true;
    }
  }

  return false;
}

export function createPreviewEdgeRoutes(snapshot, previewSnapshot, routes, registry, previewState, config) {
  const previewNodeIds = collectPreviewNodeIds(previewState);

  if (previewNodeIds.size === 0) {
    return new Map();
  }

  const previewBoundsByNodeId = createPreviewBoundsByNodeId(
    snapshot,
    previewSnapshot,
    registry,
    previewNodeIds,
  );
  const routeErrors = new Set(
    (routes?.errors ?? [])
      .map((issue) => issue.edgeId)
      .filter((edgeId) => edgeId),
  );
  const previewRoutingSnapshot = {
    ...previewSnapshot,
    nodes: previewSnapshot.nodes.map((node) =>
      previewNodeIds.has(node.id)
        ? {
            ...node,
            pos: snapWorldPoint(node.pos, config),
          }
        : node,
    ),
  };
  const previewEdgeRoutes = new Map();

  for (const edge of snapshot.edges) {
    const committedRoute = getEdgeRoute(snapshot, edge, routes, registry);

    if (
      !edgeNeedsPreviewRoute(
        edge,
        committedRoute,
        previewNodeIds,
        previewBoundsByNodeId,
        routeErrors,
      )
    ) {
      continue;
    }

    try {
      previewEdgeRoutes.set(edge.id, routeEdge(edge.id, previewRoutingSnapshot, registry));
    } catch {
      previewEdgeRoutes.set(edge.id, createEmptyRoute());
    }
  }

  return previewEdgeRoutes;
}

export function createPreviewRenderState(snapshot, routes, registry, previewState, config) {
  const previewSnapshot = createPreviewSnapshot(snapshot, previewState);
  const previewNodeIds = collectPreviewNodeIds(previewState);
  const previewEdgeRoutes = createPreviewEdgeRoutes(
    snapshot,
    previewSnapshot,
    routes,
    registry,
    previewState,
    config,
  );

  return {
    previewSnapshot,
    previewNodeIds,
    previewEdgeRoutes,
    displayRoutes: createDisplayEdgeRoutes(routes, previewEdgeRoutes),
    hiddenThumbEdgeIds: createHiddenThumbEdgeIds(
      snapshot,
      previewState,
      previewEdgeRoutes,
    ),
  };
}

function renderEdge(edge, route, routes, camera, config, hover, selection, zoomMetrics) {
  const selectionHighlightColor = config.selection.highlightColor ?? config.selection.color;
  const screenPoints = route.points.map((point) => worldToScreen(point, camera, config));
  const path = screenPoints.length
    ? `M ${screenPoints[0].x} ${screenPoints[0].y}${screenPoints
        .slice(1)
        .map((point) => ` L ${point.x} ${point.y}`)
        .join("")}`
    : "";
  const isSelected = selection.kind === "edge" && selection.edgeId === edge.id;
  const isHovered = hover.kind === "edge" && hover.edgeId === edge.id;
  const missing = !routes?.edgeRoutes?.has(edge.id);

  return `
    <g class="ping-editor__edge-group" data-testid="edge-${escapeHtml(edge.id)}">
      <path
        class="ping-editor__edge-hit"
        d="${path}"
        stroke="transparent"
        stroke-width="${config.edge.hoverWidthPx}"
        fill="none"
        data-edge-id="${escapeHtml(edge.id)}"
      />
      <path
        class="ping-editor__edge-outline"
        d="${path}"
        stroke="${config.node.stroke}"
        stroke-width="${zoomMetrics.edgeOutlineStrokePx}"
        stroke-dasharray="${missing ? config.edge.previewDash : ""}"
        opacity="${missing ? config.edge.mutedOpacity : 1}"
        fill="none"
        pointer-events="none"
      />
      <path
        class="ping-editor__edge-path ${isSelected ? "is-selected" : ""} ${isHovered ? "is-hovered" : ""}"
        d="${path}"
        stroke="${config.edge.stroke}"
        stroke-width="${zoomMetrics.edgeStrokePx}"
        stroke-dasharray="${missing ? config.edge.previewDash : ""}"
        opacity="${missing ? config.edge.mutedOpacity : 1}"
        fill="none"
        data-edge-id="${escapeHtml(edge.id)}"
      />
      ${(edge.manualCorners ?? [])
        .map((corner, cornerIndex) => {
          const screenPoint = worldToScreen(corner, camera, config);
          const selectedCorner =
            selection.kind === "corner" &&
            selection.edgeId === edge.id &&
            selection.cornerIndex === cornerIndex;
          return `
            <circle
              class="ping-editor__corner ${selectedCorner ? "is-selected" : ""}"
              cx="${screenPoint.x}"
              cy="${screenPoint.y}"
              r="${zoomMetrics.cornerHandleRadiusPx}"
              fill="${selectionHighlightColor}"
              data-corner-edge-id="${escapeHtml(edge.id)}"
              data-corner-index="${cornerIndex}"
              data-testid="corner-${escapeHtml(edge.id)}-${cornerIndex}"
            />
          `;
        })
        .join("")}
    </g>
  `;
}

function getRenderableNode(node, previewState) {
  const overridePos = previewState?.nodePositionOverrides?.get(node.id);

  if (overridePos) {
    return {
      ...node,
      pos: overridePos,
    };
  }

  if (
    previewState?.drag?.kind === "node" &&
    previewState.drag.currentPositions?.[node.id]
  ) {
    return {
      ...node,
      pos: previewState.drag.currentPositions[node.id],
    };
  }

  return node;
}

function renderNode(
  snapshot,
  node,
  registry,
  camera,
  config,
  zoomMetrics,
  selection,
  hover,
  groupSelection,
  previewState,
  nodePulseState,
) {
  const renderNodeModel = getRenderableNode(node, previewState);
  const definition = getResolvedNodeDefinition(snapshot, renderNodeModel, registry);
  const layout = getResolvedPortLayout(snapshot, renderNodeModel, registry);
  const icon = resolveIcon(definition.icon, config.icons);
  const nodeTheme = resolveNodeTheme({
    category: definition.category,
    color: definition.color,
    config,
  });
  const screenBox = getNodeScreenBox(snapshot, renderNodeModel, registry, camera, config);
  const worldBounds = getNodeWorldBounds(snapshot, renderNodeModel, registry);
  const selectionHighlightColor = config.selection.highlightColor ?? config.selection.color;
  const isSelected = selection.kind === "node" && selection.nodeId === node.id;
  const isGroupSelected = groupSelection.nodeIds.includes(node.id);
  const isHovered = hover.kind === "node" && hover.nodeId === node.id;
  const rawLabel = node.name || definition.label || node.type;
  const rawCanvasLabel = node.name || definition.canvasLabel || rawLabel;
  const canvasLabel = escapeHtml(rawCanvasLabel);
  const labelVisible = shouldShowNodeLabel(screenBox, config, zoomMetrics);
  const iconLayout = getNodeIconLayout(screenBox, config, zoomMetrics, labelVisible);
  const nodeCornerRadiusPx = Math.min(
    zoomMetrics.nodeCornerRadiusPx,
    screenBox.width * 0.22,
    screenBox.height * 0.22,
  );
  const showSelectionRing = isSelected || isGroupSelected;
  const pulseProgress = nodePulseState ? clampValue(nodePulseState.progress, 0, 1) : null;
  const pulseScale =
    pulseProgress === null
      ? 1
      : getNodePulseScale(pulseProgress, camera?.scale, screenBox, config);
  const bodyTransform = createScaleTransform(
    screenBox.x + screenBox.width / 2,
    screenBox.y + screenBox.height / 2,
    pulseScale,
  );
  const selectionRingPath = createRoundedRectPath(
    screenBox.x,
    screenBox.y,
    screenBox.width,
    screenBox.height,
    nodeCornerRadiusPx,
  );
  const ports = [];

  for (let portSlot = 0; portSlot < layout.inputs.length; portSlot += 1) {
    const port = layout.inputs[portSlot];
    const anchor = getPortWorldPoint(snapshot, renderNodeModel, registry, "in", portSlot);
    const screenPoint = worldToScreen(anchor, camera, config);
    const isHoveredPort =
      hover.kind === "port" &&
      hover.nodeId === node.id &&
      hover.portSlot === portSlot &&
      hover.direction === "in";
    const portTooltip = getPortTooltip(
      snapshot,
      renderNodeModel,
      registry,
      rawLabel,
      layout,
      "in",
      portSlot,
      port,
    );
    ports.push(`
      <circle
        class="ping-editor__port ${isHoveredPort ? "is-hovered" : ""}"
        cx="${screenPoint.x}"
        cy="${screenPoint.y}"
        r="${zoomMetrics.portRadiusPx}"
        fill="${getPortColor(config, "in", port)}"
        stroke="${config.node.stroke}"
        stroke-width="${zoomMetrics.portStrokeWidthPx}"
        data-port-node-id="${escapeHtml(node.id)}"
        data-port-slot="${portSlot}"
        data-port-direction="in"
        data-testid="port-${escapeHtml(node.id)}-in-${portSlot}"
        aria-label="${escapeHtml(portTooltip)}"
      >
        <title>${escapeHtml(portTooltip)}</title>
      </circle>
    `);
  }

  for (let portSlot = 0; portSlot < layout.outputs.length; portSlot += 1) {
    const port = layout.outputs[portSlot];
    const anchor = getPortWorldPoint(snapshot, renderNodeModel, registry, "out", portSlot);
    const screenPoint = worldToScreen(anchor, camera, config);
    const isHoveredPort =
      hover.kind === "port" &&
      hover.nodeId === node.id &&
      hover.portSlot === portSlot &&
      hover.direction === "out";
    const portTooltip = getPortTooltip(
      snapshot,
      renderNodeModel,
      registry,
      rawLabel,
      layout,
      "out",
      portSlot,
      port,
    );
    ports.push(`
      <circle
        class="ping-editor__port ${isHoveredPort ? "is-hovered" : ""}"
        cx="${screenPoint.x}"
        cy="${screenPoint.y}"
        r="${zoomMetrics.portRadiusPx}"
        fill="${getPortColor(config, "out", port)}"
        stroke="${config.node.stroke}"
        stroke-width="${zoomMetrics.portStrokeWidthPx}"
        data-port-node-id="${escapeHtml(node.id)}"
        data-port-slot="${portSlot}"
        data-port-direction="out"
        data-testid="port-${escapeHtml(node.id)}-out-${portSlot}"
        aria-label="${escapeHtml(portTooltip)}"
      >
        <title>${escapeHtml(portTooltip)}</title>
      </circle>
    `);
  }

  return `
    <g
      class="ping-editor__node-group"
      data-node-id="${escapeHtml(node.id)}"
      data-testid="node-${escapeHtml(node.id)}"
      aria-label="${escapeHtml(rawLabel)}"
    >
      <g
        class="ping-editor__node-body-group ${pulseProgress === null ? "" : "is-pulsing"}"
        ${bodyTransform ? `transform="${bodyTransform}"` : ""}
        ${pulseProgress === null ? "" : `data-pulse-progress="${pulseProgress.toFixed(3)}"`}
        ${pulseProgress === null ? "" : `data-pulse-scale="${pulseScale.toFixed(4)}"`}
      >
        ${
          showSelectionRing
            ? `
              <path
                class="ping-editor__node-selection-ring ${isSelected ? "is-selected" : ""} ${isGroupSelected ? "is-group-selected" : ""}"
                d="${selectionRingPath}"
                fill="none"
                stroke="${selectionHighlightColor}"
                stroke-width="${zoomMetrics.nodeSelectionStrokePx}"
                pointer-events="none"
                data-node-id="${escapeHtml(node.id)}"
                data-testid="node-selection-ring-${escapeHtml(node.id)}"
              />
            `
            : ""
        }
        <rect
          class="ping-editor__node ${isHovered ? "is-hovered" : ""}"
          x="${screenBox.x}"
          y="${screenBox.y}"
          width="${screenBox.width}"
          height="${screenBox.height}"
          rx="${nodeCornerRadiusPx}"
          fill="${nodeTheme.fill}"
          stroke="${showSelectionRing ? "none" : config.node.stroke}"
          stroke-width="${showSelectionRing ? 0 : zoomMetrics.nodeStrokePx}"
          data-node-id="${escapeHtml(node.id)}"
        />
        <svg
          x="${iconLayout.x}"
          y="${iconLayout.y}"
          width="${iconLayout.size}"
          height="${iconLayout.size}"
          viewBox="${icon.viewBox}"
          class="ping-editor__node-icon"
          pointer-events="none"
        >
          <path d="${icon.path}" fill="none" stroke="${nodeTheme.icon}" stroke-width="${zoomMetrics.iconStrokeWidthPx}" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        ${
          labelVisible
            ? `
              <text
                class="ping-editor__node-label"
                x="${screenBox.x + zoomMetrics.nodePaddingPx}"
                y="${screenBox.y + screenBox.height - zoomMetrics.nodePaddingPx}"
                fill="${config.node.text}"
                font-size="${zoomMetrics.labelFontPx}"
              >
                ${canvasLabel}
              </text>
            `
            : ""
        }
      </g>
      ${ports.join("")}
      <title>${escapeHtml(getNodeTooltipText(renderNodeModel, definition, rawLabel))}</title>
      <desc>${escapeHtml(`World ${worldBounds.x},${worldBounds.y}`)}</desc>
    </g>
  `;
}

function renderThumbs(
  routes,
  camera,
  config,
  thumbs,
  hiddenEdgeIds = new Set(),
  zoomMetrics = createZoomMetrics(camera, config),
) {
  return thumbs
    .map((thumb, index) => {
      if (hiddenEdgeIds.has(thumb.edgeId)) {
        return "";
      }

      const route = routes?.edgeRoutes?.get(thumb.edgeId);
      const point = route ? getPointAtRouteProgress(route, thumb.progress) : null;

      if (!point) {
        return "";
      }

      const screenPoint = worldToScreen(point, camera, config);

      return `
        <circle
          class="ping-editor__thumb"
          cx="${screenPoint.x}"
          cy="${screenPoint.y}"
          r="${zoomMetrics.thumbRadiusPx}"
          fill="${config.thumb.color}"
          opacity="${config.thumb.opacity}"
          pointer-events="none"
          data-testid="thumb-${index}"
        />
      `;
    })
    .join("");
}

export function renderThumbLayerMarkup({ routes, camera, config, thumbs, hiddenEdgeIds }) {
  const zoomMetrics = createZoomMetrics(camera, config);
  return renderThumbs(routes, camera, config, thumbs, hiddenEdgeIds, zoomMetrics);
}

function renderPreviewEdge(preview, camera, config, zoomMetrics) {
  if (!preview) {
    return "";
  }

  const points = preview.points.map((point) => worldToScreen(point, camera, config));
  const path = points.length
    ? `M ${points[0].x} ${points[0].y}${points.slice(1).map((point) => ` L ${point.x} ${point.y}`).join("")}`
    : "";

  return `
    <path
      class="ping-editor__edge-preview"
      d="${path}"
      stroke="${config.edge.previewStroke}"
      stroke-width="${zoomMetrics.edgeStrokePx}"
      stroke-dasharray="${config.edge.previewDash}"
      fill="none"
      data-testid="edge-preview"
    />
  `;
}

function renderSelectionBox(boxSelection, camera, config) {
  if (!boxSelection) {
    return "";
  }

  const selectionHighlightColor = config.selection.highlightColor ?? config.selection.color;

  const start = worldToScreen(boxSelection.start, camera, config);
  const end = worldToScreen(boxSelection.current, camera, config);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return `
    <rect
      class="ping-editor__selection-box"
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      fill="rgba(31, 106, 122, 0.08)"
      stroke="${selectionHighlightColor}"
      stroke-dasharray="${config.selection.dash}"
    />
  `;
}

export function renderSvgMarkup({
  snapshot,
  routes,
  registry,
  config,
  camera,
  viewportSize,
  selection,
  hover,
  groupSelection,
  drag,
  nodePositionOverrides,
  thumbs,
  nodePulseStates,
  previewRoute,
  boxSelection,
  previewRenderState = null,
}) {
  const previewState = { drag, nodePositionOverrides };
  const effectivePreviewRenderState =
    previewRenderState ??
    createPreviewRenderState(snapshot, routes, registry, previewState, config);
  const {
    previewNodeIds,
    previewEdgeRoutes,
    hiddenThumbEdgeIds,
    displayRoutes,
  } = effectivePreviewRenderState;
  const zoomMetrics = createZoomMetrics(camera, config);
  const nodePulseStateByNodeId = new Map(
    (nodePulseStates ?? []).map((entry) => [entry.nodeId, entry]),
  );

  const nodeEntries =
    previewNodeIds.size > 0
      ? [
          ...snapshot.nodes.filter((node) => !previewNodeIds.has(node.id)),
          ...snapshot.nodes.filter((node) => previewNodeIds.has(node.id)),
        ]
      : snapshot.nodes;

  return `
    <svg
      class="ping-editor__svg"
      width="${viewportSize.width}"
      height="${viewportSize.height}"
      viewBox="0 0 ${viewportSize.width} ${viewportSize.height}"
      style="--ping-selection-stroke-width: ${zoomMetrics.selectionStrokePx}px;"
      data-testid="editor-svg"
    >
      ${createGridMarkup(viewportSize, camera, config)}
      <g class="ping-editor__edge-layer">
        ${snapshot.edges
          .map((edge) => {
            const route = previewEdgeRoutes.get(edge.id) ?? getEdgeRoute(snapshot, edge, routes, registry);

            return renderEdge(
              edge,
              route,
              routes,
              camera,
              config,
              hover,
              selection,
              zoomMetrics,
            );
          })
          .join("")}
      </g>
      <g class="ping-editor__node-layer">
        ${nodeEntries
          .map((node) =>
            renderNode(
              snapshot,
              node,
              registry,
              camera,
              config,
              zoomMetrics,
              selection,
              hover,
              groupSelection,
              previewState,
              nodePulseStateByNodeId.get(node.id),
            ),
          )
          .join("")}
      </g>
      <g class="ping-editor__selection-layer">
        ${renderSelectionBox(boxSelection, camera, config)}
      </g>
      <g class="ping-editor__thumb-layer" pointer-events="none">
        ${renderThumbs(
          displayRoutes,
          camera,
          config,
          thumbs,
          hiddenThumbEdgeIds,
          zoomMetrics,
        )}
      </g>
      <g class="ping-editor__preview-layer">
        ${renderPreviewEdge(previewRoute, camera, config, zoomMetrics)}
      </g>
    </svg>
  `;
}
