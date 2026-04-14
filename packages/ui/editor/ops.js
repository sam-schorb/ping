import {
  analyzeGroupDependencies,
  buildGraphIndexes,
  cloneGraphSnapshot,
  collectReferencedGroupClosure,
  isGroupBackedNodeType,
  rewriteGroupReferences,
} from "@ping/core";

import { getResolvedNodeDefinition } from "./geometry.js";

function clampDiscreteNodeValue(value, fallback = 1) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.min(8, Math.max(1, Math.round(numeric)));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }

  return value;
}

function createPortId(nodeId, direction, portSlot) {
  return `${nodeId}:${direction}:${portSlot}`;
}

function normalizeConsecutiveDuplicateCorners(manualCorners = []) {
  const normalized = [];

  for (const point of manualCorners) {
    const roundedPoint = {
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
    const previousPoint = normalized[normalized.length - 1];

    if (
      previousPoint &&
      previousPoint.x === roundedPoint.x &&
      previousPoint.y === roundedPoint.y
    ) {
      continue;
    }

    normalized.push(roundedPoint);
  }

  return normalized;
}

function normalizeNodeIdSet(nodeIds) {
  return Array.from(
    new Set((Array.isArray(nodeIds) ? nodeIds : []).filter((nodeId) => typeof nodeId === "string")),
  );
}

function resolveIndexes(snapshot, registry) {
  return buildGraphIndexes(snapshot, (type) => registry.getNodeDefinition(type)).indexes;
}

function createNodeLabel(node, definition) {
  return node.name || definition.label || node.type;
}

function createPortLabel(node, definition, kind, portSlot) {
  const label = createNodeLabel(node, definition);
  return `${label} ${kind} ${portSlot + 1}`;
}

export function createUndoOutput(snapshot, reason) {
  return {
    type: "ui/undoSnapshot",
    payload: {
      snapshot: cloneValue(snapshot),
      reason,
    },
  };
}

export function createGraphOpsOutput(ops, reason) {
  return {
    type: "graph/ops",
    payload: {
      ops,
      ...(reason ? { reason } : {}),
    },
  };
}

export function createAddNodeOp(node) {
  return {
    type: "addNode",
    payload: {
      node,
    },
  };
}

export function createNodeRecord(id, definition, worldPos) {
  return {
    id,
    type: definition.type,
    pos: {
      x: Math.round(worldPos.x),
      y: Math.round(worldPos.y),
    },
    rot: 0,
    params: definition.hasParam ? { param: clampDiscreteNodeValue(definition.defaultParam, 1) } : {},
  };
}

export function createMoveNodeOp(nodeId, pos) {
  return {
    type: "moveNode",
    payload: {
      id: nodeId,
      pos: {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
      },
    },
  };
}

export function createRotateNodeOp(nodeId, rot) {
  return {
    type: "rotateNode",
    payload: {
      id: nodeId,
      rot,
    },
  };
}

export function createRenameNodeOp(nodeId, name) {
  return {
    type: "renameNode",
    payload: {
      id: nodeId,
      name,
    },
  };
}

export function createSetParamOp(nodeId, param) {
  return {
    type: "setParam",
    payload: {
      id: nodeId,
      param: clampDiscreteNodeValue(param, 1),
    },
  };
}

export function createEdgeRecord(id, from, to, manualCorners = []) {
  return {
    id,
    from: {
      nodeId: from.nodeId,
      portSlot: from.portSlot,
    },
    to: {
      nodeId: to.nodeId,
      portSlot: to.portSlot,
    },
    manualCorners: normalizeConsecutiveDuplicateCorners(manualCorners),
  };
}

export function normalizeEdgeEndpoints(from, to) {
  if (!from || !to) {
    return null;
  }

  if (from.direction === to.direction) {
    return null;
  }

  return {
    from: from.direction === "out" ? from : to,
    to: from.direction === "in" ? from : to,
  };
}

export function canCreateEdge(snapshot, registry, from, to) {
  const normalized = normalizeEdgeEndpoints(from, to);

  if (!normalized) {
    return false;
  }

  const resolvedFrom = normalized.from;
  const resolvedTo = normalized.to;

  if (resolvedFrom.nodeId === resolvedTo.nodeId && resolvedFrom.portSlot === resolvedTo.portSlot) {
    return false;
  }

  const indexes = resolveIndexes(snapshot, registry);

  return (
    !indexes.edgeByPortId.has(createPortId(resolvedFrom.nodeId, "out", resolvedFrom.portSlot)) &&
    !indexes.edgeByPortId.has(createPortId(resolvedTo.nodeId, "in", resolvedTo.portSlot))
  );
}

export function createDeleteSelectionOps(snapshot, selection) {
  if (selection.kind === "edge") {
    return [
      {
        type: "removeEdge",
        payload: { id: selection.edgeId },
      },
    ];
  }

  if (selection.kind === "corner") {
    return [
      {
        type: "removeCorner",
        payload: {
          edgeId: selection.edgeId,
          index: selection.cornerIndex,
        },
      },
    ];
  }

  if (selection.kind !== "node") {
    return [];
  }

  const connectedEdges = snapshot.edges
    .filter((edge) => edge.from.nodeId === selection.nodeId || edge.to.nodeId === selection.nodeId)
    .map((edge) => ({
      type: "removeEdge",
      payload: {
        id: edge.id,
      },
    }));

  return [
    ...connectedEdges,
    {
      type: "removeNode",
      payload: {
        id: selection.nodeId,
      },
    },
  ];
}

export function createDeleteNodeSetOps(snapshot, nodeIds) {
  const selectedIds = new Set(normalizeNodeIdSet(nodeIds));

  if (selectedIds.size === 0) {
    return [];
  }

  const removableEdges = snapshot.edges
    .filter((edge) => selectedIds.has(edge.from.nodeId) || selectedIds.has(edge.to.nodeId))
    .map((edge) => ({
      type: "removeEdge",
      payload: {
        id: edge.id,
      },
    }));

  const removableNodes = snapshot.nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => ({
      type: "removeNode",
      payload: {
        id: node.id,
      },
    }));

  return [...removableEdges, ...removableNodes];
}

