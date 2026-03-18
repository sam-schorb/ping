import { GROUP_NODE_TYPE, PORT_DIRECTIONS } from "../graph/constants.js";
import { buildGroupTemplates, instantiateGroupTemplate } from "./groups.js";
import { createDebugMaps } from "./debug.js";
import { BUILD_ERROR_CODES, createBuildIssue } from "./errors.js";
import {
  BUILD_EDGE_ROLES,
  createCompiledPortId,
  getDirectParamPortSlot,
  getInputRole,
  getOutputRole,
  normalizeEditorEdge,
  resolveNodeShape,
} from "./roles.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneStateValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneStateValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneStateValue(entry)]),
    );
  }

  return value;
}

function initializeNodeState(shape) {
  if (!shape.initState) {
    return {};
  }

  try {
    const state = shape.initState();
    return isPlainObject(state) ? cloneStateValue(state) : {};
  } catch {
    return {};
  }
}

function createCompiledNode(nodeEntry) {
  return {
    id: nodeEntry.id,
    type: nodeEntry.shape.type,
    param:
      typeof nodeEntry.sourceNode.params?.param === "number"
        ? nodeEntry.sourceNode.params.param
        : nodeEntry.shape.defaultParam,
    state: initializeNodeState(nodeEntry.shape),
    inputs: nodeEntry.shape.inputs,
    outputs: nodeEntry.shape.outputs,
    controlPorts: nodeEntry.shape.controlPorts,
  };
}

function createExpandedTarget(shape, mapping) {
  return {
    nodeId: mapping.nodeId,
    portSlot:
      mapping.virtualPortSlot !== undefined
        ? mapping.virtualPortSlot
        : mapping.portSlot,
  };
}

function pushDuplicatePortIssue(edge, issues, portId) {
  const [nodeId, , slotValue] = portId.split(":");
  const parsedSlot = Number(slotValue);

  issues.push(
    createBuildIssue(
      BUILD_ERROR_CODES.PORT_ALREADY_CONNECTED,
      `Edge "${edge.id}" reuses a compiled port that is already connected.`,
      {
        edgeId: edge.id,
        nodeId,
        ...(Number.isInteger(parsedSlot) ? { portSlot: parsedSlot } : {}),
      },
    ),
  );
}

function validateCompiledEdge(flatEdge, nodeEntryById, delays, issues) {
  const fromNode = nodeEntryById.get(flatEdge.from.nodeId);
  const toNode = nodeEntryById.get(flatEdge.to.nodeId);

  if (!fromNode) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.DANGLING_PORT,
        `Compiled edge "${flatEdge.id}" references missing source node "${flatEdge.from.nodeId}".`,
        {
          edgeId: flatEdge.id,
          nodeId: flatEdge.from.nodeId,
          ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
        },
      ),
    );
  }

  if (!toNode) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.DANGLING_PORT,
        `Compiled edge "${flatEdge.id}" references missing target node "${flatEdge.to.nodeId}".`,
        {
          edgeId: flatEdge.id,
          nodeId: flatEdge.to.nodeId,
          ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
        },
      ),
    );
  }

  if (!fromNode || !toNode) {
    return null;
  }

  if (getOutputRole(fromNode.shape, flatEdge.from.portSlot) !== BUILD_EDGE_ROLES.SIGNAL) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.PORT_SLOT_INVALID,
        `Compiled edge "${flatEdge.id}" references invalid output port ${flatEdge.from.portSlot} on node "${flatEdge.from.nodeId}".`,
        {
          edgeId: flatEdge.id,
          nodeId: flatEdge.from.nodeId,
          portSlot: flatEdge.from.portSlot,
          ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
        },
      ),
    );
    return null;
  }

  if (flatEdge.role === BUILD_EDGE_ROLES.SIGNAL) {
    if (getInputRole(toNode.shape, flatEdge.to.portSlot) !== BUILD_EDGE_ROLES.SIGNAL) {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.ROLE_MISMATCH,
          `Compiled edge "${flatEdge.id}" must target a signal input port.`,
          {
            edgeId: flatEdge.id,
            nodeId: flatEdge.to.nodeId,
            portSlot: flatEdge.to.portSlot,
            ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
          },
        ),
      );
      return null;
    }
  } else if (flatEdge.role === BUILD_EDGE_ROLES.CONTROL) {
    const inputRole = getInputRole(toNode.shape, flatEdge.to.portSlot);
    const directParamPortSlot = getDirectParamPortSlot(toNode.shape);
    const isDirectParamTarget =
      flatEdge.to.portSlot === directParamPortSlot && toNode.shape.hasParam === true;

    if (inputRole !== BUILD_EDGE_ROLES.CONTROL && !isDirectParamTarget) {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.ROLE_MISMATCH,
          `Compiled edge "${flatEdge.id}" must target a control input or a direct mapped param.`,
          {
            edgeId: flatEdge.id,
            nodeId: flatEdge.to.nodeId,
            portSlot: flatEdge.to.portSlot,
            ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
          },
        ),
      );
      return null;
    }
  }

  if (!delays.has(flatEdge.delaySourceId)) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.MISSING_DELAY,
        `Edge "${flatEdge.id}" is missing a delay entry for "${flatEdge.delaySourceId}".`,
        {
          edgeId: flatEdge.id,
          ...(flatEdge.groupId ? { groupId: flatEdge.groupId } : {}),
        },
      ),
    );
    return null;
  }

  return {
    id: flatEdge.id,
    sourceId: flatEdge.sourceId,
    from: { ...flatEdge.from },
    to: { ...flatEdge.to },
    role: flatEdge.role,
    delaySourceId: flatEdge.delaySourceId,
    groupId: flatEdge.groupId,
  };
}

