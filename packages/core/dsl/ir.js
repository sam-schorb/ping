import { isGroupBackedNodeType } from "../graph/constants.js";
import {
  normalizeGraphSnapshot,
  normalizeGroupDefinition,
} from "../graph/snapshot.js";
import { routeGraph } from "../routing/route-graph.js";
import {
  DSL_ERROR_CODES,
  createDslIssue,
  wrapModelIssueAsDslExportError,
} from "./errors.js";

function cloneSourceRef(source) {
  if (source.kind === "boundary-inlet") {
    return {
      kind: source.kind,
      inletIndex: source.inletIndex,
    };
  }

  return {
    kind: source.kind,
    irNodeId: source.irNodeId,
    outputSlot: source.outputSlot,
  };
}

function createIrNodeId(instancePath, sourceNodeId) {
  if (instancePath.length === 0) {
    return sourceNodeId;
  }

  return `${instancePath.join("::node::")}::node::${sourceNodeId}`;
}

function createIrEdgeId(instancePath, sourceEdgeId) {
  if (instancePath.length === 0) {
    return sourceEdgeId;
  }

  return `${instancePath.join("::edge::")}::edge::${sourceEdgeId}`;
}

function ensureRegistryAccess(registry) {
  if (typeof registry?.getNodeDefinition !== "function") {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.EXPORT_INTERNAL,
        "DSL export requires registry.getNodeDefinition().",
      ),
    };
  }

  return {
    registry,
  };
}

function canonicalizeGroupLibrary(rawGroups, getNodeDefinition) {
  const normalized = normalizeGraphSnapshot(
    {
      nodes: [],
      edges: [],
      groups: rawGroups ?? {},
    },
    getNodeDefinition,
    { source: "load" },
  );

  if (normalized.issue) {
    return {
      issue: wrapModelIssueAsDslExportError(normalized.issue),
    };
  }

  return {
    groups: normalized.snapshot.groups ?? {},
  };
}

function canonicalizeRootGroup(groupDefinition, getNodeDefinition, groups, groupId) {
  const normalized = normalizeGroupDefinition(
    {
      ...groupDefinition,
      id: groupDefinition?.id ?? groupId,
    },
    getNodeDefinition,
    {
      source: "load",
      groups,
      validateGroupRef: true,
    },
  );

  if (normalized.issue) {
    return {
      issue: wrapModelIssueAsDslExportError(normalized.issue, groupId),
    };
  }

  return {
    group: normalized.group,
  };
}

function buildRouteLengthLookup(groupDefinition, groups, registry, lengthsByGroupKey, groupKey) {
  if (lengthsByGroupKey.has(groupKey)) {
    return;
  }

  const routed = routeGraph(
    {
      nodes: groupDefinition.graph.nodes,
      edges: groupDefinition.graph.edges,
      groups,
    },
    registry,
  );
  const lengths = new Map();

  for (const [edgeId, route] of routed.edgeRoutes.entries()) {
    lengths.set(edgeId, route.totalLength);
  }

  lengthsByGroupKey.set(groupKey, lengths);

  for (const node of groupDefinition.graph.nodes) {
    if (!isGroupBackedNodeType(node.type) || !node.groupRef || !groups[node.groupRef]) {
      continue;
    }

    buildRouteLengthLookup(
      groups[node.groupRef],
      groups,
      registry,
      lengthsByGroupKey,
      node.groupRef,
    );
  }
}

function collectGeneratedComments(ir, rootGroup) {
  const comments = [];

  comments.push({
    text: `preserveInternalCableDelays: ${rootGroup.preserveInternalCableDelays === true}`,
    line: 0,
    origin: "generated",
  });

  for (const inlet of ir.boundaryInputs) {
    if (!inlet.label) {
      continue;
    }

    comments.push({
      text: `$${inlet.inletIndex} = ${inlet.label}`,
      line: 0,
      origin: "generated",
    });
  }

  for (const outlet of ir.boundaryOutputs) {
    if (!outlet.label) {
      continue;
    }

    comments.push({
      text: `outlet(${outlet.outletIndex}) = ${outlet.label}`,
      line: 0,
      origin: "generated",
    });
  }

  return comments;
}

