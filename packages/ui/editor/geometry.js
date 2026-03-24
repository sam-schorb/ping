import {
  buildOrthogonalRoute,
  getNodeRoutingBounds,
  getPortSideSlot,
  isGroupBackedNodeType,
} from "@ping/core";

const ROTATIONS = [0, 90, 180, 270];

function clampDiscreteNodeValue(value, fallback = 1) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.min(8, Math.max(1, Math.round(numeric)));
}

function normalizeRotation(rot) {
  const value = Number.isFinite(rot) ? Math.round(rot) : 0;
  const normalized = ((value % 360) + 360) % 360;

  return ROTATIONS.includes(normalized) ? normalized : 0;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function getResolvedNodeDefinition(snapshot, node, registry) {
  const baseDefinition = registry.getNodeDefinition(node.type);

  if (baseDefinition) {
    if (!isGroupBackedNodeType(node.type)) {
      return baseDefinition;
    }

    const group = snapshot.groups?.[node.groupRef];
    const inputs = safeArray(group?.inputs).length;
    const outputs = safeArray(group?.outputs).length;
    const controlPorts = safeArray(group?.controls).length;
    const groupLabel = node.type === "group" ? group?.name : undefined;

    return {
      ...baseDefinition,
      label: node.name || groupLabel || baseDefinition.label,
      layout: "custom",
      inputs,
      outputs,
      controlPorts,
      hidden: false,
    };
  }

  return {
    type: node.type,
    label: node.name || node.type,
    description: "Unknown node type.",
    category: "Unknown",
    icon: "unknown",
    color: "#9b958a",
    layout: "single-io",
    inputs: 1,
    outputs: 1,
    controlPorts: 0,
    hasParam: false,
    defaultParam: 1,
    hidden: false,
  };
}

export function getResolvedPortLayout(snapshot, node, registry) {
  const definition = getResolvedNodeDefinition(snapshot, node, registry);

  try {
    return registry.getLayout(
      definition.layout,
      definition.inputs,
      definition.outputs,
      definition.controlPorts,
    );
  } catch {
    return {
      inputs: [],
      outputs: [],
    };
  }
}

export function countPortsBySide(layout) {
  const counts = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };

  for (const port of [...safeArray(layout.inputs), ...safeArray(layout.outputs)]) {
    if (counts[port.side] !== undefined) {
      counts[port.side] += 1;
    }
  }

  return counts;
}

export function getNodeSideLength(layout) {
  const counts = countPortsBySide(layout);
  return Math.max(1, counts.left, counts.right, counts.top, counts.bottom) + 1;
}

function getPortLocalPoint(layout, direction, portIndex) {
  const source = direction === "in" ? safeArray(layout.inputs) : safeArray(layout.outputs);
  const port = source[portIndex];

  if (!port) {
    return null;
  }

  const sideLength = getNodeSideLength(layout);
  const slot = getPortSideSlot(port, source);

  if (port.side === "left") {
    return { x: 0, y: slot };
  }

  if (port.side === "right") {
    return { x: sideLength, y: slot };
  }

  if (port.side === "top") {
    return { x: slot, y: 0 };
  }

  return { x: slot, y: sideLength };
}

export function rotateLocalPoint(point, sideLength, rot) {
  const normalized = normalizeRotation(rot);

  if (normalized === 90) {
    return { x: sideLength - point.y, y: point.x };
  }

  if (normalized === 180) {
    return { x: sideLength - point.x, y: sideLength - point.y };
  }

  if (normalized === 270) {
    return { x: point.y, y: sideLength - point.x };
  }

  return { ...point };
}

export function getPortWorldPoint(snapshot, node, registry, direction, portIndex) {
  const layout = getResolvedPortLayout(snapshot, node, registry);
  const local = getPortLocalPoint(layout, direction, portIndex);

  if (!local) {
    return null;
  }

  const sideLength = getNodeSideLength(layout);
  const rotated = rotateLocalPoint(local, sideLength, node.rot);

  return {
    x: node.pos.x + rotated.x,
    y: node.pos.y + rotated.y,
  };
}

