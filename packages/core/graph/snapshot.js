import { ROTATION_SET } from "./constants.js";
import { MODEL_ERROR_CODES, createModelIssue } from "./errors.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIntegerPoint(point) {
  return (
    isPlainObject(point) &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y)
  );
}

function normalizeParams(params, source, entityId) {
  if (params === undefined && source === "load") {
    return {};
  }

  if (!isPlainObject(params)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Node "${entityId}" must include a params object.`,
        entityId,
      ),
    };
  }

  const normalized = {};

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.INVALID_OPERATION,
          `Node "${entityId}" param "${key}" must be numeric.`,
          entityId,
        ),
      };
    }

    normalized[key] = value;
  }

  return { params: normalized };
}

function normalizePoint(point, entityId, message) {
  if (!isIntegerPoint(point)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_POSITION,
        message,
        entityId,
      ),
    };
  }

  return {
    point: {
      x: point.x,
      y: point.y,
    },
  };
}

export function createEmptyGraphSnapshot() {
  return {
    nodes: [],
    edges: [],
  };
}

export function cloneGraphSnapshot(snapshot) {
  const groups =
    snapshot.groups &&
    Object.fromEntries(
      Object.entries(snapshot.groups).map(([groupId, group]) => [
        groupId,
        {
          ...group,
          graph: cloneGraphSnapshot(group.graph),
          inputs: group.inputs.map((mapping) => ({ ...mapping })),
          outputs: group.outputs.map((mapping) => ({ ...mapping })),
          controls: group.controls.map((mapping) => ({ ...mapping })),
        },
      ]),
    );

  return {
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      pos: { ...node.pos },
      params: { ...node.params },
    })),
    edges: snapshot.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
      manualCorners: edge.manualCorners.map((point) => ({ ...point })),
    })),
    ...(groups && Object.keys(groups).length > 0 ? { groups } : {}),
  };
}

export function normalizeNodeRecord(
  rawNode,
  getNodeDefinition,
  groups,
  options = {},
) {
  const source = options.source ?? "load";
  const validateGroupRef = options.validateGroupRef !== false;

  if (!isPlainObject(rawNode)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Node record must be an object.",
      ),
    };
  }

  if (typeof rawNode.id !== "string" || rawNode.id.trim() === "") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Node record must include a non-empty id.",
      ),
    };
  }

  if (typeof rawNode.type !== "string" || rawNode.type.trim() === "") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.UNKNOWN_NODE_TYPE,
        `Node "${rawNode.id}" must include a type.`,
        rawNode.id,
      ),
    };
  }

  const definition = getNodeDefinition(rawNode.type);

  if (!definition) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.UNKNOWN_NODE_TYPE,
        `Unknown node type "${rawNode.type}".`,
        rawNode.id,
      ),
    };
  }

  const normalizedPos = normalizePoint(
    rawNode.pos,
    rawNode.id,
    `Node "${rawNode.id}" position must use integer grid coordinates.`,
  );

  if (normalizedPos.issue) {
    return normalizedPos;
  }

  const rot = rawNode.rot === undefined && source === "load" ? 0 : rawNode.rot;

  if (!ROTATION_SET.has(rot)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_ROTATION,
        `Node "${rawNode.id}" rotation must be one of 0, 90, 180, or 270.`,
        rawNode.id,
      ),
    };
  }

  const normalizedParams = normalizeParams(rawNode.params, source, rawNode.id);

  if (normalizedParams.issue) {
    return normalizedParams;
  }

  if (rawNode.name !== undefined && typeof rawNode.name !== "string") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Node "${rawNode.id}" name must be a string when provided.`,
        rawNode.id,
      ),
    };
  }

  if (rawNode.groupRef !== undefined) {
    if (
      typeof rawNode.groupRef !== "string" ||
      rawNode.groupRef.trim() === ""
    ) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.GROUP_REF_INVALID,
          `Node "${rawNode.id}" groupRef must be a non-empty string.`,
          rawNode.id,
        ),
      };
    }

    if (validateGroupRef && groups && !groups[rawNode.groupRef]) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.GROUP_REF_INVALID,
          `Node "${rawNode.id}" references missing group "${rawNode.groupRef}".`,
          rawNode.id,
        ),
      };
    }
  }

  return {
    node: {
      id: rawNode.id,
      type: definition.type,
      pos: normalizedPos.point,
      rot,
      params: normalizedParams.params,
      ...(rawNode.name !== undefined ? { name: rawNode.name } : {}),
      ...(rawNode.groupRef !== undefined ? { groupRef: rawNode.groupRef } : {}),
    },
  };
}