function expandGroupDefinition({
  groupDefinition,
  groupKey,
  groupPath,
  instancePath,
  groups,
  registry,
  ir,
  routeLengthsByGroupKey,
}) {
  const localEntries = new Map();

  const getNodeDefinition = registry.getNodeDefinition;

  for (const node of groupDefinition.graph.nodes) {
    if (isGroupBackedNodeType(node.type)) {
      const childGroup = groups[node.groupRef];

      if (!childGroup) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
            `Group "${groupDefinition.id}" references missing child group "${node.groupRef}".`,
            {
              groupId: groupDefinition.id,
              nodeId: node.id,
            },
          ),
        };
      }

      const childExpansion = expandGroupDefinition({
        groupDefinition: childGroup,
        groupKey: node.groupRef,
        groupPath: [...groupPath, node.groupRef],
        instancePath: [...instancePath, node.id],
        groups,
        registry,
        ir,
        routeLengthsByGroupKey,
      });

      if (childExpansion.issue) {
        return childExpansion;
      }

      localEntries.set(node.id, {
        kind: "group",
        expansion: childExpansion.expansion,
      });
      continue;
    }

    const definition = getNodeDefinition(node.type);

    if (!definition) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" uses unknown node type "${node.type}".`,
          {
            groupId: groupDefinition.id,
            nodeId: node.id,
          },
        ),
      };
    }

    const storedParam =
      definition.hasParam === true
        ? Number.isFinite(node.params?.param)
          ? node.params.param
          : definition.defaultParam
        : undefined;
    const irNodeId = createIrNodeId(instancePath, node.id);

    ir.nodes.push({
      irNodeId,
      type: definition.type,
      ...(storedParam !== undefined ? { storedParam } : {}),
      ...(node.name !== undefined ? { bindingName: node.name } : {}),
      origin:
        instancePath.length === 0
          ? {
              kind: "local",
              groupPath: [],
              sourceNodeId: node.id,
            }
          : {
              kind: "expanded-group",
              groupPath: [...groupPath],
              sourceNodeId: node.id,
            },
    });

    localEntries.set(node.id, {
      kind: "node",
      irNodeId,
      definition,
    });
  }

  const getGroupEdgeDistance = (edgeId) =>
    routeLengthsByGroupKey.get(groupKey)?.get(edgeId);

  function resolveSource(endpoint) {
    const entry = localEntries.get(endpoint.nodeId);

    if (!entry) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" references missing source node "${endpoint.nodeId}".`,
          {
            groupId: groupDefinition.id,
            nodeId: endpoint.nodeId,
          },
        ),
      };
    }

    if (entry.kind === "group") {
      const sourceMapping = entry.expansion.externalOutputs[endpoint.portSlot];

      if (!sourceMapping) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
            `Group "${groupDefinition.id}" references missing child output slot ${endpoint.portSlot} on node "${endpoint.nodeId}".`,
            {
              groupId: groupDefinition.id,
              nodeId: endpoint.nodeId,
            },
          ),
        };
      }

      return {
        source: cloneSourceRef(sourceMapping.source),
      };
    }

    if (
      !Number.isInteger(endpoint.portSlot) ||
      endpoint.portSlot < 0 ||
      endpoint.portSlot >= entry.definition.outputs
    ) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" references invalid output slot ${endpoint.portSlot} on node "${endpoint.nodeId}".`,
          {
            groupId: groupDefinition.id,
            nodeId: endpoint.nodeId,
          },
        ),
      };
    }

    return {
      source: {
        kind: "node-output",
        irNodeId: entry.irNodeId,
        outputSlot: endpoint.portSlot,
      },
    };
  }

  function resolveTarget(endpoint) {
    const entry = localEntries.get(endpoint.nodeId);

    if (!entry) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" references missing target node "${endpoint.nodeId}".`,
          {
            groupId: groupDefinition.id,
            nodeId: endpoint.nodeId,
          },
        ),
      };
    }

    if (entry.kind === "group") {
      if (endpoint.portSlot < entry.expansion.externalInputs.length) {
        const target = entry.expansion.externalInputs[endpoint.portSlot];

        if (!target) {
          return {
            issue: createDslIssue(
              DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
              `Group "${groupDefinition.id}" references missing child signal input slot ${endpoint.portSlot} on node "${endpoint.nodeId}".`,
              {
                groupId: groupDefinition.id,
                nodeId: endpoint.nodeId,
              },
            ),
          };
        }

        return {
          role: "signal",
          target: {
            irNodeId: target.irNodeId,
            signalSlot: target.signalSlot,
          },
        };
      }

      const controlSlot = endpoint.portSlot - entry.expansion.externalInputs.length;
      const target = entry.expansion.controls[controlSlot];

      if (!target) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
            `Group "${groupDefinition.id}" references missing child control slot ${controlSlot} on node "${endpoint.nodeId}".`,
            {
              groupId: groupDefinition.id,
              nodeId: endpoint.nodeId,
            },
          ),
        };
      }

      return {
        role: "control",
        target: {
          irNodeId: target.irNodeId,
          controlSlot: target.controlSlot,
        },
      };
    }

    if (
      Number.isInteger(endpoint.portSlot) &&
      endpoint.portSlot >= 0 &&
      endpoint.portSlot < entry.definition.inputs
    ) {
      return {
        role: "signal",
        target: {
          irNodeId: entry.irNodeId,
          signalSlot: endpoint.portSlot,
        },
      };
    }

    if (
      Number.isInteger(endpoint.portSlot) &&
      endpoint.portSlot >= entry.definition.inputs &&
      endpoint.portSlot < entry.definition.inputs + entry.definition.controlPorts
    ) {
      return {
        role: "control",
        target: {
          irNodeId: entry.irNodeId,
          controlSlot: endpoint.portSlot - entry.definition.inputs,
        },
      };
    }

    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
        `Group "${groupDefinition.id}" references invalid input slot ${endpoint.portSlot} on node "${endpoint.nodeId}".`,
        {
          groupId: groupDefinition.id,
          nodeId: endpoint.nodeId,
        },
      ),
    };
  }

  for (const edge of groupDefinition.graph.edges) {
    const resolvedSource = resolveSource(edge.from);

    if (resolvedSource.issue) {
      return resolvedSource;
    }

    const resolvedTarget = resolveTarget(edge.to);

    if (resolvedTarget.issue) {
      return resolvedTarget;
    }

    const baseEdge = {
      id: createIrEdgeId(instancePath, edge.id),
      from: resolvedSource.source,
      to: resolvedTarget.target,
      ...(typeof getGroupEdgeDistance(edge.id) === "number"
        ? { distance: getGroupEdgeDistance(edge.id) }
        : {}),
      originEdgeId: edge.id,
    };

    if (resolvedTarget.role === "signal") {
      ir.signalEdges.push(baseEdge);
    } else {
      ir.controlEdges.push(baseEdge);
    }
  }

  const externalInputs = [];
  const controls = [];
  const externalOutputs = [];

  for (let index = 0; index < groupDefinition.inputs.length; index += 1) {
    const mapping = groupDefinition.inputs[index];
    const resolved = resolveTarget({
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    });

    if (resolved.issue) {
      return resolved;
    }

    if (resolved.role !== "signal") {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" input mapping ${index} must resolve to a signal target.`,
          {
            groupId: groupDefinition.id,
            nodeId: mapping.nodeId,
          },
        ),
      };
    }

    externalInputs.push({
      irNodeId: resolved.target.irNodeId,
      signalSlot: resolved.target.signalSlot,
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
    });
  }

  for (let index = 0; index < groupDefinition.controls.length; index += 1) {
    const mapping = groupDefinition.controls[index];
    const entry = localEntries.get(mapping.nodeId);

    if (!entry) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" control mapping ${index} references missing node "${mapping.nodeId}".`,
          {
            groupId: groupDefinition.id,
            nodeId: mapping.nodeId,
          },
        ),
      };
    }

    if (entry.kind === "group") {
      const target = entry.expansion.controls[mapping.controlSlot];

      if (!target) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
            `Group "${groupDefinition.id}" control mapping ${index} references missing child control slot ${mapping.controlSlot}.`,
            {
              groupId: groupDefinition.id,
              nodeId: mapping.nodeId,
            },
          ),
        };
      }

      controls.push({
        irNodeId: target.irNodeId,
        controlSlot: target.controlSlot,
        ...(mapping.label !== undefined ? { label: mapping.label } : {}),
      });
      continue;
    }

    if (
      !Number.isInteger(mapping.controlSlot) ||
      mapping.controlSlot < 0 ||
      mapping.controlSlot >= entry.definition.controlPorts
    ) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `Group "${groupDefinition.id}" control mapping ${index} references invalid control slot ${mapping.controlSlot} on node "${mapping.nodeId}".`,
          {
            groupId: groupDefinition.id,
            nodeId: mapping.nodeId,
          },
        ),
      };
    }

    controls.push({
      irNodeId: entry.irNodeId,
      controlSlot: mapping.controlSlot,
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
    });
  }

  for (let index = 0; index < groupDefinition.outputs.length; index += 1) {
    const mapping = groupDefinition.outputs[index];
    const resolved = resolveSource({
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    });

    if (resolved.issue) {
      return resolved;
    }

    externalOutputs.push({
      source: resolved.source,
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
    });
  }

  return {
    expansion: {
      externalInputs,
      controls,
      externalOutputs,
    },
  };
}