export function getNodeWorldBounds(snapshot, node, registry) {
  const layout = getResolvedPortLayout(snapshot, node, registry);
  const sideLength = getNodeSideLength(layout);

  return {
    x: node.pos.x,
    y: node.pos.y,
    width: sideLength,
    height: sideLength,
  };
}

export function worldToScreen(point, camera, config) {
  const gridPx = config.grid.GRID_PX;
  return {
    x: point.x * camera.scale * gridPx + camera.x,
    y: point.y * camera.scale * gridPx + camera.y,
  };
}

export function screenToWorld(point, camera, config) {
  const gridPx = config.grid.GRID_PX;
  return {
    x: (point.x - camera.x) / (camera.scale * gridPx),
    y: (point.y - camera.y) / (camera.scale * gridPx),
  };
}

export function snapWorldPoint(point, config) {
  if (!config.grid.snap) {
    return {
      x: Number(point.x),
      y: Number(point.y),
    };
  }

  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

export function clampCamera(camera, viewportSize, config) {
  const bounds = config.grid.worldBounds;

  if (!bounds) {
    return {
      x: camera.x,
      y: camera.y,
      scale: Math.min(config.interaction.maxZoom, Math.max(config.interaction.minZoom, camera.scale)),
    };
  }

  const scale = Math.min(config.interaction.maxZoom, Math.max(config.interaction.minZoom, camera.scale));
  const gridPx = config.grid.GRID_PX * scale;
  const minX = viewportSize.width - bounds.maxX * gridPx;
  const maxX = -bounds.minX * gridPx;
  const minY = viewportSize.height - bounds.maxY * gridPx;
  const maxY = -bounds.minY * gridPx;

  return {
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
    scale,
  };
}

export function zoomCameraAtPoint(camera, cursor, nextScale, config) {
  const scale = Math.min(config.interaction.maxZoom, Math.max(config.interaction.minZoom, nextScale));
  const factor = scale / camera.scale;

  return {
    x: cursor.x - (cursor.x - camera.x) * factor,
    y: cursor.y - (cursor.y - camera.y) * factor,
    scale,
  };
}

export function createSvgPath(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const [firstPoint, ...rest] = points;
  return `M ${firstPoint.x} ${firstPoint.y}${rest.map((point) => ` L ${point.x} ${point.y}`).join("")}`;
}

export function createEmptyRoute() {
  return {
    points: [],
    svgPathD: "",
    totalLength: 0,
  };
}

export function getRouteLength(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }

  return total;
}

export function createFallbackRoute(edge, snapshot, registry) {
  const fromNode = snapshot.nodes.find((node) => node.id === edge.from.nodeId);
  const toNode = snapshot.nodes.find((node) => node.id === edge.to.nodeId);

  if (!fromNode || !toNode) {
    return createEmptyRoute();
  }

  const fromPoint = getPortWorldPoint(snapshot, fromNode, registry, "out", edge.from.portSlot);
  const toPoint = getPortWorldPoint(snapshot, toNode, registry, "in", edge.to.portSlot);

  if (!fromPoint || !toPoint) {
    return createEmptyRoute();
  }

  const points = [fromPoint, toPoint];
  return {
    points,
    svgPathD: createSvgPath(points),
    totalLength: getRouteLength(points),
  };
}

export function resolveRenderableEdgeRoute(edge, snapshot, routes, registry) {
  if (routes?.edgeRoutes?.has(edge.id)) {
    return routes.edgeRoutes.get(edge.id);
  }

  if (Array.isArray(routes?.errors) && routes.errors.some((issue) => issue.edgeId === edge.id)) {
    return createEmptyRoute();
  }

  if (routes?.edgeRoutes instanceof Map) {
    return createFallbackRoute(edge, snapshot, registry);
  }

  return createFallbackRoute(edge, snapshot, registry);
}

function samePoint(left, right) {
  return left.x === right.x && left.y === right.y;
}

