import { getPortAnchor, resolveRoutingConfig } from "./anchors.js";

function getNodeById(snapshot, nodeId) {
  return snapshot.nodes.find((node) => node.id === nodeId);
}

export function createRoutingCache() {
  return {
    edgeRoutes: new Map(),
    edgeDelays: new Map(),
    cacheKeys: new Map(),
  };
}

export function ensureRoutingCache(cache) {
  if (!cache) {
    return createRoutingCache();
  }

  if (!(cache.edgeRoutes instanceof Map)) {
    cache.edgeRoutes = new Map();
  }

  if (!(cache.edgeDelays instanceof Map)) {
    cache.edgeDelays = new Map();
  }

  if (!(cache.cacheKeys instanceof Map)) {
    cache.cacheKeys = new Map();
  }

  return cache;
}

export function createEdgeCacheKey(edge, snapshot, registry, config) {
  const resolvedConfig = resolveRoutingConfig(config);
  const fromNode = getNodeById(snapshot, edge.from.nodeId);
  const toNode = getNodeById(snapshot, edge.to.nodeId);
  const obstacleNodes = snapshot.nodes.map((node) => {
    const groupDefinition = node.groupRef ? snapshot.groups?.[node.groupRef] : null;

    return {
      id: node.id,
      type: node.type,
      pos: node.pos,
      rot: node.rot,
      groupRef: node.groupRef,
      groupShape: groupDefinition
        ? {
            inputs: groupDefinition.inputs.length,
            outputs: groupDefinition.outputs.length,
            controls: groupDefinition.controls.length,
          }
        : null,
    };
  });

  if (!fromNode || !toNode) {
    return JSON.stringify({
      edge,
      missingNode: !fromNode ? edge.from.nodeId : edge.to.nodeId,
      obstacleNodes,
      config: resolvedConfig,
    });
  }

  const fromAnchor = getPortAnchor(
    fromNode,
    "out",
    edge.from.portSlot,
    snapshot,
    registry,
    edge.id,
    resolvedConfig,
  );
  const toAnchor = getPortAnchor(
    toNode,
    "in",
    edge.to.portSlot,
    snapshot,
    registry,
    edge.id,
    resolvedConfig,
  );

  return JSON.stringify({
    edge,
    fromNode: {
      id: fromNode.id,
      type: fromNode.type,
      pos: fromNode.pos,
      rot: fromNode.rot,
      groupRef: fromNode.groupRef,
    },
    toNode: {
      id: toNode.id,
      type: toNode.type,
      pos: toNode.pos,
      rot: toNode.rot,
      groupRef: toNode.groupRef,
    },
    obstacleNodes,
    fromAnchor,
    toAnchor,
    config: resolvedConfig,
  });
}