export function buildSemanticGroupIR(groupDefinition, registry, options = {}) {
  const registryAccess = ensureRegistryAccess(registry);

  if (registryAccess.issue) {
    return {
      ok: false,
      errors: [registryAccess.issue],
    };
  }

  const groupId = groupDefinition?.id ?? options.groupId ?? "__root_group__";
  const canonicalGroupsResult = canonicalizeGroupLibrary(
    options.groups ?? {},
    registry.getNodeDefinition,
  );

  if (canonicalGroupsResult.issue) {
    return {
      ok: false,
      errors: [canonicalGroupsResult.issue],
    };
  }

  const rootGroupResult = canonicalizeRootGroup(
    groupDefinition,
    registry.getNodeDefinition,
    canonicalGroupsResult.groups,
    groupId,
  );

  if (rootGroupResult.issue) {
    return {
      ok: false,
      errors: [rootGroupResult.issue],
    };
  }

  const ir = {
    preserveInternalCableDelays:
      rootGroupResult.group.preserveInternalCableDelays === true,
    nodes: [],
    signalEdges: [],
    controlEdges: [],
    boundaryInputs: [],
    boundaryOutputs: [],
    bindingNames: {},
    comments: [],
  };
  const routeLengthsByGroupKey = new Map();

  if (options.annotated === true && typeof registry.getLayout === "function") {
    buildRouteLengthLookup(
      rootGroupResult.group,
      canonicalGroupsResult.groups,
      registry,
      routeLengthsByGroupKey,
      groupId,
    );
  }

  const expansionResult = expandGroupDefinition({
    groupDefinition: rootGroupResult.group,
    groupKey: groupId,
    groupPath: [],
    instancePath: [],
    groups: canonicalGroupsResult.groups,
    registry,
    ir,
    routeLengthsByGroupKey,
  });

  if (expansionResult.issue) {
    return {
      ok: false,
      errors: [expansionResult.issue],
    };
  }

  for (let index = 0; index < expansionResult.expansion.externalInputs.length; index += 1) {
    const mapping = expansionResult.expansion.externalInputs[index];

    ir.boundaryInputs.push({
      inletIndex: index,
      kind: "signal",
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
      target: {
        irNodeId: mapping.irNodeId,
        signalSlot: mapping.signalSlot,
      },
    });
  }

  const controlOffset = expansionResult.expansion.externalInputs.length;

  for (let index = 0; index < expansionResult.expansion.controls.length; index += 1) {
    const mapping = expansionResult.expansion.controls[index];

    ir.boundaryInputs.push({
      inletIndex: controlOffset + index,
      kind: "control",
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
      target: {
        irNodeId: mapping.irNodeId,
        controlSlot: mapping.controlSlot,
      },
    });
  }

  for (let index = 0; index < expansionResult.expansion.externalOutputs.length; index += 1) {
    const mapping = expansionResult.expansion.externalOutputs[index];

    ir.boundaryOutputs.push({
      outletIndex: index,
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
      source: cloneSourceRef(mapping.source),
    });
  }

  ir.bindingNames = Object.fromEntries(
    ir.nodes.map((node) => [node.irNodeId, node.bindingName]),
  );

  if (options.annotated === true) {
    ir.comments = collectGeneratedComments(ir, rootGroupResult.group);
  }

  return {
    ok: true,
    ir,
  };
}