function snapPreviewPoint(point) {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
  };
}

function rangeIntersects(minA, maxA, minB, maxB) {
  return Math.max(minA, minB) <= Math.min(maxA, maxB);
}

function getBoundsEdges(bounds) {
  if (
    Number.isFinite(bounds?.x) &&
    Number.isFinite(bounds?.y) &&
    Number.isFinite(bounds?.width) &&
    Number.isFinite(bounds?.height)
  ) {
    return {
      minX: bounds.x,
      maxX: bounds.x + bounds.width,
      minY: bounds.y,
      maxY: bounds.y + bounds.height,
    };
  }

  return {
    minX: Math.min(bounds.x0, bounds.x1),
    maxX: Math.max(bounds.x0, bounds.x1),
    minY: Math.min(bounds.y0, bounds.y1),
    maxY: Math.max(bounds.y0, bounds.y1),
  };
}

function doesOrthogonalSegmentIntersectBounds(start, end, bounds) {
  const edges = getBoundsEdges(bounds);

  if (start.x === end.x) {
    return (
      start.x >= edges.minX &&
      start.x <= edges.maxX &&
      rangeIntersects(
        Math.min(start.y, end.y),
        Math.max(start.y, end.y),
        edges.minY,
        edges.maxY,
      )
    );
  }

  if (start.y === end.y) {
    return (
      start.y >= edges.minY &&
      start.y <= edges.maxY &&
      rangeIntersects(
        Math.min(start.x, end.x),
        Math.max(start.x, end.x),
        edges.minX,
        edges.maxX,
      )
    );
  }

  return false;
}

export function doesRouteIntersectBounds(route, bounds) {
  if (!route?.points?.length) {
    return false;
  }

  if (route.points.length === 1) {
    const point = route.points[0];
    const edges = getBoundsEdges(bounds);

    return (
      point.x >= edges.minX &&
      point.x <= edges.maxX &&
      point.y >= edges.minY &&
      point.y <= edges.maxY
    );
  }

  for (let index = 1; index < route.points.length; index += 1) {
    if (doesOrthogonalSegmentIntersectBounds(route.points[index - 1], route.points[index], bounds)) {
      return true;
    }
  }

  return false;
}

function projectPointOutsideBounds(point, bounds) {
  if (!doesRouteIntersectBounds({ points: [point] }, bounds)) {
    return point;
  }

  const edges = getBoundsEdges(bounds);
  const candidates = [
    {
      x: edges.minX - 1,
      y: Math.min(edges.maxY + 1, Math.max(edges.minY - 1, point.y)),
    },
    {
      x: edges.maxX + 1,
      y: Math.min(edges.maxY + 1, Math.max(edges.minY - 1, point.y)),
    },
    {
      x: Math.min(edges.maxX + 1, Math.max(edges.minX - 1, point.x)),
      y: edges.minY - 1,
    },
    {
      x: Math.min(edges.maxX + 1, Math.max(edges.minX - 1, point.x)),
      y: edges.maxY + 1,
    },
  ];

  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(best.x - point.x) + Math.abs(best.y - point.y);
    const candidateDistance = Math.abs(candidate.x - point.x) + Math.abs(candidate.y - point.y);

    return candidateDistance < bestDistance ? candidate : best;
  });
}

function projectPointOutsideObstacles(point, obstacles) {
  let projected = snapPreviewPoint(point);
  let changed = true;
  let iterations = 0;
  const maxIterations = Math.max(1, obstacles.length * 4);

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations += 1;

    for (const bounds of obstacles) {
      const nextPoint = projectPointOutsideBounds(projected, bounds);

      if (!samePoint(nextPoint, projected)) {
        projected = nextPoint;
        changed = true;
      }
    }
  }

  return projected;
}

