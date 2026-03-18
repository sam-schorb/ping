import { DEFAULT_PARAM_KEY, GROUP_NODE_TYPE, PORT_DIRECTIONS } from "../graph/constants.js";
import {
  BUILD_EDGE_ROLES,
  createCompiledPortId,
  getDirectParamPortSlot,
  getInputRole,
  getOutputRole,
  normalizeEditorEdge,
  resolveNodeShape,
} from "./roles.js";
import { BUILD_ERROR_CODES, createBuildIssue } from "./errors.js";

function createGroupNodeId(instanceNodeId, sourceNodeId) {
  return `${instanceNodeId}::node::${sourceNodeId}`;
}

function createGroupEdgeId(instanceNodeId, sourceEdgeId) {
  return `${instanceNodeId}::edge::${sourceEdgeId}`;
}

function cloneNodeRecord(node) {
  return {
    ...node,
    pos: { ...node.pos },
    params: { ...node.params },
  };
}

function cloneEdgeRecord(edge) {
  return {
    ...edge,
    from: { ...edge.from },
    to: { ...edge.to },
    manualCorners: edge.manualCorners.map((point) => ({ ...point })),
  };
}

function createMappingIssue(groupId, message, details = {}) {
  return createBuildIssue(BUILD_ERROR_CODES.GROUP_MAPPING_INVALID, message, {
    groupId,
    ...details,
  });
}

function validateSignalInputMapping(groupId, mapping, groupPortSlot, nodeShapeById, usedInputs) {
  const shape = nodeShapeById.get(mapping.nodeId);

  if (!shape) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" input mapping ${groupPortSlot} references missing node "${mapping.nodeId}".`,
      ),
    };
  }

  if (getInputRole(shape, mapping.portSlot) !== BUILD_EDGE_ROLES.SIGNAL) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" input mapping ${groupPortSlot} must target a signal input port on node "${mapping.nodeId}".`,
        {
          nodeId: mapping.nodeId,
          portSlot: mapping.portSlot,
        },
      ),
    };
  }

  const portId = createCompiledPortId(
    mapping.nodeId,
    PORT_DIRECTIONS.IN,
    mapping.portSlot,
  );

  if (usedInputs.has(portId)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" input mapping ${groupPortSlot} targets an internal input port that is already connected.`,
        {
          nodeId: mapping.nodeId,
          portSlot: mapping.portSlot,
        },
      ),
    };
  }

  usedInputs.add(portId);

  return {
    mapping: {
      groupPortSlot,
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    },
  };
}

function validateSignalOutputMapping(groupId, mapping, groupPortSlot, nodeShapeById, usedOutputs) {
  const shape = nodeShapeById.get(mapping.nodeId);

  if (!shape) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" output mapping ${groupPortSlot} references missing node "${mapping.nodeId}".`,
      ),
    };
  }

  if (getOutputRole(shape, mapping.portSlot) !== BUILD_EDGE_ROLES.SIGNAL) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" output mapping ${groupPortSlot} must target a signal output port on node "${mapping.nodeId}".`,
        {
          nodeId: mapping.nodeId,
          portSlot: mapping.portSlot,
        },
      ),
    };
  }

  const portId = createCompiledPortId(
    mapping.nodeId,
    PORT_DIRECTIONS.OUT,
    mapping.portSlot,
  );

  if (usedOutputs.has(portId)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" output mapping ${groupPortSlot} targets an internal output port that is already connected.`,
        {
          nodeId: mapping.nodeId,
          portSlot: mapping.portSlot,
        },
      ),
    };
  }

  usedOutputs.add(portId);

  return {
    mapping: {
      groupPortSlot,
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    },
  };
}

