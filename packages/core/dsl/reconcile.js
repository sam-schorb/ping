import { normalizeGroupDefinition } from "../graph/snapshot.js";
import { routeEdge } from "../routing/route-edge.js";
import {
  DSL_ERROR_CODES,
  createDslIssue,
} from "./errors.js";

const RECONCILE_SHIFT_X = 8;

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneNode(node) {
  return {
    ...node,
    pos: clonePoint(node.pos),
    params: { ...node.params },
  };
}

function cloneEdge(edge) {
  return {
    ...edge,
    from: { ...edge.from },
    to: { ...edge.to },
    manualCorners: edge.manualCorners.map(clonePoint),
  };
}

function cloneGroup(group) {
  return {
    ...group,
    graph: {
      nodes: group.graph.nodes.map(cloneNode),
      edges: group.graph.edges.map(cloneEdge),
    },
    inputs: group.inputs.map((mapping) => ({ ...mapping })),
    outputs: group.outputs.map((mapping) => ({ ...mapping })),
    controls: group.controls.map((mapping) => ({ ...mapping })),
    ...(group.dsl ? { dsl: { ...group.dsl } } : {}),
  };
}

function ensureRegistryAccess(registry) {
  if (typeof registry?.getNodeDefinition !== "function") {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.RECONCILE_INVALID_REGISTRY,
        "DSL reconciliation requires registry.getNodeDefinition().",
      ),
    };
  }

  return { registry };
}

function normalizeExistingGroup(existingGroup, registry, options = {}) {
  const normalized = normalizeGroupDefinition(
    existingGroup,
    registry.getNodeDefinition,
    {
      source: "load",
      groups: options.groups ?? {},
      validateGroupRef: true,
    },
  );

  if (normalized.issue) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.RECONCILE_INVALID_GROUP,
        normalized.issue.message ?? "Existing group is invalid for DSL reconciliation.",
        {
          groupId: existingGroup?.id,
        },
      ),
    };
  }

  return {
    group: normalized.group,
  };
}

function collectBoundaryRoles(group) {
  const rolesByNode = new Map();

  function ensure(nodeId) {
    if (!rolesByNode.has(nodeId)) {
      rolesByNode.set(nodeId, {
        inputs: [],
        controls: [],
        outputs: [],
      });
    }

    return rolesByNode.get(nodeId);
  }

  for (const mapping of group.inputs) {
    ensure(mapping.nodeId).inputs.push(mapping.portSlot);
  }

  for (const mapping of group.controls) {
    ensure(mapping.nodeId).controls.push(mapping.controlSlot);
  }

  for (const mapping of group.outputs) {
    ensure(mapping.nodeId).outputs.push(mapping.portSlot);
  }

  for (const roles of rolesByNode.values()) {
    roles.inputs.sort((left, right) => left - right);
    roles.controls.sort((left, right) => left - right);
    roles.outputs.sort((left, right) => left - right);
  }

  return rolesByNode;
}

function buildStructuralSignature(group, node, registry, boundaryRolesByNode) {
  const definition = registry.getNodeDefinition(node.type);
  const boundaryRoles = boundaryRolesByNode.get(node.id) ?? {
    inputs: [],
    controls: [],
    outputs: [],
  };
  const incomingSignalSlots = [];
  const incomingControlSlots = [];
  const outgoingSlots = [];

  for (const edge of group.graph.edges) {
    if (edge.from.nodeId === node.id) {
      outgoingSlots.push(edge.from.portSlot);
    }

    if (edge.to.nodeId !== node.id) {
      continue;
    }

    if (edge.to.portSlot < definition.inputs) {
      incomingSignalSlots.push(edge.to.portSlot);
    } else {
      incomingControlSlots.push(edge.to.portSlot - definition.inputs);
    }
  }

  incomingSignalSlots.sort((left, right) => left - right);
  incomingControlSlots.sort((left, right) => left - right);
  outgoingSlots.sort((left, right) => left - right);

  return JSON.stringify({
    type: node.type,
    storedParam:
      typeof node.params?.param === "number" ? node.params.param : null,
    incomingSignalSlots,
    incomingControlSlots,
    outgoingSlots,
    boundaryInputs: boundaryRoles.inputs,
    boundaryControls: boundaryRoles.controls,
    boundaryOutputs: boundaryRoles.outputs,
  });
}