function appendOrthogonalPreviewSegment(points, toPoint, bendPreference) {
  const current = points.at(-1);

  if (!current || samePoint(current, toPoint)) {
    return;
  }

  if (current.x === toPoint.x || current.y === toPoint.y) {
    points.push(toPoint);
    return;
  }

  const elbow =
    bendPreference === "vertical-first"
      ? { x: current.x, y: toPoint.y }
      : { x: toPoint.x, y: current.y };

  if (!samePoint(current, elbow)) {
    points.push(elbow);
  }

  if (!samePoint(points.at(-1), toPoint)) {
    points.push(toPoint);
  }
}

export function buildPreviewRoute(
  fromPoint,
  toPoint,
  bendPreference = "horizontal-first",
  tempCorners = [],
  options = {},
) {
  const points = [fromPoint];
  const startOutward = options?.startOutward;
  const stubLength = Number.isFinite(options?.stubLength)
    ? Math.max(0, Number(options.stubLength))
    : 0;

  if (startOutward && stubLength > 0) {
    const startStub = {
      x: fromPoint.x + startOutward.x * stubLength,
      y: fromPoint.y + startOutward.y * stubLength,
    };

    if (!samePoint(points[0], startStub)) {
      points.push(startStub);
    }
  }

  for (const corner of tempCorners) {
    appendOrthogonalPreviewSegment(points, corner, bendPreference);
  }

  appendOrthogonalPreviewSegment(points, toPoint, bendPreference);

  return {
    points,
    svgPathD: createSvgPath(points),
    totalLength: getRouteLength(points),
  };
}

export function buildObstacleAwarePreviewRoute({
  snapshot,
  registry,
  fromAnchor,
  toPoint,
  bendPreference = "horizontal-first",
  tempCorners = [],
  stubLength = 1,
}) {
  if (!fromAnchor?.point || !fromAnchor?.outward) {
    return createEmptyRoute();
  }

  const obstacles = snapshot.nodes.map((node) =>
    getNodeRoutingBounds(node, snapshot, registry, "preview"),
  );
  const ghostPoint = projectPointOutsideObstacles(toPoint, obstacles);
  const startStub =
    stubLength > 0
      ? {
          x: fromAnchor.point.x + fromAnchor.outward.x * stubLength,
          y: fromAnchor.point.y + fromAnchor.outward.y * stubLength,
        }
      : null;
  const manualCorners = [
    ...(startStub ? [startStub] : []),
    ...tempCorners.map((point) => snapPreviewPoint(point)),
  ];
  const points = buildOrthogonalRoute({
    startAnchor: fromAnchor.point,
    startOutward: fromAnchor.outward,
    endAnchor: ghostPoint,
    endOutward: { x: 0, y: 0 },
    manualCorners,
    stubLength,
    bendPreference,
    obstacles,
  });

  if (!points) {
    return createEmptyRoute();
  }

  return {
    points,
    svgPathD: createSvgPath(points),
    totalLength: getRouteLength(points),
  };
}

export function getPointAtRouteProgress(route, progress) {
  if (!route?.points?.length) {
    return null;
  }

  if (route.points.length === 1) {
    return route.points[0];
  }

  const totalLength = route.totalLength ?? getRouteLength(route.points);

  if (totalLength <= 0) {
    return route.points.at(-1);
  }

  const clampedProgress = Math.min(1, Math.max(0, Number(progress) || 0));
  let remaining = totalLength * clampedProgress;

  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const segmentLength = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);

    if (remaining <= segmentLength) {
      if (start.x === end.x) {
        const direction = end.y >= start.y ? 1 : -1;
        return { x: start.x, y: start.y + remaining * direction };
      }

      const direction = end.x >= start.x ? 1 : -1;
      return { x: start.x + remaining * direction, y: start.y };
    }

    remaining -= segmentLength;
  }

  return route.points.at(-1);
}

export function getNodeScreenBox(snapshot, node, registry, camera, config) {
  const bounds = getNodeWorldBounds(snapshot, node, registry);
  const topLeft = worldToScreen({ x: bounds.x, y: bounds.y }, camera, config);
  const bottomRight = worldToScreen(
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    camera,
    config,
  );

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function clampParamInput(value) {
  return clampDiscreteNodeValue(value, 1);
}