export function createMoveNodeSetOps(startPositions, nextPositions) {
  const entries = normalizeNodeIdSet([
    ...Object.keys(startPositions ?? {}),
    ...Object.keys(nextPositions ?? {}),
  ]);

  return entries
    .map((nodeId) => {
      const startPos = startPositions?.[nodeId];
      const nextPos = nextPositions?.[nodeId];

      if (!startPos || !nextPos) {
        return null;
      }

      if (startPos.x === nextPos.x && startPos.y === nextPos.y) {
        return null;
      }

      return createMoveNodeOp(nodeId, nextPos);
    })
    .filter(Boolean);
}

function cloneGroupRecord(group) {
  return cloneGraphSnapshot({
    nodes: [],
    edges: [],
    groups: {
      [group.id]: group,
    },
  }).groups[group.id];
}

function getNodeSetBounds(nodes) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return nodes.reduce(
    (bounds, node) => ({
      minX: Math.min(bounds.minX, node.pos.x),
      minY: Math.min(bounds.minY, node.pos.y),
      maxX: Math.max(bounds.maxX, node.pos.x),
      maxY: Math.max(bounds.maxY, node.pos.y),
    }),
    {
      minX: nodes[0].pos.x,
      minY: nodes[0].pos.y,
      maxX: nodes[0].pos.x,
      maxY: nodes[0].pos.y,
    },
  );
}

function collectReferencedGroups(snapshot, nodes) {
  return (
    collectReferencedGroupClosure(
      snapshot.groups,
      nodes
        .filter((node) => isGroupBackedNodeType(node.type) && typeof node.groupRef === "string")
        .map((node) => node.groupRef),
    ) ?? {}
  );
}

function areGroupsEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createClipboardSubgraph(snapshot, nodeIds) {
  const normalizedNodeIds = normalizeNodeIdSet(nodeIds);
  const selectedIdSet = new Set(normalizedNodeIds);
  const nodes = snapshot.nodes
    .filter((node) => selectedIdSet.has(node.id))
    .map((node) => ({
      ...node,
      pos: { ...node.pos },
      params: { ...node.params },
    }));

  if (nodes.length === 0) {
    return null;
  }

  const edges = snapshot.edges
    .filter(
      (edge) => selectedIdSet.has(edge.from.nodeId) && selectedIdSet.has(edge.to.nodeId),
    )
    .map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
      manualCorners: (edge.manualCorners ?? []).map((point) => ({ ...point })),
    }));
  const bounds = getNodeSetBounds(nodes);

  return {
    schemaVersion: 1,
    bounds: {
      minX: bounds.minX,
      minY: bounds.minY,
      width: Math.max(0, bounds.maxX - bounds.minX),
      height: Math.max(0, bounds.maxY - bounds.minY),
    },
    nodes,
    edges,
    groups: collectReferencedGroups(snapshot, nodes),
  };
}

export function instantiateClipboardSubgraph({
  snapshot,
  payload,
  targetPosition,
  createId,
}) {
  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    return {
      ok: false,
      reason: "Clipboard payload does not contain any nodes.",
      ops: [],
      pastedNodeIds: [],
    };
  }

  if (typeof createId !== "function") {
    return {
      ok: false,
      reason: "Clipboard paste requires an id factory.",
      ops: [],
      pastedNodeIds: [],
    };
  }

  const groups = payload.groups ?? {};
  const groupIdMap = new Map();
  const importedGroupIds = new Set();

  for (const [groupId, group] of Object.entries(groups)) {
    if (!group || typeof group !== "object") {
      continue;
    }

    const existingGroup = snapshot.groups?.[groupId];

    if (existingGroup) {
      if (areGroupsEquivalent(existingGroup, group)) {
        groupIdMap.set(groupId, groupId);
        continue;
      }

      const nextGroupId = createId("group");
      groupIdMap.set(groupId, nextGroupId);
      importedGroupIds.add(nextGroupId);
      continue;
    }

    groupIdMap.set(groupId, groupId);
    importedGroupIds.add(groupId);
  }

  const remappedGroups = rewriteGroupReferences(groups, groupIdMap) ?? {};
  const dependencyAnalysis = analyzeGroupDependencies(remappedGroups);
  const orderedGroupIds = dependencyAnalysis.ok
    ? dependencyAnalysis.order
    : Object.keys(remappedGroups);
  const groupOps = orderedGroupIds
    .filter((groupId) => importedGroupIds.has(groupId))
    .map((groupId) => ({
    type: "addGroup",
    payload: {
      group: cloneGroupRecord(remappedGroups[groupId]),
    },
    }));

  const nodeIdMap = new Map();
  const edgeIdMap = new Map();
  const bounds = payload.bounds ?? getNodeSetBounds(payload.nodes);
  const offset = {
    x: Math.round((targetPosition?.x ?? bounds.minX) - bounds.minX),
    y: Math.round((targetPosition?.y ?? bounds.minY) - bounds.minY),
  };

  const nodes = payload.nodes.map((node) => {
    const nextId = createId("node");
    nodeIdMap.set(node.id, nextId);

    return {
      ...node,
      id: nextId,
      pos: {
        x: Math.round(node.pos.x + offset.x),
        y: Math.round(node.pos.y + offset.y),
      },
      params: { ...node.params },
      ...(node.groupRef
        ? {
            groupRef: groupIdMap.get(node.groupRef) ?? node.groupRef,
          }
        : {}),
    };
  });

  const edges = payload.edges.map((edge) => {
    const nextId = createId("edge");
    edgeIdMap.set(edge.id, nextId);

    return {
      ...edge,
      id: nextId,
      from: {
        nodeId: nodeIdMap.get(edge.from.nodeId) ?? edge.from.nodeId,
        portSlot: edge.from.portSlot,
      },
      to: {
        nodeId: nodeIdMap.get(edge.to.nodeId) ?? edge.to.nodeId,
        portSlot: edge.to.portSlot,
      },
      manualCorners: (edge.manualCorners ?? []).map((point) => ({ ...point })),
    };
  });

  return {
    ok: true,
    ops: [
      ...groupOps,
      ...nodes.map((node) => ({
        type: "addNode",
        payload: { node },
      })),
      ...edges.map((edge) => ({
        type: "addEdge",
        payload: { edge },
      })),
    ],
    pastedNodeIds: nodes.map((node) => node.id),
  };
}

