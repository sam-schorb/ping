function setMapEntry(map, key, value) {
  if (typeof key !== "string" || key.trim() === "") {
    return;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  map.set(key, value);
}

export function createPresentationMaps(snapshot, flatNodes, validatedEdges, groupsById) {
  const topLevelNodeIds = new Set((snapshot?.nodes ?? []).map((node) => node.id));
  const topLevelEdgeIds = new Set((snapshot?.edges ?? []).map((edge) => edge.id));
  const visibleNodeIdByCompiledNodeId = new Map();
  const visibleEdgeIdByCompiledEdgeId = new Map();
  const collapsedOwnerNodeIdByCompiledEdgeId = new Map();

  for (const nodeEntry of flatNodes ?? []) {
    if (topLevelNodeIds.has(nodeEntry?.sourceId)) {
      setMapEntry(
        visibleNodeIdByCompiledNodeId,
        nodeEntry.id,
        nodeEntry.sourceId,
      );
    }
  }

  for (const edgeEntry of validatedEdges ?? []) {
    if (topLevelEdgeIds.has(edgeEntry?.sourceId)) {
      setMapEntry(
        visibleEdgeIdByCompiledEdgeId,
        edgeEntry.id,
        edgeEntry.sourceId,
      );
    }
  }

  if (groupsById instanceof Map) {
    for (const [visibleNodeId, meta] of groupsById.entries()) {
      for (const compiledNodeId of meta?.nodeIds ?? []) {
        setMapEntry(
          visibleNodeIdByCompiledNodeId,
          compiledNodeId,
          visibleNodeId,
        );
      }

      for (const compiledEdgeId of meta?.edgeIds ?? []) {
        setMapEntry(
          collapsedOwnerNodeIdByCompiledEdgeId,
          compiledEdgeId,
          visibleNodeId,
        );
      }
    }
  }

  return {
    visibleNodeIdByCompiledNodeId,
    visibleEdgeIdByCompiledEdgeId,
    collapsedOwnerNodeIdByCompiledEdgeId,
  };
}