function validateControlMapping(groupId, mapping, groupPortSlot, nodeShapeById, usedControls) {
  const shape = nodeShapeById.get(mapping.nodeId);

  if (!shape) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} references missing node "${mapping.nodeId}".`,
      ),
    };
  }

  const paramKey = mapping.paramKey ?? DEFAULT_PARAM_KEY;

  if (paramKey !== DEFAULT_PARAM_KEY || shape.hasParam !== true) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} must target a valid internal param.`,
        {
          nodeId: mapping.nodeId,
        },
      ),
    };
  }

  const controlKey = `${mapping.nodeId}:${paramKey}`;

  if (usedControls.has(controlKey)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} duplicates the mapped param on node "${mapping.nodeId}".`,
        {
          nodeId: mapping.nodeId,
        },
      ),
    };
  }

  usedControls.add(controlKey);

  return {
    mapping: {
      groupPortSlot,
      nodeId: mapping.nodeId,
      paramKey,
      virtualPortSlot: getDirectParamPortSlot(shape),
    },
  };
}

export function buildGroupTemplates(snapshot, registry, issues) {
  const templates = new Map();

  for (const [groupId, groupDefinition] of Object.entries(snapshot.groups ?? {})) {
    const nodeShapeById = new Map();
    const templateNodes = [];
    const groupContext = { groupId };

    for (const node of groupDefinition.graph.nodes) {
      const shape = resolveNodeShape(
        node,
        snapshot.groups,
        registry,
        issues,
        groupContext,
      );

      if (!shape) {
        continue;
      }

      if (node.type === GROUP_NODE_TYPE) {
        issues.push(
          createMappingIssue(
            groupId,
            `Group "${groupId}" cannot contain nested group nodes.`,
            {
              nodeId: node.id,
            },
          ),
        );
        continue;
      }

      nodeShapeById.set(node.id, shape);
      templateNodes.push({
        sourceNode: cloneNodeRecord(node),
        shape,
      });
    }

    const templateEdges = [];
    const occupiedInputs = new Set();
    const occupiedOutputs = new Set();

    for (const edge of groupDefinition.graph.edges) {
      const normalized = normalizeEditorEdge(
        edge,
        nodeShapeById,
        issues,
        groupContext,
      );

      if (!normalized) {
        continue;
      }

      occupiedOutputs.add(
        createCompiledPortId(
          normalized.edge.from.nodeId,
          PORT_DIRECTIONS.OUT,
          normalized.edge.from.portSlot,
        ),
      );
      occupiedInputs.add(
        createCompiledPortId(
          normalized.edge.to.nodeId,
          PORT_DIRECTIONS.IN,
          normalized.edge.to.portSlot,
        ),
      );

      templateEdges.push({
        sourceEdge: cloneEdgeRecord(edge),
        normalizedEdge: normalized.edge,
        role: normalized.role,
      });
    }

    const mappedInputs = [];
    const mappedOutputs = [];
    const mappedControls = [];
    const inputOccupancy = new Set(occupiedInputs);
    const outputOccupancy = new Set(occupiedOutputs);
    const controlOccupancy = new Set();

    for (let index = 0; index < groupDefinition.inputs.length; index += 1) {
      const result = validateSignalInputMapping(
        groupId,
        groupDefinition.inputs[index],
        index,
        nodeShapeById,
        inputOccupancy,
      );

      if (result.issue) {
        issues.push(result.issue);
        continue;
      }

      mappedInputs.push(result.mapping);
    }

    for (let index = 0; index < groupDefinition.outputs.length; index += 1) {
      const result = validateSignalOutputMapping(
        groupId,
        groupDefinition.outputs[index],
        index,
        nodeShapeById,
        outputOccupancy,
      );

      if (result.issue) {
        issues.push(result.issue);
        continue;
      }

      mappedOutputs.push(result.mapping);
    }

    for (let index = 0; index < groupDefinition.controls.length; index += 1) {
      const result = validateControlMapping(
        groupId,
        groupDefinition.controls[index],
        index,
        nodeShapeById,
        controlOccupancy,
      );

      if (result.issue) {
        issues.push(result.issue);
        continue;
      }

      mappedControls.push(result.mapping);
    }

    templates.set(groupId, {
      groupId,
      nodes: templateNodes,
      edges: templateEdges,
      externalInputs: mappedInputs,
      externalOutputs: mappedOutputs,
      controls: mappedControls,
    });
  }

  return templates;
}

export function instantiateGroupTemplate(instanceNode, template) {
  const nodeIdMap = new Map();
  const nodeIds = [];

  for (const nodeEntry of template.nodes) {
    const compiledNodeId = createGroupNodeId(instanceNode.id, nodeEntry.sourceNode.id);
    nodeIdMap.set(nodeEntry.sourceNode.id, compiledNodeId);
    nodeIds.push(compiledNodeId);
  }

  const nodes = template.nodes.map((nodeEntry) => ({
    id: nodeIdMap.get(nodeEntry.sourceNode.id),
    sourceId: nodeEntry.sourceNode.id,
    sourceNode: cloneNodeRecord(nodeEntry.sourceNode),
    shape: nodeEntry.shape,
    groupInstanceId: instanceNode.id,
    groupId: template.groupId,
  }));

  const edges = template.edges.map((edgeEntry) => ({
    id: createGroupEdgeId(instanceNode.id, edgeEntry.sourceEdge.id),
    sourceId: edgeEntry.sourceEdge.id,
    delaySourceId: edgeEntry.sourceEdge.id,
    from: {
      nodeId: nodeIdMap.get(edgeEntry.normalizedEdge.from.nodeId),
      portSlot: edgeEntry.normalizedEdge.from.portSlot,
    },
    to: {
      nodeId: nodeIdMap.get(edgeEntry.normalizedEdge.to.nodeId),
      portSlot: edgeEntry.normalizedEdge.to.portSlot,
    },
    role: edgeEntry.role,
    groupInstanceId: instanceNode.id,
    groupId: template.groupId,
  }));

  return {
    nodes,
    edges,
    nodeIdMap,
    meta: {
      nodeIds,
      externalInputs: template.externalInputs.map((mapping) => ({
        groupPortSlot: mapping.groupPortSlot,
        nodeId: nodeIdMap.get(mapping.nodeId),
        portSlot: mapping.portSlot,
      })),
      externalOutputs: template.externalOutputs.map((mapping) => ({
        groupPortSlot: mapping.groupPortSlot,
        nodeId: nodeIdMap.get(mapping.nodeId),
        portSlot: mapping.portSlot,
      })),
      controls: template.controls.map((mapping) => ({
        groupPortSlot: mapping.groupPortSlot,
        nodeId: nodeIdMap.get(mapping.nodeId),
        paramKey: mapping.paramKey,
      })),
    },
  };
}