function getConnectedNodeIds(edges) {
  const nodeIds = new Set();

  for (const edge of edges) {
    nodeIds.add(edge.from.nodeId);
    nodeIds.add(edge.to.nodeId);
  }

  return nodeIds;
}

function getNodeSignalInputCount(snapshot, node, registry) {
  return getResolvedNodeDefinition(snapshot, node, registry).inputs;
}

function getNodeOutputCount(snapshot, node, registry) {
  return getResolvedNodeDefinition(snapshot, node, registry).outputs;
}

function getControlCandidateKey(nodeId, targetPortSlot) {
  return `${nodeId}:${targetPortSlot}`;
}

function createInternalPortKey(nodeId, portSlot) {
  return `${nodeId}:${portSlot}`;
}

function createGroupMappingId(kind, entry) {
  if (kind === "controls") {
    return `control:${entry.nodeId}:slot:${entry.controlSlot}`;
  }

  return `${kind.slice(0, -1)}:${entry.nodeId}:${entry.portSlot}`;
}

function createControlCandidateLabel(label, definition, controlSlot) {
  if (definition.hasParam && (definition.controlPorts ?? 0) === 1 && controlSlot === 0) {
    return `${label} param`;
  }

  return `${label} control ${controlSlot + 1}`;
}

function buildControlCandidateEntries(snapshot, node, definition) {
  const label = createNodeLabel(node, definition);

  if (isGroupBackedNodeType(node.type) && typeof node.groupRef === "string") {
    const groupDefinition = snapshot.groups?.[node.groupRef];
    const signalInputs = definition.inputs ?? 0;

    return (groupDefinition?.controls ?? []).map((mapping, controlSlot) => ({
      id: createGroupMappingId("controls", { nodeId: node.id, controlSlot }),
      label: mapping.label ? `${label} ${mapping.label}` : `${label} control ${controlSlot + 1}`,
      nodeId: node.id,
      controlSlot,
      targetPortSlot: signalInputs + controlSlot,
    }));
  }

  if ((definition.controlPorts ?? 0) > 0) {
    return Array.from({ length: definition.controlPorts }, (_, controlSlot) => ({
      id: createGroupMappingId("controls", { nodeId: node.id, controlSlot }),
      label: createControlCandidateLabel(label, definition, controlSlot),
      nodeId: node.id,
      controlSlot,
      targetPortSlot: (definition.inputs ?? 0) + controlSlot,
    }));
  }

  return [];
}

function classifyControlCandidates(snapshot, node, definition, internalControlEdgeByKey) {
  const available = [];
  const unavailable = [];

  for (const entry of buildControlCandidateEntries(snapshot, node, definition)) {
    const targetKey = getControlCandidateKey(entry.nodeId, entry.targetPortSlot);
    const blockingEdge = internalControlEdgeByKey.get(targetKey);

    if (blockingEdge) {
      unavailable.push({
        ...entry,
        unavailableReason: "already driven internally",
        displaceInternalEdgeId: blockingEdge.id,
        restoreBucket: "unavailable",
      });
      continue;
    }

    available.push({
      ...entry,
      restoreBucket: "available",
    });
  }

  return {
    available,
    unavailable,
  };
}