export function normalizeEdgeRecord(rawEdge, options = {}) {
  const source = options.source ?? "load";

  if (!isPlainObject(rawEdge)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Edge record must be an object.",
      ),
    };
  }

  if (typeof rawEdge.id !== "string" || rawEdge.id.trim() === "") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Edge record must include a non-empty id.",
      ),
    };
  }

  const endpoints = [
    ["from", rawEdge.from],
    ["to", rawEdge.to],
  ];

  for (const [key, endpoint] of endpoints) {
    if (
      !isPlainObject(endpoint) ||
      typeof endpoint.nodeId !== "string" ||
      endpoint.nodeId.trim() === "" ||
      !Number.isInteger(endpoint.portSlot) ||
      endpoint.portSlot < 0
    ) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.INVALID_OPERATION,
          `Edge "${rawEdge.id}" ${key} endpoint must include nodeId and a 0-based integer portSlot.`,
          rawEdge.id,
        ),
      };
    }
  }

  if (rawEdge.manualCorners === undefined && source === "load") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Edge "${rawEdge.id}" must include manualCorners.`,
        rawEdge.id,
      ),
    };
  }

  if (!Array.isArray(rawEdge.manualCorners)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Edge "${rawEdge.id}" manualCorners must be an array.`,
        rawEdge.id,
      ),
    };
  }

  const manualCorners = [];

  for (const point of rawEdge.manualCorners) {
    const normalizedPoint = normalizePoint(
      point,
      rawEdge.id,
      `Edge "${rawEdge.id}" corners must use integer grid coordinates.`,
    );

    if (normalizedPoint.issue) {
      return normalizedPoint;
    }

    manualCorners.push(normalizedPoint.point);
  }

  return {
    edge: {
      id: rawEdge.id,
      from: {
        nodeId: rawEdge.from.nodeId,
        portSlot: rawEdge.from.portSlot,
      },
      to: {
        nodeId: rawEdge.to.nodeId,
        portSlot: rawEdge.to.portSlot,
      },
      manualCorners,
    },
  };
}