function mapUniqueNodesByName(group) {
  const counts = new Map();

  for (const node of group.graph.nodes) {
    if (typeof node.name !== "string" || node.name.trim() === "") {
      continue;
    }

    const key = `${node.type}:${node.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const unique = new Map();

  for (const node of group.graph.nodes) {
    if (typeof node.name !== "string" || node.name.trim() === "") {
      continue;
    }

    const key = `${node.type}:${node.name}`;

    if (counts.get(key) === 1) {
      unique.set(key, node);
    }
  }

  return unique;
}

function groupNodesBySignature(group, registry) {
  const boundaryRolesByNode = collectBoundaryRoles(group);
  const groups = new Map();

  for (const node of group.graph.nodes) {
    const signature = buildStructuralSignature(group, node, registry, boundaryRolesByNode);

    if (!groups.has(signature)) {
      groups.set(signature, []);
    }

    groups.get(signature).push(node);
  }

  return groups;
}

function buildTypeParamKey(node) {
  return JSON.stringify({
    type: node.type,
    storedParam:
      typeof node.params?.param === "number" ? node.params.param : null,
  });
}

function groupNodesByTypeParam(group) {
  const groups = new Map();

  for (const node of group.graph.nodes) {
    const key = buildTypeParamKey(node);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(node);
  }

  return groups;
}

function matchNodes(freshGroup, existingGroup, registry) {
  const matchesByFreshId = new Map();
  const usedExistingIds = new Set();
  const freshUniqueNames = mapUniqueNodesByName(freshGroup);
  const existingUniqueNames = mapUniqueNodesByName(existingGroup);

  for (const freshNode of freshGroup.graph.nodes) {
    if (typeof freshNode.name !== "string" || freshNode.name.trim() === "") {
      continue;
    }

    const key = `${freshNode.type}:${freshNode.name}`;
    const uniqueFreshNode = freshUniqueNames.get(key);
    const existingNode = existingUniqueNames.get(key);

    if (
      uniqueFreshNode?.id === freshNode.id &&
      existingNode &&
      !usedExistingIds.has(existingNode.id)
    ) {
      matchesByFreshId.set(freshNode.id, existingNode);
      usedExistingIds.add(existingNode.id);
    }
  }

  const freshBySignature = groupNodesBySignature(freshGroup, registry);
  const existingBySignature = groupNodesBySignature(existingGroup, registry);
  const freshByTypeParam = groupNodesByTypeParam(freshGroup);
  const existingByTypeParam = groupNodesByTypeParam(existingGroup);

  for (const freshNode of freshGroup.graph.nodes) {
    if (matchesByFreshId.has(freshNode.id)) {
      continue;
    }

    const signature = buildStructuralSignature(
      freshGroup,
      freshNode,
      registry,
      collectBoundaryRoles(freshGroup),
    );
    const freshGroupNodes = (freshBySignature.get(signature) ?? []).filter(
      (node) => !matchesByFreshId.has(node.id),
    );
    const existingGroupNodes = (existingBySignature.get(signature) ?? []).filter(
      (node) => !usedExistingIds.has(node.id),
    );

    if (freshGroupNodes.length === 1 && existingGroupNodes.length === 1) {
      matchesByFreshId.set(freshNode.id, existingGroupNodes[0]);
      usedExistingIds.add(existingGroupNodes[0].id);
    }
  }

  for (const freshNode of freshGroup.graph.nodes) {
    if (matchesByFreshId.has(freshNode.id)) {
      continue;
    }

    const key = buildTypeParamKey(freshNode);
    const freshGroupNodes = (freshByTypeParam.get(key) ?? []).filter(
      (node) => !matchesByFreshId.has(node.id),
    );
    const existingGroupNodes = (existingByTypeParam.get(key) ?? []).filter(
      (node) => !usedExistingIds.has(node.id),
    );

    if (freshGroupNodes.length === 1 && existingGroupNodes.length === 1) {
      matchesByFreshId.set(freshNode.id, existingGroupNodes[0]);
      usedExistingIds.add(existingGroupNodes[0].id);
    }
  }

  return matchesByFreshId;
}

function positionsEqual(left, right) {
  return left.x === right.x && left.y === right.y;
}

function shiftUnmatchedNodes(nodes, matchedExistingIds) {
  const occupied = new Set(
    nodes
      .filter((node) => matchedExistingIds.has(node.id))
      .map((node) => `${node.pos.x}:${node.pos.y}`),
  );

  for (const node of nodes) {
    if (matchedExistingIds.has(node.id)) {
      continue;
    }

    let x = node.pos.x;
    const y = node.pos.y;

    while (occupied.has(`${x}:${y}`)) {
      x += RECONCILE_SHIFT_X;
    }

    node.pos = { x, y };
    occupied.add(`${x}:${y}`);
  }
}

function edgeRole(edge, nodesById, registry) {
  const targetNode = nodesById.get(edge.to.nodeId);
  const definition = registry.getNodeDefinition(targetNode.type);

  return edge.to.portSlot < definition.inputs ? "signal" : "control";
}

function tryRouteEdge(snapshot, edgeId, registry) {
  try {
    routeEdge(edgeId, snapshot.graph ?? snapshot, registry);
    return { ok: true };
  } catch (error) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.RECONCILE_ROUTE_FAIL,
        error?.message ?? `Edge "${edgeId}" could not be routed during DSL reconciliation.`,
        {
          edgeId,
        },
      ),
    };
  }
}

function buildFinalEdges(freshGroup, existingGroup, finalNodes, freshToFinalNodeId, registry) {
  const existingNodesById = new Map(existingGroup.graph.nodes.map((node) => [node.id, node]));
  const finalNodesById = new Map(finalNodes.map((node) => [node.id, node]));
  const freshNodesById = new Map(freshGroup.graph.nodes.map((node) => [node.id, node]));
  const existingEdgeByKey = new Map();
  const usedExistingEdgeIds = new Set();

  for (const edge of existingGroup.graph.edges) {
    const key = `${edge.from.nodeId}:${edge.from.portSlot}->${edge.to.nodeId}:${edge.to.portSlot}:${edgeRole(
      edge,
      existingNodesById,
      registry,
    )}`;
    existingEdgeByKey.set(key, edge);
  }

  return freshGroup.graph.edges.map((edge) => {
    const fromNodeId = freshToFinalNodeId.get(edge.from.nodeId) ?? edge.from.nodeId;
    const toNodeId = freshToFinalNodeId.get(edge.to.nodeId) ?? edge.to.nodeId;
    const key = `${fromNodeId}:${edge.from.portSlot}->${toNodeId}:${edge.to.portSlot}:${edgeRole(
      {
        ...edge,
        from: { ...edge.from, nodeId: fromNodeId },
        to: { ...edge.to, nodeId: toNodeId },
      },
      finalNodesById,
      registry,
    )}`;
    const existingEdge = existingEdgeByKey.get(key);
    const finalEdge = {
      ...cloneEdge(edge),
      from: {
        nodeId: fromNodeId,
        portSlot: edge.from.portSlot,
      },
      to: {
        nodeId: toNodeId,
        portSlot: edge.to.portSlot,
      },
    };
    const sourceFreshNode = freshNodesById.get(edge.from.nodeId);
    const targetFreshNode = freshNodesById.get(edge.to.nodeId);
    const sourceFinalNode = finalNodesById.get(fromNodeId);
    const targetFinalNode = finalNodesById.get(toNodeId);
    const canKeepFreshCorners =
      positionsEqual(sourceFreshNode.pos, sourceFinalNode.pos) &&
      positionsEqual(targetFreshNode.pos, targetFinalNode.pos);

    if (existingEdge && !usedExistingEdgeIds.has(existingEdge.id)) {
      usedExistingEdgeIds.add(existingEdge.id);
      finalEdge.id = existingEdge.id;

      if (
        existingNodesById.has(existingEdge.from.nodeId) &&
        existingNodesById.has(existingEdge.to.nodeId)
      ) {
        finalEdge.manualCorners = existingEdge.manualCorners.map(clonePoint);
        finalEdge.__preservedCorners = true;
        return finalEdge;
      }
    }

    if (!canKeepFreshCorners) {
      finalEdge.manualCorners = [];
    }

    return finalEdge;
  });
}

function validateAndRepairEdges(group, registry) {
  for (const edge of group.graph.edges) {
    const routed = tryRouteEdge(group, edge.id, registry);

    if (routed.ok) {
      delete edge.__preservedCorners;
      continue;
    }

    if (edge.__preservedCorners || edge.manualCorners.length > 0) {
      edge.manualCorners = [];
      const retried = tryRouteEdge(group, edge.id, registry);

      if (retried.ok) {
        delete edge.__preservedCorners;
        continue;
      }

      return retried;
    }

    return routed;
  }

  return { ok: true };
}

function remapBoundaryMappings(mappings, freshToFinalNodeId, key) {
  return mappings.map((mapping) => ({
    ...mapping,
    nodeId: freshToFinalNodeId.get(mapping.nodeId) ?? mapping.nodeId,
    ...(key === "inputs" || key === "outputs" ? { portSlot: mapping.portSlot } : {}),
    ...(key === "controls" ? { controlSlot: mapping.controlSlot } : {}),
  }));
}

export function reconcileDslGroup(freshGroup, existingGroup, registry, options = {}) {
  const registryAccess = ensureRegistryAccess(registry);

  if (registryAccess.issue) {
    return {
      ok: false,
      errors: [registryAccess.issue],
    };
  }

  if (!existingGroup) {
    return {
      ok: true,
      group: cloneGroup(freshGroup),
    };
  }

  const normalizedExisting = normalizeExistingGroup(existingGroup, registry, options);

  if (normalizedExisting.issue) {
    return {
      ok: false,
      errors: [normalizedExisting.issue],
    };
  }

  const nextGroup = cloneGroup(freshGroup);
  const matchesByFreshId = matchNodes(nextGroup, normalizedExisting.group, registry);
  const freshToFinalNodeId = new Map();
  const matchedExistingIds = new Set();

  nextGroup.graph.nodes = nextGroup.graph.nodes.map((node) => {
    const matched = matchesByFreshId.get(node.id);

    if (!matched) {
      freshToFinalNodeId.set(node.id, node.id);
      return node;
    }

    matchedExistingIds.add(matched.id);
    freshToFinalNodeId.set(node.id, matched.id);

    return {
      ...node,
      id: matched.id,
      pos: clonePoint(matched.pos),
      rot: matched.rot,
    };
  });

  shiftUnmatchedNodes(nextGroup.graph.nodes, matchedExistingIds);
  nextGroup.graph.edges = buildFinalEdges(
    freshGroup,
    normalizedExisting.group,
    nextGroup.graph.nodes,
    freshToFinalNodeId,
    registry,
  );
  nextGroup.inputs = remapBoundaryMappings(nextGroup.inputs, freshToFinalNodeId, "inputs");
  nextGroup.outputs = remapBoundaryMappings(nextGroup.outputs, freshToFinalNodeId, "outputs");
  nextGroup.controls = remapBoundaryMappings(nextGroup.controls, freshToFinalNodeId, "controls");

  const routed = validateAndRepairEdges(nextGroup, registry);

  if (routed.issue) {
    return {
      ok: false,
      errors: [routed.issue],
    };
  }

  for (const edge of nextGroup.graph.edges) {
    delete edge.__preservedCorners;
  }

  return {
    ok: true,
    group: nextGroup,
  };
}