export function buildGroupCandidates(snapshot, groupSelection, registry) {
  const selectedIds = new Set(groupSelection.nodeIds);
  const selectedNodes = snapshot.nodes.filter((node) => selectedIds.has(node.id));
  const touchingEdges = snapshot.edges.filter(
    (edge) => selectedIds.has(edge.from.nodeId) || selectedIds.has(edge.to.nodeId),
  );
  const internalEdges = touchingEdges.filter(
    (edge) => selectedIds.has(edge.from.nodeId) && selectedIds.has(edge.to.nodeId),
  );
  const connectedIds = getConnectedNodeIds(internalEdges);
  const effectiveNodes = selectedNodes.filter((node) => connectedIds.has(node.id));
  const effectiveNodeIds = new Set(effectiveNodes.map((node) => node.id));
  const effectiveEdges = touchingEdges.filter(
    (edge) => effectiveNodeIds.has(edge.from.nodeId) || effectiveNodeIds.has(edge.to.nodeId),
  );
  const internalOnlyEdges = effectiveEdges.filter(
    (edge) => effectiveNodeIds.has(edge.from.nodeId) && effectiveNodeIds.has(edge.to.nodeId),
  );

  const internalInputKeys = new Set(
    internalOnlyEdges.map((edge) => `${edge.to.nodeId}:${edge.to.portSlot}`),
  );
  const internalOutputKeys = new Set(
    internalOnlyEdges.map((edge) => `${edge.from.nodeId}:${edge.from.portSlot}`),
  );
  const internalControlEdgeByKey = new Map(
    internalOnlyEdges.map((edge) => [createInternalPortKey(edge.to.nodeId, edge.to.portSlot), edge]),
  );

  const inputs = [];
  const outputs = [];
  const controls = [];
  const unavailable = {
    controls: [],
  };
  const seenControls = new Set();

  for (const node of effectiveNodes) {
    const definition = getResolvedNodeDefinition(snapshot, node, registry);

    for (let portSlot = 0; portSlot < getNodeSignalInputCount(snapshot, node, registry); portSlot += 1) {
      const key = `${node.id}:${portSlot}`;

      if (!internalInputKeys.has(key)) {
        inputs.push({
          id: createGroupMappingId("inputs", { nodeId: node.id, portSlot }),
          label: createPortLabel(node, definition, "input", portSlot),
          nodeId: node.id,
          portSlot,
        });
      }
    }

    for (let portSlot = 0; portSlot < getNodeOutputCount(snapshot, node, registry); portSlot += 1) {
      const key = `${node.id}:${portSlot}`;

      if (!internalOutputKeys.has(key)) {
        outputs.push({
          id: createGroupMappingId("outputs", { nodeId: node.id, portSlot }),
          label: createPortLabel(node, definition, "output", portSlot),
          nodeId: node.id,
          portSlot,
        });
      }
    }

    const controlCandidates = classifyControlCandidates(
      snapshot,
      node,
      definition,
      internalControlEdgeByKey,
    );

    for (const entry of controlCandidates.available) {
      if (!seenControls.has(entry.id)) {
        seenControls.add(entry.id);
        controls.push(entry);
      }
    }

    for (const entry of controlCandidates.unavailable) {
      if (!seenControls.has(entry.id)) {
        seenControls.add(entry.id);
        unavailable.controls.push(entry);
      }
    }
  }

  return {
    nodes: effectiveNodes,
    edges: internalOnlyEdges,
    externalEdges: effectiveEdges.filter((edge) => !internalOnlyEdges.includes(edge)),
    inputs,
    outputs,
    controls,
    unavailable,
  };
}

