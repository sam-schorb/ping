export function createDebugMaps(nodes, edges) {
  return {
    nodeIdToSourceId: new Map(
      nodes.map((node) => [node.id, node.sourceId]),
    ),
    edgeIdToSourceId: new Map(
      edges.map((edge) => [edge.id, edge.sourceId]),
    ),
  };
}
