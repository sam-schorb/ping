import { cloneRuntimeState } from "./events.js";

function cloneCompiledNode(node) {
  return {
    id: node.id,
    type: node.type,
    param: node.param,
    state: cloneRuntimeState(node.state),
    inputs: node.inputs,
    outputs: node.outputs,
    controlPorts: node.controlPorts,
  };
}

function cloneCompiledEdge(edge) {
  return {
    id: edge.id,
    from: { ...edge.from },
    to: { ...edge.to },
    role: edge.role,
    delay: edge.delay,
  };
}

function cloneMapOfArrays(map) {
  return new Map(
    Array.from(map.entries(), ([key, values]) => [key, [...values]]),
  );
}

function cloneGroupMeta(groupMeta) {
  return {
    groupsById: new Map(
      Array.from(groupMeta.groupsById.entries(), ([groupId, meta]) => [
        groupId,
        {
          nodeIds: [...meta.nodeIds],
          externalInputs: meta.externalInputs.map((item) => ({ ...item })),
          externalOutputs: meta.externalOutputs.map((item) => ({ ...item })),
          controls: meta.controls.map((item) => ({ ...item })),
        },
      ]),
    ),
  };
}

function cloneDebugMaps(debug) {
  return {
    nodeIdToSourceId: new Map(debug.nodeIdToSourceId),
    edgeIdToSourceId: new Map(debug.edgeIdToSourceId),
  };
}

function createOrderIndex(ids) {
  return new Map(ids.map((id, index) => [id, index]));
}

function sortByNextOrder(items, orderIndex) {
  items.sort((left, right) => {
    const leftIndex = orderIndex.get(left.id);
    const rightIndex = orderIndex.get(right.id);

    if (leftIndex === undefined && rightIndex === undefined) {
      return 0;
    }

    if (leftIndex === undefined) {
      return 1;
    }

    if (rightIndex === undefined) {
      return -1;
    }

    return leftIndex - rightIndex;
  });
}

export function cloneCompiledGraph(graph) {
  return {
    nodes: graph.nodes.map(cloneCompiledNode),
    edges: graph.edges.map(cloneCompiledEdge),
    edgesByNodeId: cloneMapOfArrays(graph.edgesByNodeId),
    edgesByPortId: new Map(graph.edgesByPortId),
    nodeIndex: new Map(graph.nodeIndex),
    edgeIndex: new Map(graph.edgeIndex),
    ...(graph.groupMeta ? { groupMeta: cloneGroupMeta(graph.groupMeta) } : {}),
    ...(graph.debug ? { debug: cloneDebugMaps(graph.debug) } : {}),
  };
}

export function reindexCompiledGraph(graph) {
  graph.nodeIndex = new Map(graph.nodes.map((node, index) => [node.id, index]));
  graph.edgeIndex = new Map(graph.edges.map((edge, index) => [edge.id, index]));
  graph.edgesByNodeId = new Map(graph.nodes.map((node) => [node.id, []]));
  graph.edgesByPortId = new Map();

  for (const edge of graph.edges) {
    graph.edgesByNodeId.get(edge.from.nodeId)?.push(edge.id);
    graph.edgesByNodeId.get(edge.to.nodeId)?.push(edge.id);
    graph.edgesByPortId.set(`${edge.from.nodeId}:out:${edge.from.portSlot}`, edge.id);
    graph.edgesByPortId.set(`${edge.to.nodeId}:in:${edge.to.portSlot}`, edge.id);
  }

  return graph;
}