export function buildCreateGroupOps({
  snapshot,
  registry,
  groupSelection,
  groupId,
  groupName,
  groupNodeId,
  groupPosition,
  mappings,
  preserveInternalCableDelays = false,
}) {
  const candidates = buildGroupCandidates(snapshot, groupSelection, registry);

  if (candidates.nodes.length === 0) {
    return {
      ok: false,
      reason: "No internally connected nodes were selected.",
      ops: [],
    };
  }

  const selectedIds = new Set(candidates.nodes.map((node) => node.id));
  const inputs = mappings?.inputs?.length ? mappings.inputs : candidates.inputs;
  const outputs = mappings?.outputs?.length ? mappings.outputs : candidates.outputs;
  const controls = mappings?.controls?.length ? mappings.controls : candidates.controls;
  const displacedInternalEdgeIds = new Set(
    controls
      .map((entry) => entry.displaceInternalEdgeId)
      .filter((edgeId) => typeof edgeId === "string" && edgeId.length > 0),
  );
  const inputLookup = new Map(inputs.map((entry, index) => [`${entry.nodeId}:${entry.portSlot}`, index]));
  const outputLookup = new Map(outputs.map((entry, index) => [`${entry.nodeId}:${entry.portSlot}`, index]));
  const controlLookup = new Map(
    controls.map((entry, index) => [getControlCandidateKey(entry.nodeId, entry.targetPortSlot), index]),
  );
  const bbox = candidates.nodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.pos.x),
      minY: Math.min(acc.minY, node.pos.y),
      maxX: Math.max(acc.maxX, node.pos.x),
      maxY: Math.max(acc.maxY, node.pos.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const groupNode = {
    id: groupNodeId,
    type: "group",
    groupRef: groupId,
    pos: {
      x:
        groupPosition?.x !== undefined
          ? Math.round(groupPosition.x)
          : Math.round((bbox.minX + bbox.maxX) / 2),
      y:
        groupPosition?.y !== undefined
          ? Math.round(groupPosition.y)
          : Math.round((bbox.minY + bbox.maxY) / 2),
    },
    rot: 0,
    params: {},
  };

  const group = {
    id: groupId,
    name: groupName,
    preserveInternalCableDelays,
    graph: {
      nodes: candidates.nodes.map((node) => cloneValue(node)),
      edges: candidates.edges
        .filter((edge) => !displacedInternalEdgeIds.has(edge.id))
        .map((edge) => cloneValue(edge)),
    },
    inputs: inputs.map((entry) => ({
      label: entry.label,
      nodeId: entry.nodeId,
      portSlot: entry.portSlot,
    })),
    outputs: outputs.map((entry) => ({
      label: entry.label,
      nodeId: entry.nodeId,
      portSlot: entry.portSlot,
    })),
    controls: controls.map((entry) => ({
      label: entry.label,
      nodeId: entry.nodeId,
      controlSlot: entry.controlSlot,
    })),
  };

  const removedEdges = candidates.externalEdges.concat(candidates.edges);
  const rewiredEdges = [];

  for (const edge of candidates.externalEdges) {
    const sourceInside = selectedIds.has(edge.from.nodeId);
    const targetInside = selectedIds.has(edge.to.nodeId);

    if (targetInside && !sourceInside) {
      const targetSlot = inputLookup.get(`${edge.to.nodeId}:${edge.to.portSlot}`);

      if (targetSlot !== undefined) {
        rewiredEdges.push({
          id: `${edge.id}:group-in`,
          from: cloneValue(edge.from),
          to: { nodeId: groupNodeId, portSlot: targetSlot },
          manualCorners: [],
        });
        continue;
      }

      const controlSlot = controlLookup.get(getControlCandidateKey(edge.to.nodeId, edge.to.portSlot));

      if (controlSlot !== undefined) {
        rewiredEdges.push({
          id: `${edge.id}:group-control`,
          from: cloneValue(edge.from),
          to: { nodeId: groupNodeId, portSlot: inputs.length + controlSlot },
          manualCorners: [],
        });
      }

      continue;
    }

    if (sourceInside && !targetInside) {
      const outputSlot = outputLookup.get(`${edge.from.nodeId}:${edge.from.portSlot}`);

      if (outputSlot !== undefined) {
        rewiredEdges.push({
          id: `${edge.id}:group-out`,
          from: { nodeId: groupNodeId, portSlot: outputSlot },
          to: cloneValue(edge.to),
          manualCorners: [],
        });
      }
    }
  }

  const ops = [
    {
      type: "addGroup",
      payload: { group },
    },
    {
      type: "addNode",
      payload: { node: groupNode },
    },
    ...removedEdges.map((edge) => ({
      type: "removeEdge",
      payload: { id: edge.id },
    })),
    ...candidates.nodes.map((node) => ({
      type: "removeNode",
      payload: { id: node.id },
    })),
    ...rewiredEdges.map((edge) => ({
      type: "addEdge",
      payload: { edge },
    })),
  ];

  return {
    ok: true,
    group,
    groupNode,
    ops,
  };
}

