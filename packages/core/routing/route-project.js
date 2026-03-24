import { createRoutingCache } from "./cache.js";
import { routeGraph } from "./route-graph.js";
import { createGroupDelaySourceId } from "../build/delay-sources.js";

export function createProjectRoutingCache() {
  return {
    topLevel: createRoutingCache(),
    groupsById: new Map(),
  };
}

function ensureProjectRoutingCache(cache) {
  if (!cache) {
    return createProjectRoutingCache();
  }

  if (!cache.topLevel) {
    cache.topLevel = createRoutingCache();
  }

  if (!(cache.groupsById instanceof Map)) {
    cache.groupsById = new Map();
  }

  return cache;
}

function annotateGroupRoutingErrors(errors, groupId) {
  return errors.map((error) => ({
    ...error,
    groupId,
  }));
}

export function routeProjectGraph(snapshot, registry, config, changedEdges, cache) {
  const projectCache = cache ? ensureProjectRoutingCache(cache) : null;
  const topLevelResult = routeGraph(
    snapshot,
    registry,
    config,
    changedEdges,
    projectCache?.topLevel,
  );
  const edgeDelays = new Map(topLevelResult.edgeDelays);
  const errors = [...(topLevelResult.errors ?? [])];
  const groups = snapshot.groups ?? {};

  if (projectCache) {
    for (const groupId of Array.from(projectCache.groupsById.keys())) {
      if (!groups[groupId]) {
        projectCache.groupsById.delete(groupId);
      }
    }
  }

  for (const [groupId, groupDefinition] of Object.entries(groups)) {
    let groupCache = null;

    if (projectCache) {
      groupCache = projectCache.groupsById.get(groupId) ?? createRoutingCache();
      projectCache.groupsById.set(groupId, groupCache);
    }

    const groupResult = routeGraph(
      {
        nodes: groupDefinition.graph.nodes,
        edges: groupDefinition.graph.edges,
        groups,
      },
      registry,
      config,
      null,
      groupCache,
    );
    const preserveInternalCableDelays = groupDefinition.preserveInternalCableDelays === true;

    for (const [edgeId, delay] of groupResult.edgeDelays.entries()) {
      edgeDelays.set(
        createGroupDelaySourceId(groupId, edgeId),
        preserveInternalCableDelays ? delay : 0,
      );
    }

    if (groupResult.errors?.length) {
      errors.push(...annotateGroupRoutingErrors(groupResult.errors, groupId));
    }
  }

  return {
    edgeRoutes: topLevelResult.edgeRoutes,
    edgeDelays,
    ...(errors.length > 0 ? { errors } : {}),
  };
}