function resolveFlatSourceEndpoint(endpoint, groupInstances, templateMap) {
  const groupInstance = groupInstances.get(endpoint.nodeId);

  if (!groupInstance) {
    return {
      endpoint: {
        nodeId: endpoint.nodeId,
        portSlot: endpoint.portSlot,
      },
    };
  }

  const mapping = groupInstance.template.externalOutputs[endpoint.portSlot];

  if (!mapping) {
    return {
      issue: createBuildIssue(
        BUILD_ERROR_CODES.PORT_SLOT_INVALID,
        `Group node "${endpoint.nodeId}" output slot ${endpoint.portSlot} does not exist.`,
        {
          nodeId: endpoint.nodeId,
          portSlot: endpoint.portSlot,
          groupId: groupInstance.template.groupId,
        },
      ),
    };
  }

  return {
    endpoint: {
      nodeId: groupInstance.nodeIdMap.get(mapping.nodeId),
      portSlot: mapping.portSlot,
    },
  };
}

function resolveFlatTargetEndpoint(endpoint, groupInstances) {
  const groupInstance = groupInstances.get(endpoint.nodeId);

  if (!groupInstance) {
    return {
      endpoint: {
        nodeId: endpoint.nodeId,
        portSlot: endpoint.portSlot,
      },
    };
  }

  if (endpoint.portSlot < groupInstance.template.externalInputs.length) {
    const mapping = groupInstance.template.externalInputs[endpoint.portSlot];

    return {
      endpoint: {
        nodeId: groupInstance.nodeIdMap.get(mapping.nodeId),
        portSlot: mapping.portSlot,
      },
      role: BUILD_EDGE_ROLES.SIGNAL,
    };
  }

  const controlSlot = endpoint.portSlot - groupInstance.template.externalInputs.length;
  const controlMapping = groupInstance.template.controls[controlSlot];

  if (!controlMapping) {
    return {
      issue: createBuildIssue(
        BUILD_ERROR_CODES.PORT_SLOT_INVALID,
        `Group node "${endpoint.nodeId}" input slot ${endpoint.portSlot} does not exist.`,
        {
          nodeId: endpoint.nodeId,
          portSlot: endpoint.portSlot,
          groupId: groupInstance.template.groupId,
        },
      ),
    };
  }

  return {
    endpoint: {
      nodeId: groupInstance.nodeIdMap.get(controlMapping.nodeId),
      portSlot: controlMapping.virtualPortSlot,
    },
    role: BUILD_EDGE_ROLES.CONTROL,
  };
}