export function buildUpdateGroupOps({
  snapshot,
  groupId,
  groupName,
  mappings,
  preserveInternalCableDelays,
}) {
  const existingGroup = snapshot.groups?.[groupId];

  if (!existingGroup) {
    return {
      ok: false,
      reason: `Group "${groupId}" was not found.`,
      ops: [],
    };
  }

  const nextGroup = {
    id: existingGroup.id,
    name: groupName,
    preserveInternalCableDelays:
      preserveInternalCableDelays !== undefined
        ? preserveInternalCableDelays
        : existingGroup.preserveInternalCableDelays === true,
    graph: {
      nodes: cloneValue(existingGroup.graph.nodes),
      edges: cloneValue(existingGroup.graph.edges).filter(
        (edge) =>
          !(
            mappings?.controls?.some(
              (entry) =>
                typeof entry.displaceInternalEdgeId === "string" &&
                entry.displaceInternalEdgeId === edge.id,
            ) ?? false
          ),
      ),
    },
    inputs: (mappings?.inputs ?? existingGroup.inputs).map((entry) => ({
      ...(entry.label !== undefined ? { label: entry.label } : {}),
      nodeId: entry.nodeId,
      portSlot: entry.portSlot,
    })),
    outputs: (mappings?.outputs ?? existingGroup.outputs).map((entry) => ({
      ...(entry.label !== undefined ? { label: entry.label } : {}),
      nodeId: entry.nodeId,
      portSlot: entry.portSlot,
    })),
    controls: (mappings?.controls ?? existingGroup.controls).map((entry) => ({
      ...(entry.label !== undefined ? { label: entry.label } : {}),
      nodeId: entry.nodeId,
      controlSlot: entry.controlSlot,
    })),
  };

  const currentCounts = {
    inputs: existingGroup.inputs.length,
    outputs: existingGroup.outputs.length,
    controls: existingGroup.controls.length,
  };
  const nextCounts = {
    inputs: nextGroup.inputs.length,
    outputs: nextGroup.outputs.length,
    controls: nextGroup.controls.length,
  };
  const instanceIds = new Set(
    snapshot.nodes
      .filter((node) => isGroupBackedNodeType(node.type) && node.groupRef === groupId)
      .map((node) => node.id),
  );
  const controlEdgeUpdates = [];

  for (const edge of snapshot.edges) {
    if (instanceIds.has(edge.to.nodeId)) {
      if (edge.to.portSlot < currentCounts.inputs) {
        if (edge.to.portSlot >= nextCounts.inputs) {
          return {
            ok: false,
            reason: `Group "${groupId}" still has instance input edge "${edge.id}" on a removed slot.`,
            ops: [],
          };
        }

        continue;
      }

      const controlSlot = edge.to.portSlot - currentCounts.inputs;

      if (controlSlot < 0 || controlSlot >= currentCounts.controls) {
        return {
          ok: false,
          reason: `Group "${groupId}" has an invalid incoming instance edge "${edge.id}".`,
          ops: [],
        };
      }

      if (controlSlot >= nextCounts.controls) {
        return {
          ok: false,
          reason: `Group "${groupId}" still has instance control edge "${edge.id}" on a removed slot.`,
          ops: [],
        };
      }

      const nextPortSlot = nextCounts.inputs + controlSlot;

      if (nextPortSlot !== edge.to.portSlot) {
        controlEdgeUpdates.push({
          previous: edge,
          next: {
            ...cloneValue(edge),
            to: {
              ...edge.to,
              portSlot: nextPortSlot,
            },
          },
        });
      }
    }

    if (instanceIds.has(edge.from.nodeId) && edge.from.portSlot >= nextCounts.outputs) {
      return {
        ok: false,
        reason: `Group "${groupId}" still has instance output edge "${edge.id}" on a removed slot.`,
        ops: [],
      };
    }
  }

  return {
    ok: true,
    group: nextGroup,
    ops: [
      ...controlEdgeUpdates.map((entry) => ({
        type: "removeEdge",
        payload: {
          id: entry.previous.id,
        },
      })),
      {
        type: "updateGroup",
        payload: {
          group: nextGroup,
        },
      },
      ...controlEdgeUpdates.map((entry) => ({
        type: "addEdge",
        payload: {
          edge: entry.next,
        },
      })),
    ],
  };
}

export function canRemoveGroup(snapshot, groupId) {
  return !snapshot.nodes.some(
    (node) => isGroupBackedNodeType(node.type) && node.groupRef === groupId,
  );
}
