import { PORT_DIRECTIONS, isGroupBackedNodeType } from "../graph/constants.js";
import { analyzeGroupDependencies } from "../graph/grouping.js";
import {
  BUILD_EDGE_ROLES,
  createCompiledPortId,
  getInputRole,
  getOutputRole,
  normalizeEditorEdge,
  resolveNodeShape,
} from "./roles.js";
import { BUILD_ERROR_CODES, createBuildIssue } from "./errors.js";
import { createGroupDelaySourceId } from "./delay-sources.js";

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

function cloneTemplateNodeEntry(nodeEntry) {
  return {
    id: nodeEntry.id,
    sourceId: nodeEntry.sourceId,
    sourceNode: cloneNodeRecord(nodeEntry.sourceNode),
    shape: nodeEntry.shape,
  };
}

function cloneTemplateEdgeEntry(edgeEntry) {
  return {
    id: edgeEntry.id,
    sourceId: edgeEntry.sourceId,
    delaySourceId: edgeEntry.delaySourceId,
    from: { ...edgeEntry.from },
    to: { ...edgeEntry.to },
    role: edgeEntry.role,
  };
}

function createMappingIssue(groupId, message, details = {}) {
  return createBuildIssue(BUILD_ERROR_CODES.GROUP_MAPPING_INVALID, message, {
    groupId,
    ...details,
  });
}

function createResolvedControlKey(mapping) {
  return `${mapping.nodeId}:control:${mapping.controlSlot}`;
}

function instantiateTemplateEntries(instanceNodeId, template, { includeInstanceMeta = false } = {}) {
  const nodeIdMap = new Map();
  const nodeIds = [];

  for (const nodeEntry of template.nodes) {
    const instantiatedNodeId = createGroupNodeId(instanceNodeId, nodeEntry.id);
    nodeIdMap.set(nodeEntry.id, instantiatedNodeId);
    nodeIds.push(instantiatedNodeId);
  }

  const nodes = template.nodes.map((nodeEntry) => ({
    id: nodeIdMap.get(nodeEntry.id),
    sourceId: nodeEntry.sourceId,
    sourceNode: cloneNodeRecord(nodeEntry.sourceNode),
    shape: nodeEntry.shape,
    ...(includeInstanceMeta
      ? {
          groupInstanceId: instanceNodeId,
          groupId: template.groupId,
        }
      : {}),
  }));

  const edges = template.edges.map((edgeEntry) => ({
    id: createGroupEdgeId(instanceNodeId, edgeEntry.id),
    sourceId: edgeEntry.sourceId,
    delaySourceId: edgeEntry.delaySourceId,
    from: {
      nodeId: nodeIdMap.get(edgeEntry.from.nodeId),
      portSlot: edgeEntry.from.portSlot,
    },
    to: {
      nodeId: nodeIdMap.get(edgeEntry.to.nodeId),
      portSlot: edgeEntry.to.portSlot,
    },
    role: edgeEntry.role,
    ...(includeInstanceMeta
      ? {
          groupInstanceId: instanceNodeId,
          groupId: template.groupId,
        }
      : {}),
  }));
  const edgeIds = edges.map((edge) => edge.id);

  return {
    nodes,
    edges,
    nodeIdMap,
    meta: {
      nodeIds,
      edgeIds,
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
        controlSlot: mapping.controlSlot,
        portSlot: mapping.portSlot,
      })),
    },
  };
}

function resolveTemplateSourceEndpoint(groupId, endpoint, groupInstances) {
  const groupInstance = groupInstances.get(endpoint.nodeId);

  if (!groupInstance) {
    return {
      endpoint: {
        nodeId: endpoint.nodeId,
        portSlot: endpoint.portSlot,
      },
    };
  }

  const mapping = groupInstance.externalOutputs[endpoint.portSlot];

  if (!mapping) {
    return {
      issue: createMappingIssue(
        groupId,
        `Nested group node "${endpoint.nodeId}" output slot ${endpoint.portSlot} does not exist.`,
        {
          nodeId: endpoint.nodeId,
          portSlot: endpoint.portSlot,
        },
      ),
    };
  }

  return {
    endpoint: {
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    },
  };
}

function resolveTemplateTargetEndpoint(groupId, endpoint, groupInstances) {
  const groupInstance = groupInstances.get(endpoint.nodeId);

  if (!groupInstance) {
    return {
      endpoint: {
        nodeId: endpoint.nodeId,
        portSlot: endpoint.portSlot,
      },
    };
  }

  if (endpoint.portSlot < groupInstance.externalInputs.length) {
    const mapping = groupInstance.externalInputs[endpoint.portSlot];

    if (!mapping) {
      return {
        issue: createMappingIssue(
          groupId,
          `Nested group node "${endpoint.nodeId}" input slot ${endpoint.portSlot} does not exist.`,
          {
            nodeId: endpoint.nodeId,
            portSlot: endpoint.portSlot,
          },
        ),
      };
    }

    return {
      endpoint: {
        nodeId: mapping.nodeId,
        portSlot: mapping.portSlot,
      },
      role: BUILD_EDGE_ROLES.SIGNAL,
    };
  }

  const controlSlot = endpoint.portSlot - groupInstance.externalInputs.length;
  const controlMapping = groupInstance.controls[controlSlot];

  if (!controlMapping) {
    return {
      issue: createMappingIssue(
        groupId,
        `Nested group node "${endpoint.nodeId}" control slot ${controlSlot} does not exist.`,
        {
          nodeId: endpoint.nodeId,
          portSlot: endpoint.portSlot,
        },
      ),
    };
  }

  return {
    endpoint: {
      nodeId: controlMapping.nodeId,
      portSlot: controlMapping.portSlot,
    },
    role: BUILD_EDGE_ROLES.CONTROL,
  };
}