export function applyGraphPatch(graph, patch = {}) {
  const removedNodes = new Set(patch.removedNodes ?? []);
  const removedEdges = new Set(patch.removedEdges ?? []);
  const updatedEdges = new Map();

  if (removedNodes.size > 0) {
    for (const edge of graph.edges) {
      if (removedNodes.has(edge.from.nodeId) || removedNodes.has(edge.to.nodeId)) {
        removedEdges.add(edge.id);
      }
    }
  }

  if (removedEdges.size > 0) {
    graph.edges = graph.edges.filter((edge) => !removedEdges.has(edge.id));
  }

  if (removedNodes.size > 0) {
    graph.nodes = graph.nodes.filter((node) => !removedNodes.has(node.id));
  }

  if (Array.isArray(patch.addedNodes)) {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    for (const node of patch.addedNodes) {
      byId.set(node.id, cloneCompiledNode(node));
    }

    graph.nodes = Array.from(byId.values());
  }

  if (Array.isArray(patch.addedEdges)) {
    const byId = new Map(graph.edges.map((edge) => [edge.id, edge]));

    for (const edge of patch.addedEdges) {
      byId.set(edge.id, cloneCompiledEdge(edge));
    }

    graph.edges = Array.from(byId.values());
  }

  if (Array.isArray(patch.updatedEdges)) {
    for (const change of patch.updatedEdges) {
      const edge = graph.edges.find((entry) => entry.id === change.edgeId);

      if (!edge) {
        continue;
      }

      updatedEdges.set(change.edgeId, {
        previousDelay: edge.delay,
        nextDelay: change.delay,
      });
      edge.delay = change.delay;
    }
  }

  if (Array.isArray(patch.updatedParams)) {
    for (const change of patch.updatedParams) {
      const node = graph.nodes.find((entry) => entry.id === change.nodeId);

      if (!node) {
        continue;
      }

      node.param = change.param;
    }
  }

  if (Array.isArray(patch.nodeOrder) && patch.nodeOrder.length > 0) {
    sortByNextOrder(graph.nodes, createOrderIndex(patch.nodeOrder));
  }

  if (Array.isArray(patch.edgeOrder) && patch.edgeOrder.length > 0) {
    sortByNextOrder(graph.edges, createOrderIndex(patch.edgeOrder));
  }

  reindexCompiledGraph(graph);

  return {
    removedNodes,
    removedEdges,
    updatedEdges,
  };
}

function sameNodeShape(left, right) {
  return (
    left.type === right.type &&
    left.inputs === right.inputs &&
    left.outputs === right.outputs &&
    left.controlPorts === right.controlPorts
  );
}

function sameEdgeShape(left, right) {
  return (
    left.from.nodeId === right.from.nodeId &&
    left.from.portSlot === right.from.portSlot &&
    left.to.nodeId === right.to.nodeId &&
    left.to.portSlot === right.to.portSlot &&
    left.role === right.role
  );
}

export function createCompiledGraphPatch(previousGraph, nextGraph) {
  const previousNodes = new Map((previousGraph?.nodes ?? []).map((node) => [node.id, node]));
  const nextNodes = new Map((nextGraph?.nodes ?? []).map((node) => [node.id, node]));
  const previousEdges = new Map((previousGraph?.edges ?? []).map((edge) => [edge.id, edge]));
  const nextEdges = new Map((nextGraph?.edges ?? []).map((edge) => [edge.id, edge]));

  const removedNodes = [];
  const addedNodes = [];
  const updatedParams = [];
  const removedEdges = [];
  const addedEdges = [];
  const updatedEdges = [];

  for (const [nodeId, previousNode] of previousNodes.entries()) {
    const nextNode = nextNodes.get(nodeId);

    if (!nextNode) {
      removedNodes.push(nodeId);
      continue;
    }

    if (!sameNodeShape(previousNode, nextNode)) {
      removedNodes.push(nodeId);
      addedNodes.push(nextNode);
      continue;
    }

    if (previousNode.param !== nextNode.param) {
      updatedParams.push({
        nodeId,
        param: nextNode.param,
      });
    }
  }

  for (const [nodeId, nextNode] of nextNodes.entries()) {
    if (!previousNodes.has(nodeId)) {
      addedNodes.push(nextNode);
    }
  }

  const removedNodeSet = new Set(removedNodes);

  for (const [edgeId, previousEdge] of previousEdges.entries()) {
    const nextEdge = nextEdges.get(edgeId);

    if (!nextEdge) {
      removedEdges.push(edgeId);
      continue;
    }

    if (
      removedNodeSet.has(previousEdge.from.nodeId) ||
      removedNodeSet.has(previousEdge.to.nodeId)
    ) {
      continue;
    }

    if (!sameEdgeShape(previousEdge, nextEdge)) {
      removedEdges.push(edgeId);
      addedEdges.push(nextEdge);
      continue;
    }

    if (previousEdge.delay !== nextEdge.delay) {
      updatedEdges.push({
        edgeId,
        delay: nextEdge.delay,
      });
    }
  }

  for (const [edgeId, nextEdge] of nextEdges.entries()) {
    if (!previousEdges.has(edgeId)) {
      addedEdges.push(nextEdge);
    }
  }

  return {
    removedNodes,
    removedEdges,
    addedNodes,
    addedEdges,
    updatedEdges,
    updatedParams,
    nodeOrder: (nextGraph?.nodes ?? []).map((node) => node.id),
    edgeOrder: (nextGraph?.edges ?? []).map((edge) => edge.id),
  };
}
