function compareProjectedPulseState(left, right) {
  const leftTick = Number.isFinite(left?.receivedTick)
    ? left.receivedTick
    : Number.NEGATIVE_INFINITY;
  const rightTick = Number.isFinite(right?.receivedTick)
    ? right.receivedTick
    : Number.NEGATIVE_INFINITY;

  if (leftTick !== rightTick) {
    return leftTick - rightTick;
  }

  const leftProgress = Number.isFinite(left?.progress)
    ? left.progress
    : Number.POSITIVE_INFINITY;
  const rightProgress = Number.isFinite(right?.progress)
    ? right.progress
    : Number.POSITIVE_INFINITY;

  return rightProgress - leftProgress;
}

function getVisibleNodeIdByCompiledNodeId(graph) {
  const map = graph?.presentation?.visibleNodeIdByCompiledNodeId;

  if (map instanceof Map) {
    return map;
  }

  const fallback = new Map();
  const groupsById = graph?.groupMeta?.groupsById;

  for (const node of graph?.nodes ?? []) {
    if (typeof node?.id === "string" && node.id.trim() !== "") {
      fallback.set(node.id, node.id);
    }
  }

  if (!(groupsById instanceof Map)) {
    return fallback;
  }

  for (const [visibleNodeId, meta] of groupsById.entries()) {
    for (const compiledNodeId of meta?.nodeIds ?? []) {
      if (typeof compiledNodeId !== "string" || compiledNodeId.trim() === "") {
        continue;
      }

      fallback.set(compiledNodeId, visibleNodeId);
    }
  }

  return fallback;
}

function getVisibleEdgeIdByCompiledEdgeId(graph) {
  const map = graph?.presentation?.visibleEdgeIdByCompiledEdgeId;
  return map instanceof Map ? map : new Map();
}

function getCollapsedOwnerNodeIdByCompiledEdgeId(graph) {
  const map = graph?.presentation?.collapsedOwnerNodeIdByCompiledEdgeId;

  if (map instanceof Map) {
    return map;
  }

  const fallback = new Map();
  const groupsById = graph?.groupMeta?.groupsById;

  if (!(groupsById instanceof Map)) {
    return fallback;
  }

  for (const [visibleNodeId, meta] of groupsById.entries()) {
    for (const compiledEdgeId of meta?.edgeIds ?? []) {
      if (typeof compiledEdgeId !== "string" || compiledEdgeId.trim() === "") {
        continue;
      }

      fallback.set(compiledEdgeId, visibleNodeId);
    }
  }

  return fallback;
}

export function projectNodePulseState(graph, nodePulseStates) {
  if (!Array.isArray(nodePulseStates) || nodePulseStates.length === 0) {
    return [];
  }

  const visibleNodeIdByCompiledNodeId = getVisibleNodeIdByCompiledNodeId(graph);
  const projectedByVisibleNodeId = new Map();

  for (const pulseState of nodePulseStates) {
    if (typeof pulseState?.nodeId !== "string" || pulseState.nodeId.trim() === "") {
      continue;
    }

    const visibleNodeId =
      visibleNodeIdByCompiledNodeId.get(pulseState.nodeId) ?? pulseState.nodeId;
    const projected = {
      ...pulseState,
      nodeId: visibleNodeId,
    };
    const current = projectedByVisibleNodeId.get(visibleNodeId);

    if (!current || compareProjectedPulseState(projected, current) > 0) {
      projectedByVisibleNodeId.set(visibleNodeId, projected);
    }
  }

  return Array.from(projectedByVisibleNodeId.values()).sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId),
  );
}

export function projectThumbState(graph, thumbs) {
  if (!Array.isArray(thumbs) || thumbs.length === 0) {
    return [];
  }

  const visibleEdgeIdByCompiledEdgeId = getVisibleEdgeIdByCompiledEdgeId(graph);

  return thumbs
    .flatMap((thumb) => {
      if (typeof thumb?.edgeId !== "string" || thumb.edgeId.trim() === "") {
        return [];
      }

      const visibleEdgeId = visibleEdgeIdByCompiledEdgeId.get(thumb.edgeId);

      if (!visibleEdgeId) {
        return [];
      }

      return [
        {
          ...thumb,
          edgeId: visibleEdgeId,
        },
      ];
    })
    .sort((left, right) => {
      if (left.edgeId !== right.edgeId) {
        return left.edgeId.localeCompare(right.edgeId);
      }

      return (left.emitTick ?? 0) - (right.emitTick ?? 0);
    });
}

export function projectRuntimeActivity(graph, activity = {}) {
  const collapsedOwnerNodeIdByCompiledEdgeId =
    getCollapsedOwnerNodeIdByCompiledEdgeId(graph);

  return {
    thumbs: projectThumbState(graph, activity.thumbs),
    nodePulseStates: projectNodePulseState(graph, activity.nodePulseStates),
    collapsedEdgeActivityOwners: Array.from(
      new Set(
        (activity.thumbs ?? [])
          .map((thumb) => collapsedOwnerNodeIdByCompiledEdgeId.get(thumb?.edgeId))
          .filter((ownerId) => typeof ownerId === "string" && ownerId.trim() !== ""),
      ),
    ).sort((left, right) => left.localeCompare(right)),
  };
}
