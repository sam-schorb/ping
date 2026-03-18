import { getNodeRoutingBounds, getPortAnchor, resolveRoutingConfig } from "./anchors.js";
import { buildOrthogonalRoute } from "./path.js";
import { computeRouteLength, createSvgPath } from "./length.js";
import { ROUTING_ERROR_CODES, createRoutingError } from "./errors.js";

function getEdgeById(snapshot, edgeId) {
  return snapshot.edges.find((edge) => edge.id === edgeId);
}

function getNodeById(snapshot, nodeId) {
  return snapshot.nodes.find((node) => node.id === nodeId);
}

export function routeEdge(edgeId, snapshot, registry, config) {
  const resolvedConfig = resolveRoutingConfig(config);
  const edge = getEdgeById(snapshot, edgeId);

  if (!edge) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.MISSING_EDGE,
      edgeId,
      `Edge "${edgeId}" does not exist in the provided snapshot.`,
    );
  }

  const fromNode = getNodeById(snapshot, edge.from.nodeId);

  if (!fromNode) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.MISSING_NODE,
      edgeId,
      `Edge "${edgeId}" references missing node "${edge.from.nodeId}".`,
    );
  }

  const toNode = getNodeById(snapshot, edge.to.nodeId);

  if (!toNode) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.MISSING_NODE,
      edgeId,
      `Edge "${edgeId}" references missing node "${edge.to.nodeId}".`,
    );
  }

  const fromAnchor = getPortAnchor(
    fromNode,
    "out",
    edge.from.portSlot,
    snapshot,
    registry,
    edgeId,
    resolvedConfig,
  );
  const toAnchor = getPortAnchor(
    toNode,
    "in",
    edge.to.portSlot,
    snapshot,
    registry,
    edgeId,
    resolvedConfig,
  );

  const points = buildOrthogonalRoute({
    startAnchor: fromAnchor.point,
    startOutward: fromAnchor.outward,
    endAnchor: toAnchor.point,
    endOutward: toAnchor.outward,
    manualCorners: edge.manualCorners.map((point) => ({ ...point })),
    stubLength: resolvedConfig.stubLength,
    bendPreference: resolvedConfig.bendPreference,
    obstacles: snapshot.nodes.map((node) =>
      getNodeRoutingBounds(node, snapshot, registry, edgeId),
    ),
  });

  if (!points) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.NO_PATH,
      edgeId,
      `Edge "${edgeId}" has no legal orthogonal route.`,
    );
  }

  return {
    points,
    svgPathD: createSvgPath(points),
    totalLength: computeRouteLength(points),
  };
}
