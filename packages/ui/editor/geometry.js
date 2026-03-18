import { getPortSideSlot } from "@ping/core";

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
    if (node.type !== "group") {
      return baseDefinition;
    }

    const group = snapshot.groups?.[node.groupRef];
    const inputs = safeArray(group?.inputs).length;
    const outputs = safeArray(group?.outputs).length;
    const controlPorts = safeArray(group?.controls).length;

    return {
      ...baseDefinition,
      label: node.name || group?.name || baseDefinition.label,
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

export function buildPreviewRoute(fromPoint, toPoint, bendPreference = "horizontal-first", tempCorners = []) {
  const points = [fromPoint];

  for (const corner of tempCorners) {
    points.push(corner);
  }

  const lastPoint = points.at(-1);

  if (bendPreference === "vertical-first") {
    if (lastPoint.x !== toPoint.x) {
      points.push({ x: lastPoint.x, y: toPoint.y });
    }
  } else if (lastPoint.y !== toPoint.y) {
    points.push({ x: toPoint.x, y: lastPoint.y });
  }

  points.push(toPoint);

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
