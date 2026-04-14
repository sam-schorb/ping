import { getNodeRoutingBounds, getPortAnchor, resolveRoutingConfig } from "./anchors.js";
import { ROUTING_ERROR_CODES, createRoutingError } from "./errors.js";
import { routeEdge } from "./route-edge.js";

function samePoint(a, b) {
  return a?.x === b?.x && a?.y === b?.y;
}

function getEdgeById(snapshot, edgeId) {
  return snapshot.edges.find((edge) => edge.id === edgeId);
}

function getNodeById(snapshot, nodeId) {
  return snapshot.nodes.find((node) => node.id === nodeId);
}

function normalizeDesiredPoint(point, edgeId) {
  const x = Number(point?.x);
  const y = Number(point?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.INTERNAL_ERROR,
      edgeId,
      `Manual corner drag for edge "${edgeId}" requires a finite desired point.`,
    );
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function createSnapshotWithCornerPoint(snapshot, edgeId, cornerIndex, point) {
  return {
    ...snapshot,
    edges: snapshot.edges.map((edge) =>
      edge.id !== edgeId
        ? edge
        : {
            ...edge,
            manualCorners: edge.manualCorners.map((corner, index) =>
              index === cornerIndex ? point : { ...corner },
            ),
          },
    ),
  };
}

function tryResolveCandidate(snapshot, registry, edgeId, cornerIndex, point, config) {
  try {
    const candidateSnapshot = createSnapshotWithCornerPoint(
      snapshot,
      edgeId,
      cornerIndex,
      point,
    );
    const route = routeEdge(edgeId, candidateSnapshot, registry, config);
    const explicitWaypoint = route.points.some((routePoint) => samePoint(routePoint, point));

    if (!explicitWaypoint) {
      return null;
    }

    return {
      point,
      route,
    };
  } catch {
    return null;
  }
}

function getSearchBounds(snapshot, edge, registry, config, desiredPoint, originalPoint) {
  const fromNode = getNodeById(snapshot, edge.from.nodeId);
  const toNode = getNodeById(snapshot, edge.to.nodeId);

  if (!fromNode || !toNode) {
    return {
      minX: Math.min(desiredPoint.x, originalPoint.x) - 8,
      maxX: Math.max(desiredPoint.x, originalPoint.x) + 8,
      minY: Math.min(desiredPoint.y, originalPoint.y) - 8,
      maxY: Math.max(desiredPoint.y, originalPoint.y) + 8,
    };
  }

  const fromAnchor = getPortAnchor(
    fromNode,
    "out",
    edge.from.portSlot,
    snapshot,
    registry,
    edge.id,
    config,
  );
  const toAnchor = getPortAnchor(
    toNode,
    "in",
    edge.to.portSlot,
    snapshot,
    registry,
    edge.id,
    config,
  );
  const points = [
    desiredPoint,
    originalPoint,
    fromAnchor.point,
    toAnchor.point,
    ...(edge.manualCorners ?? []),
  ];
  const margin = Math.max(8, config.stubLength + 6);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  for (const node of snapshot.nodes) {
    const bounds = getNodeRoutingBounds(node, snapshot, registry, edge.id);
    minX = Math.min(minX, bounds.x0);
    maxX = Math.max(maxX, bounds.x1);
    minY = Math.min(minY, bounds.y0);
    maxY = Math.max(maxY, bounds.y1);
  }

  return {
    minX: minX - margin,
    maxX: maxX + margin,
    minY: minY - margin,
    maxY: maxY + margin,
  };
}

function isPointWithinBounds(point, bounds) {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function getMaxSearchRadius(point, bounds) {
  return Math.max(
    Math.abs(point.x - bounds.minX) + Math.abs(point.y - bounds.minY),
    Math.abs(point.x - bounds.minX) + Math.abs(point.y - bounds.maxY),
    Math.abs(point.x - bounds.maxX) + Math.abs(point.y - bounds.minY),
    Math.abs(point.x - bounds.maxX) + Math.abs(point.y - bounds.maxY),
  );
}

function createRingOffsets(radius) {
  if (radius === 0) {
    return [{ x: 0, y: 0 }];
  }

  const offsets = [];

  for (let dx = -radius; dx <= radius; dx += 1) {
    const dy = radius - Math.abs(dx);

    offsets.push({ x: dx, y: dy });

    if (dy !== 0) {
      offsets.push({ x: dx, y: -dy });
    }
  }

  return offsets;
}

function compareCandidates(a, b, desiredPoint, originalPoint) {
  const aSquared = (a.point.x - desiredPoint.x) ** 2 + (a.point.y - desiredPoint.y) ** 2;
  const bSquared = (b.point.x - desiredPoint.x) ** 2 + (b.point.y - desiredPoint.y) ** 2;

  if (aSquared !== bSquared) {
    return aSquared - bSquared;
  }

  if (a.route.totalLength !== b.route.totalLength) {
    return a.route.totalLength - b.route.totalLength;
  }

  const aOriginalDistance =
    Math.abs(a.point.x - originalPoint.x) + Math.abs(a.point.y - originalPoint.y);
  const bOriginalDistance =
    Math.abs(b.point.x - originalPoint.x) + Math.abs(b.point.y - originalPoint.y);

  if (aOriginalDistance !== bOriginalDistance) {
    return aOriginalDistance - bOriginalDistance;
  }

  if (a.point.y !== b.point.y) {
    return a.point.y - b.point.y;
  }

  return a.point.x - b.point.x;
}

export function resolveManualCornerDrag({
  snapshot,
  registry,
  edgeId,
  cornerIndex,
  desiredPoint,
  config,
}) {
  const resolvedConfig = resolveRoutingConfig(config);
  const edge = getEdgeById(snapshot, edgeId);

  if (!edge) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.MISSING_EDGE,
      edgeId,
      `Edge "${edgeId}" does not exist in the provided snapshot.`,
    );
  }

  if (!Number.isInteger(cornerIndex) || !edge.manualCorners?.[cornerIndex]) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.INTERNAL_ERROR,
      edgeId,
      `Edge "${edgeId}" does not have manual corner ${cornerIndex}.`,
    );
  }

  const normalizedDesiredPoint = normalizeDesiredPoint(desiredPoint, edgeId);
  const originalPoint = { ...edge.manualCorners[cornerIndex] };
  const exact = tryResolveCandidate(
    snapshot,
    registry,
    edgeId,
    cornerIndex,
    normalizedDesiredPoint,
    resolvedConfig,
  );

  if (exact) {
    return {
      status: "exact",
      desiredPoint: normalizedDesiredPoint,
      resolvedPoint: exact.point,
      route: exact.route,
    };
  }

  const bounds = getSearchBounds(
    snapshot,
    edge,
    registry,
    resolvedConfig,
    normalizedDesiredPoint,
    originalPoint,
  );
  const maxRadius = getMaxSearchRadius(normalizedDesiredPoint, bounds);

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const candidates = [];

    for (const offset of createRingOffsets(radius)) {
      const point = {
        x: normalizedDesiredPoint.x + offset.x,
        y: normalizedDesiredPoint.y + offset.y,
      };

      if (!isPointWithinBounds(point, bounds)) {
        continue;
      }

      const resolution = tryResolveCandidate(
        snapshot,
        registry,
        edgeId,
        cornerIndex,
        point,
        resolvedConfig,
      );

      if (resolution) {
        candidates.push(resolution);
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => compareCandidates(a, b, normalizedDesiredPoint, originalPoint));
      const best = candidates[0];

      return {
        status: "clamped",
        desiredPoint: normalizedDesiredPoint,
        resolvedPoint: best.point,
        route: best.route,
      };
    }
  }

  let fallbackRoute = null;

  try {
    fallbackRoute = routeEdge(edgeId, snapshot, registry, resolvedConfig);
  } catch {
    fallbackRoute = null;
  }

  return {
    status: "blocked",
    desiredPoint: normalizedDesiredPoint,
    resolvedPoint: originalPoint,
    route: fallbackRoute,
  };
}
