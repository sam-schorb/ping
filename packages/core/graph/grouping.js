export function cloneGroupsRecord(groups) {
  if (!groups || typeof groups !== "object") {
    return undefined;
  }

  const clone = {};

  for (const [groupId, group] of Object.entries(groups)) {
    clone[groupId] = {
      ...group,
      graph: {
        nodes: group.graph.nodes.map((node) => ({
          ...node,
          pos: { ...node.pos },
          params: { ...node.params },
        })),
        edges: group.graph.edges.map((edge) => ({
          ...edge,
          from: { ...edge.from },
          to: { ...edge.to },
          manualCorners: edge.manualCorners.map((point) => ({ ...point })),
        })),
      },
      inputs: [...group.inputs],
      outputs: [...group.outputs],
      controls: [...group.controls],
    };
  }

  return Object.keys(clone).length > 0 ? clone : undefined;
}

export function isGroupReferenced(nodes, groupId) {
  return nodes.some((node) => node.groupRef === groupId);
}
