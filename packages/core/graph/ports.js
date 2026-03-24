import { getLayout } from "../nodes/archetypes.js";
import {
  createGroupedNodeDefinition,
  getGroupPortCounts,
} from "../nodes/grouped-node.js";
import { isGroupBackedNodeType, PORT_DIRECTIONS } from "./constants.js";
import { MODEL_ERROR_CODES, createModelIssue } from "./errors.js";

export function createPortId(nodeId, direction, slotId) {
  return `${nodeId}:${direction}:${slotId}`;
}

export function resolveNodeDefinitionForModel(
  node,
  groups,
  getNodeDefinition,
  options = {},
) {
  const validateGroupRef = options.validateGroupRef !== false;
  const definition = getNodeDefinition(node.type);

  if (!definition) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.UNKNOWN_NODE_TYPE,
        `Unknown node type "${node.type}".`,
        node.id,
      ),
    };
  }

  if (node.groupRef !== undefined) {
    if (!isGroupBackedNodeType(node.type)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.GROUP_REF_INVALID,
          "Only group-backed nodes may carry groupRef values.",
          node.id,
        ),
      };
    }

    if (typeof node.groupRef !== "string" || node.groupRef.trim() === "") {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.GROUP_REF_INVALID,
          `Group node "${node.id}" must reference a valid group definition id.`,
          node.id,
        ),
      };
    }

    if (validateGroupRef) {
      const groupDefinition = groups?.[node.groupRef];

      if (!groupDefinition) {
        return {
          issue: createModelIssue(
            MODEL_ERROR_CODES.GROUP_REF_INVALID,
            `Node "${node.id}" references missing group "${node.groupRef}".`,
            node.id,
          ),
        };
      }

      return {
        definition: createGroupedNodeDefinition(groupDefinition, definition),
      };
    }
  }

  if (isGroupBackedNodeType(node.type) && validateGroupRef && node.groupRef === undefined) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.GROUP_REF_INVALID,
        `Group-backed node "${node.id}" must include groupRef.`,
        node.id,
      ),
    };
  }

  return { definition };
}

export function getNodePortLayout(node, groups, getNodeDefinition, options) {
  const resolution = resolveNodeDefinitionForModel(
    node,
    groups,
    getNodeDefinition,
    options,
  );

  if (resolution.issue) {
    return resolution;
  }

  return {
    definition: resolution.definition,
    layout: getLayout(
      resolution.definition.layout,
      resolution.definition.inputs,
      resolution.definition.outputs,
      resolution.definition.controlPorts,
    ),
  };
}

export function derivePortRecords(node, groups, getNodeDefinition, options) {
  const resolution = getNodePortLayout(node, groups, getNodeDefinition, options);

  if (resolution.issue) {
    return resolution;
  }

  const inputs = resolution.layout.inputs.map((port) => ({
    id: createPortId(node.id, PORT_DIRECTIONS.IN, port.index),
    nodeId: node.id,
    direction: PORT_DIRECTIONS.IN,
    slotId: port.index,
  }));

  const outputs = resolution.layout.outputs.map((port) => ({
    id: createPortId(node.id, PORT_DIRECTIONS.OUT, port.index),
    nodeId: node.id,
    direction: PORT_DIRECTIONS.OUT,
    slotId: port.index,
  }));

  return {
    definition: resolution.definition,
    layout: resolution.layout,
    ports: [...inputs, ...outputs],
  };
}

export function getNodePortCounts(node, groups, getNodeDefinition, options) {
  if (isGroupBackedNodeType(node.type) && node.groupRef && groups?.[node.groupRef]) {
    return getGroupPortCounts(groups[node.groupRef]);
  }

  const resolution = resolveNodeDefinitionForModel(
    node,
    groups,
    getNodeDefinition,
    options,
  );

  if (resolution.issue) {
    return resolution;
  }

  return {
    counts: {
      inputs: resolution.definition.inputs,
      outputs: resolution.definition.outputs,
      controlPorts: resolution.definition.controlPorts,
    },
  };
}
