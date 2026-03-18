import { createEdgeCacheKey, ensureRoutingCache } from "./cache.js";
import { resolveRoutingConfig } from "./anchors.js";
import { normalizeRoutingError } from "./errors.js";
import { routeEdge } from "./route-edge.js";

export function routeGraph(snapshot, registry, config, changedEdges, cache) {
  let resolvedConfig;

  try {
    resolvedConfig = resolveRoutingConfig(config);
  } catch (error) {
    return {
      edgeRoutes: new Map(),
      edgeDelays: new Map(),
      errors: [normalizeRoutingError(error, "*")],
    };
  }

  const effectiveCache = cache ? ensureRoutingCache(cache) : null;
  const edgeRoutes = new Map();
  const edgeDelays = new Map();
  const errors = [];
  const snapshotEdgeIds = new Set(snapshot.edges.map((edge) => edge.id));

  if (effectiveCache) {
    for (const edgeId of Array.from(effectiveCache.cacheKeys.keys())) {
      if (!snapshotEdgeIds.has(edgeId)) {
        effectiveCache.cacheKeys.delete(edgeId);
        effectiveCache.edgeRoutes.delete(edgeId);
        effectiveCache.edgeDelays.delete(edgeId);
      }
    }
  }

  for (const edge of snapshot.edges) {
    let cacheKey;

    try {
      cacheKey = createEdgeCacheKey(edge, snapshot, registry, resolvedConfig);
    } catch (error) {
      cacheKey = null;
    }

    const shouldUseCache =
      effectiveCache &&
      effectiveCache.edgeRoutes.has(edge.id) &&
      effectiveCache.edgeDelays.has(edge.id) &&
      effectiveCache.cacheKeys.get(edge.id) === cacheKey &&
      (!changedEdges || !changedEdges.has(edge.id));

    if (shouldUseCache) {
      edgeRoutes.set(edge.id, effectiveCache.edgeRoutes.get(edge.id));
      edgeDelays.set(edge.id, effectiveCache.edgeDelays.get(edge.id));
      continue;
    }

    try {
      const route = routeEdge(edge.id, snapshot, registry, resolvedConfig);
      const delay = route.totalLength * resolvedConfig.ticksPerGrid;

      edgeRoutes.set(edge.id, route);
      edgeDelays.set(edge.id, delay);

      if (effectiveCache) {
        effectiveCache.edgeRoutes.set(edge.id, route);
        effectiveCache.edgeDelays.set(edge.id, delay);
        effectiveCache.cacheKeys.set(
          edge.id,
          cacheKey ?? createEdgeCacheKey(edge, snapshot, registry, resolvedConfig),
        );
      }
    } catch (error) {
      errors.push(normalizeRoutingError(error, edge.id));

      if (effectiveCache) {
        effectiveCache.edgeRoutes.delete(edge.id);
        effectiveCache.edgeDelays.delete(edge.id);
        effectiveCache.cacheKeys.delete(edge.id);
      }
    }
  }

  return {
    edgeRoutes,
    edgeDelays,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