function normalizeGroupMappings(list, type, groupId) {
  if (list === undefined) {
    return [];
  }

  if (!Array.isArray(list)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Group "${groupId}" ${type} mappings must be an array.`,
        groupId,
      ),
    };
  }

  const mappings = [];

  for (const mapping of list) {
    if (!isPlainObject(mapping) || typeof mapping.nodeId !== "string") {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.INVALID_OPERATION,
          `Group "${groupId}" ${type} mappings must include nodeId.`,
          groupId,
        ),
      };
    }

    if (type === "controls") {
      if (
        mapping.paramKey !== undefined &&
        typeof mapping.paramKey !== "string"
      ) {
        return {
          issue: createModelIssue(
            MODEL_ERROR_CODES.INVALID_OPERATION,
            `Group "${groupId}" controls mappings must use string paramKey values.`,
            groupId,
          ),
        };
      }

      mappings.push({
        ...(mapping.label !== undefined ? { label: mapping.label } : {}),
        nodeId: mapping.nodeId,
        ...(mapping.paramKey !== undefined ? { paramKey: mapping.paramKey } : {}),
      });
      continue;
    }

    if (!Number.isInteger(mapping.portSlot) || mapping.portSlot < 0) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.INVALID_OPERATION,
          `Group "${groupId}" ${type} mappings must use integer portSlot values.`,
          groupId,
        ),
      };
    }

    mappings.push({
      ...(mapping.label !== undefined ? { label: mapping.label } : {}),
      nodeId: mapping.nodeId,
      portSlot: mapping.portSlot,
    });
  }

  return { mappings };
}

export function normalizeGroupDefinition(group, getNodeDefinition, options = {}) {
  if (!isPlainObject(group)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Group definition must be an object.",
      ),
    };
  }

  if (typeof group.id !== "string" || group.id.trim() === "") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Group definition must include a non-empty id.",
      ),
    };
  }

  if (typeof group.name !== "string" || group.name.trim() === "") {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        `Group "${group.id}" must include a non-empty name.`,
        group.id,
      ),
    };
  }

  const normalizedGraph = normalizeGraphSnapshot(group.graph, getNodeDefinition, {
    source: "load",
    allowGroups: false,
    validateGroupRef: false,
  });

  if (normalizedGraph.issue) {
    return normalizedGraph;
  }

  const inputs = normalizeGroupMappings(group.inputs, "inputs", group.id);

  if (inputs.issue) {
    return inputs;
  }

  const outputs = normalizeGroupMappings(group.outputs, "outputs", group.id);

  if (outputs.issue) {
    return outputs;
  }

  const controls = normalizeGroupMappings(group.controls, "controls", group.id);

  if (controls.issue) {
    return controls;
  }

  return {
    group: {
      id: group.id,
      name: group.name,
      graph: normalizedGraph.snapshot,
      inputs: inputs.mappings,
      outputs: outputs.mappings,
      controls: controls.mappings,
    },
  };
}

export function normalizeGraphSnapshot(snapshot, getNodeDefinition, options = {}) {
  const source = options.source ?? "load";
  const allowGroups = options.allowGroups !== false;
  const validateGroupRef = options.validateGroupRef !== false;
  const baseSnapshot = snapshot ?? createEmptyGraphSnapshot();

  if (!isPlainObject(baseSnapshot)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Graph snapshot must be an object.",
      ),
    };
  }

  if (!Array.isArray(baseSnapshot.nodes) || !Array.isArray(baseSnapshot.edges)) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        "Graph snapshot must include nodes[] and edges[] arrays.",
      ),
    };
  }

  let groups;

  if (allowGroups) {
    if (baseSnapshot.groups !== undefined) {
      if (!isPlainObject(baseSnapshot.groups)) {
        return {
          issue: createModelIssue(
            MODEL_ERROR_CODES.INVALID_OPERATION,
            "Graph snapshot groups must be an object record.",
          ),
        };
      }

      groups = {};

      for (const [groupId, groupDefinition] of Object.entries(baseSnapshot.groups)) {
        const normalizedGroup = normalizeGroupDefinition(
          { ...groupDefinition, id: groupDefinition.id ?? groupId },
          getNodeDefinition,
          options,
        );

        if (normalizedGroup.issue) {
          return normalizedGroup;
        }

        groups[groupId] = normalizedGroup.group;
      }
    }
  } else if (baseSnapshot.groups !== undefined && Object.keys(baseSnapshot.groups).length > 0) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.GROUP_REF_INVALID,
        "Nested group libraries are not allowed inside group definitions.",
      ),
    };
  }

  const nodes = [];

  for (const rawNode of baseSnapshot.nodes) {
    const normalizedNode = normalizeNodeRecord(rawNode, getNodeDefinition, groups, {
      source,
      validateGroupRef,
    });

    if (normalizedNode.issue) {
      return normalizedNode;
    }

    nodes.push(normalizedNode.node);
  }

  const edges = [];

  for (const rawEdge of baseSnapshot.edges) {
    const normalizedEdge = normalizeEdgeRecord(rawEdge, { source });

    if (normalizedEdge.issue) {
      return normalizedEdge;
    }

    edges.push(normalizedEdge.edge);
  }

  return {
    snapshot: {
      nodes,
      edges,
      ...(groups && Object.keys(groups).length > 0 ? { groups } : {}),
    },
  };
}