function resolveSignalInputMapping(groupId, mapping, groupPortSlot, nodeShapeById, groupInstances, usedInputs) {
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

  const resolved = resolveTemplateTargetEndpoint(
    groupId,
    {
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    },
    groupInstances,
  );

  if (resolved.issue) {
    return resolved;
  }

  const portId = createCompiledPortId(
    resolved.endpoint.nodeId,
    PORT_DIRECTIONS.IN,
    resolved.endpoint.portSlot,
  );

  if (usedInputs.has(portId)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" input mapping ${groupPortSlot} targets an internal input port that is already connected.`,
        {
          nodeId: resolved.endpoint.nodeId,
          portSlot: resolved.endpoint.portSlot,
        },
      ),
    };
  }

  usedInputs.add(portId);

  return {
    mapping: {
      groupPortSlot,
      nodeId: resolved.endpoint.nodeId,
      portSlot: resolved.endpoint.portSlot,
    },
  };
}

function resolveSignalOutputMapping(
  groupId,
  mapping,
  groupPortSlot,
  nodeShapeById,
  groupInstances,
  usedOutputs,
) {
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

  const resolved = resolveTemplateSourceEndpoint(
    groupId,
    {
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    },
    groupInstances,
  );

  if (resolved.issue) {
    return resolved;
  }

  const portId = createCompiledPortId(
    resolved.endpoint.nodeId,
    PORT_DIRECTIONS.OUT,
    resolved.endpoint.portSlot,
  );

  if (usedOutputs.has(portId)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" output mapping ${groupPortSlot} targets an internal output port that is already connected.`,
        {
          nodeId: resolved.endpoint.nodeId,
          portSlot: resolved.endpoint.portSlot,
        },
      ),
    };
  }

  usedOutputs.add(portId);

  return {
    mapping: {
      groupPortSlot,
      nodeId: resolved.endpoint.nodeId,
      portSlot: resolved.endpoint.portSlot,
    },
  };
}

function resolveControlMapping(groupId, mapping, groupPortSlot, nodeShapeById, groupInstances, usedControls) {
  const shape = nodeShapeById.get(mapping.nodeId);

  if (!shape) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} references missing node "${mapping.nodeId}".`,
      ),
    };
  }

  if (!Number.isInteger(mapping.controlSlot) || mapping.controlSlot < 0) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} must target a valid control slot.`,
        {
          nodeId: mapping.nodeId,
        },
      ),
    };
  }

  let resolvedMapping;

  if (groupInstances.has(mapping.nodeId)) {
    const groupInstance = groupInstances.get(mapping.nodeId);
    const childControlMapping = groupInstance.controls[mapping.controlSlot];

    if (!childControlMapping) {
      return {
        issue: createMappingIssue(
          groupId,
          `Group "${groupId}" control mapping ${groupPortSlot} references missing child control slot ${mapping.controlSlot} on node "${mapping.nodeId}".`,
          {
            nodeId: mapping.nodeId,
            controlSlot: mapping.controlSlot,
          },
        ),
      };
    }

    resolvedMapping = {
      groupPortSlot,
      nodeId: childControlMapping.nodeId,
      controlSlot: childControlMapping.controlSlot,
      portSlot: childControlMapping.portSlot,
    };
  } else {
    if (mapping.controlSlot >= shape.controlPorts) {
      return {
        issue: createMappingIssue(
          groupId,
          `Group "${groupId}" control mapping ${groupPortSlot} must target a valid internal control input.`,
          {
            nodeId: mapping.nodeId,
            controlSlot: mapping.controlSlot,
          },
        ),
      };
    }

    resolvedMapping = {
      groupPortSlot,
      nodeId: mapping.nodeId,
      controlSlot: mapping.controlSlot,
      portSlot: shape.inputs + mapping.controlSlot,
    };
  }

  const controlKey = createResolvedControlKey(resolvedMapping);

  if (usedControls.has(controlKey)) {
    return {
      issue: createMappingIssue(
        groupId,
        `Group "${groupId}" control mapping ${groupPortSlot} duplicates an already mapped internal control target.`,
        {
          nodeId: resolvedMapping.nodeId,
        },
      ),
    };
  }

  usedControls.add(controlKey);

  return {
    mapping: resolvedMapping,
  };
}

