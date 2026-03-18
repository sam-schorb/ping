import {
  getNodeWorldBounds,
  getPointAtRouteProgress,
  getPortWorldPoint,
  getResolvedPortLayout,
  resolveRenderableEdgeRoute,
  worldToScreen,
} from "./geometry.js";

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distanceToSegmentSquared(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return distanceSquared(point, start);
  }

  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const projected = {
    x: start.x + dx * clampedT,
    y: start.y + dy * clampedT,
  };

  return distanceSquared(point, projected);
}

export function hitPort(snapshot, registry, worldPoint, radius) {
  for (let nodeIndex = snapshot.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = snapshot.nodes[nodeIndex];
    const layout = getResolvedPortLayout(snapshot, node, registry);
    const inputCount = layout.inputs.length;
    const outputCount = layout.outputs.length;

    for (let portSlot = 0; portSlot < inputCount; portSlot += 1) {
      const anchor = getPortWorldPoint(snapshot, node, registry, "in", portSlot);

      if (anchor && distanceSquared(anchor, worldPoint) <= radius * radius) {
        return { kind: "port", nodeId: node.id, portSlot, direction: "in" };
      }
    }

    for (let portSlot = 0; portSlot < outputCount; portSlot += 1) {
      const anchor = getPortWorldPoint(snapshot, node, registry, "out", portSlot);

      if (anchor && distanceSquared(anchor, worldPoint) <= radius * radius) {
        return { kind: "port", nodeId: node.id, portSlot, direction: "out" };
      }
    }
  }

  return null;
}

export function hitCorner(snapshot, routes, worldPoint, radius) {
  for (let edgeIndex = snapshot.edges.length - 1; edgeIndex >= 0; edgeIndex -= 1) {
    const edge = snapshot.edges[edgeIndex];
    const corners = edge.manualCorners ?? [];

    for (let cornerIndex = corners.length - 1; cornerIndex >= 0; cornerIndex -= 1) {
      if (distanceSquared(corners[cornerIndex], worldPoint) <= radius * radius) {
        return { kind: "corner", edgeId: edge.id, cornerIndex };
      }
    }
  }

  return null;
}

export function hitEdge(snapshot, routes, registry, worldPoint, tolerance) {
  for (let edgeIndex = snapshot.edges.length - 1; edgeIndex >= 0; edgeIndex -= 1) {
    const edge = snapshot.edges[edgeIndex];
    const route = resolveRenderableEdgeRoute(edge, snapshot, routes, registry);

    if (!route?.points || route.points.length < 2) {
      continue;
    }

    for (let index = 1; index < route.points.length; index += 1) {
      const distance = distanceToSegmentSquared(worldPoint, route.points[index - 1], route.points[index]);

      if (distance <= tolerance * tolerance) {
        return { kind: "edge", edgeId: edge.id };
      }
    }
  }

  return null;
}

export function hitNode(snapshot, registry, worldPoint) {
  for (let nodeIndex = snapshot.nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = snapshot.nodes[nodeIndex];
    const bounds = getNodeWorldBounds(snapshot, node, registry);

    if (
      worldPoint.x >= bounds.x &&
      worldPoint.x <= bounds.x + bounds.width &&
      worldPoint.y >= bounds.y &&
      worldPoint.y <= bounds.y + bounds.height
    ) {
      return { kind: "node", nodeId: node.id };
    }
  }

  return null;
}

export function pickHoverTarget(snapshot, routes, registry, worldPoint, config, camera) {
  const portHit = hitPort(snapshot, registry, worldPoint, config.port.hoverRadiusPx / config.grid.GRID_PX);

  if (portHit) {
    return portHit;
  }

  const cornerHit = hitCorner(
    snapshot,
    routes,
    worldPoint,
    config.port.hoverRadiusPx / config.grid.GRID_PX,
  );

  if (cornerHit) {
    return cornerHit;
  }

  const edgeHit = hitEdge(snapshot, routes, registry, worldPoint, 0.2);

  if (edgeHit) {
    return edgeHit;
  }

  return hitNode(snapshot, registry, worldPoint) ?? { kind: "none" };
}

export function getThumbScreenPoint(route, thumb, camera, config) {
  const point = getPointAtRouteProgress(route, thumb.progress);

  if (!point) {
    return null;
  }

  return worldToScreen(point, camera, config);
}