export function compileGraph(snapshot, registry, delays, options = {}) {
  const errors = [];
  const warnings = [];
  const topLevelNodeShapes = new Map();
  const groupTemplates = buildGroupTemplates(snapshot, registry, errors);

  for (const node of snapshot.nodes) {
    const shape = resolveNodeShape(node, snapshot.groups, registry, errors);

    if (shape) {
      topLevelNodeShapes.set(node.id, shape);
    }
  }

  const flatNodes = [];
  const groupInstances = new Map();
  const groupsById = new Map();

  for (const node of snapshot.nodes) {
    const shape = topLevelNodeShapes.get(node.id);

    if (!shape) {
      continue;
    }

    if (node.type !== GROUP_NODE_TYPE) {
      flatNodes.push({
        id: node.id,
        sourceId: node.id,
        sourceNode: {
          ...node,
          pos: { ...node.pos },
          params: { ...node.params },
        },
        shape,
      });
      continue;
    }

    const template = groupTemplates.get(node.groupRef);

    if (!template) {
      continue;
    }

    const expansion = instantiateGroupTemplate(node, template);
    groupInstances.set(node.id, {
      template,
      nodeIdMap: expansion.nodeIdMap,
    });
    groupsById.set(node.id, expansion.meta);
    flatNodes.push(...expansion.nodes);
  }

  const flatEdges = [];

  for (const node of snapshot.nodes) {
    if (node.type !== GROUP_NODE_TYPE) {
      continue;
    }

    const groupInstance = groupInstances.get(node.id);

    if (!groupInstance) {
      continue;
    }

    const expansion = instantiateGroupTemplate(node, groupInstance.template);
    flatEdges.push(...expansion.edges);
  }

  for (const edge of snapshot.edges) {
    const normalized = normalizeEditorEdge(edge, topLevelNodeShapes, errors);

    if (!normalized) {
      continue;
    }

    const sourceResolution = resolveFlatSourceEndpoint(
      normalized.edge.from,
      groupInstances,
      groupTemplates,
    );

    if (sourceResolution.issue) {
      errors.push({
        ...sourceResolution.issue,
        edgeId: edge.id,
      });
      continue;
    }

    const targetResolution = resolveFlatTargetEndpoint(
      normalized.edge.to,
      groupInstances,
    );

    if (targetResolution.issue) {
      errors.push({
        ...targetResolution.issue,
        edgeId: edge.id,
      });
      continue;
    }

    flatEdges.push({
      id: edge.id,
      sourceId: edge.id,
      delaySourceId: edge.id,
      from: sourceResolution.endpoint,
      to: targetResolution.endpoint,
      role: targetResolution.role ?? normalized.role,
    });
  }

  const nodeEntryById = new Map(flatNodes.map((node) => [node.id, node]));
  const validatedEdges = [];

  for (const edge of flatEdges) {
    const validated = validateCompiledEdge(edge, nodeEntryById, delays, errors);

    if (validated) {
      validatedEdges.push(validated);
    }
  }

  const edgesByPortId = new Map();

  for (const edge of validatedEdges) {
    const sourcePortId = createCompiledPortId(
      edge.from.nodeId,
      PORT_DIRECTIONS.OUT,
      edge.from.portSlot,
    );
    const targetPortId = createCompiledPortId(
      edge.to.nodeId,
      PORT_DIRECTIONS.IN,
      edge.to.portSlot,
    );

    if (edgesByPortId.has(sourcePortId)) {
      pushDuplicatePortIssue(edge, errors, sourcePortId);
      continue;
    }

    if (edgesByPortId.has(targetPortId)) {
      pushDuplicatePortIssue(edge, errors, targetPortId);
      continue;
    }

    edgesByPortId.set(sourcePortId, edge.id);
    edgesByPortId.set(targetPortId, edge.id);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
    };
  }

  const compiledNodes = flatNodes.map(createCompiledNode);
  const compiledEdges = validatedEdges.map((edge) => ({
    id: edge.id,
    from: { ...edge.from },
    to: { ...edge.to },
    role: edge.role,
    delay: delays.get(edge.delaySourceId),
  }));

  const edgesByNodeId = new Map(compiledNodes.map((node) => [node.id, []]));

  for (const edge of compiledEdges) {
    edgesByNodeId.get(edge.from.nodeId)?.push(edge.id);
    edgesByNodeId.get(edge.to.nodeId)?.push(edge.id);
  }

  const graph = {
    nodes: compiledNodes,
    edges: compiledEdges,
    edgesByNodeId,
    edgesByPortId,
    nodeIndex: new Map(compiledNodes.map((node, index) => [node.id, index])),
    edgeIndex: new Map(compiledEdges.map((edge, index) => [edge.id, index])),
    ...(groupsById.size > 0 ? { groupMeta: { groupsById } } : {}),
    ...(options.includeDebugMaps !== false
      ? { debug: createDebugMaps(flatNodes, validatedEdges) }
      : {}),
  };

  return {
    ok: true,
    graph,
    errors,
    warnings,
  };
}