export function buildGroupTemplates(snapshot, registry, issues) {
  const templates = new Map();
  const groups = snapshot.groups ?? {};
  const dependencyAnalysis = analyzeGroupDependencies(groups);

  if (!dependencyAnalysis.ok) {
    issues.push(
      createMappingIssue(
        dependencyAnalysis.cycle[0],
        `Group dependency cycle detected: ${dependencyAnalysis.cycle.join(" -> ")}.`,
        {
          groupId: dependencyAnalysis.cycle[0],
        },
      ),
    );
    return templates;
  }

  for (const groupId of dependencyAnalysis.order) {
    const groupDefinition = groups[groupId];

    if (!groupDefinition) {
      continue;
    }

    const nodeShapeById = new Map();
    const groupInstances = new Map();
    const templateNodes = [];
    const templateEdges = [];
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

      nodeShapeById.set(node.id, shape);

      if (!isGroupBackedNodeType(node.type)) {
        templateNodes.push({
          id: node.id,
          sourceId: node.id,
          sourceNode: cloneNodeRecord(node),
          shape,
        });
        continue;
      }

      const childTemplate = templates.get(node.groupRef);

      if (!childTemplate) {
        issues.push(
          createMappingIssue(
            groupId,
            `Group "${groupId}" references missing child template "${node.groupRef}".`,
            {
              nodeId: node.id,
            },
          ),
        );
        continue;
      }

      const expansion = instantiateTemplateEntries(node.id, childTemplate);
      groupInstances.set(node.id, expansion.meta);
      templateNodes.push(...expansion.nodes.map(cloneTemplateNodeEntry));
      templateEdges.push(...expansion.edges.map(cloneTemplateEdgeEntry));
    }

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

      const resolvedSource = resolveTemplateSourceEndpoint(groupId, normalized.edge.from, groupInstances);

      if (resolvedSource.issue) {
        issues.push(resolvedSource.issue);
        continue;
      }

      const resolvedTarget = resolveTemplateTargetEndpoint(groupId, normalized.edge.to, groupInstances);

      if (resolvedTarget.issue) {
        issues.push(resolvedTarget.issue);
        continue;
      }

      occupiedOutputs.add(
        createCompiledPortId(
          resolvedSource.endpoint.nodeId,
          PORT_DIRECTIONS.OUT,
          resolvedSource.endpoint.portSlot,
        ),
      );
      occupiedInputs.add(
        createCompiledPortId(
          resolvedTarget.endpoint.nodeId,
          PORT_DIRECTIONS.IN,
          resolvedTarget.endpoint.portSlot,
        ),
      );

      templateEdges.push({
        id: edge.id,
        sourceId: edge.id,
        delaySourceId: createGroupDelaySourceId(groupId, edge.id),
        from: {
          nodeId: resolvedSource.endpoint.nodeId,
          portSlot: resolvedSource.endpoint.portSlot,
        },
        to: {
          nodeId: resolvedTarget.endpoint.nodeId,
          portSlot: resolvedTarget.endpoint.portSlot,
        },
        role: resolvedTarget.role ?? normalized.role,
      });
    }

    const mappedInputs = [];
    const mappedOutputs = [];
    const mappedControls = [];
    const inputOccupancy = new Set(occupiedInputs);
    const outputOccupancy = new Set(occupiedOutputs);
    const controlOccupancy = new Set();

    for (let index = 0; index < groupDefinition.inputs.length; index += 1) {
      const result = resolveSignalInputMapping(
        groupId,
        groupDefinition.inputs[index],
        index,
        nodeShapeById,
        groupInstances,
        inputOccupancy,
      );

      if (result.issue) {
        issues.push(result.issue);
        continue;
      }

      mappedInputs.push(result.mapping);
    }

    for (let index = 0; index < groupDefinition.outputs.length; index += 1) {
      const result = resolveSignalOutputMapping(
        groupId,
        groupDefinition.outputs[index],
        index,
        nodeShapeById,
        groupInstances,
        outputOccupancy,
      );

      if (result.issue) {
        issues.push(result.issue);
        continue;
      }

      mappedOutputs.push(result.mapping);
    }

    for (let index = 0; index < groupDefinition.controls.length; index += 1) {
      const result = resolveControlMapping(
        groupId,
        groupDefinition.controls[index],
        index,
        nodeShapeById,
        groupInstances,
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
  const expansion = instantiateTemplateEntries(instanceNode.id, template, {
    includeInstanceMeta: true,
  });

  return {
    nodes: expansion.nodes,
    edges: expansion.edges,
    nodeIdMap: expansion.nodeIdMap,
    meta: {
      nodeIds: expansion.meta.nodeIds,
      edgeIds: expansion.meta.edgeIds,
      externalInputs: expansion.meta.externalInputs,
      externalOutputs: expansion.meta.externalOutputs,
      controls: expansion.meta.controls.map((mapping) => ({
        groupPortSlot: mapping.groupPortSlot,
        nodeId: mapping.nodeId,
        controlSlot: mapping.controlSlot,
        portSlot: mapping.portSlot,
      })),
    },
  };
}
