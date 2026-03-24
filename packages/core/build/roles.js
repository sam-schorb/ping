import { isGroupBackedNodeType, PORT_DIRECTIONS } from "../graph/constants.js";
import { createPortId } from "../graph/ports.js";
import { createGroupedNodeDefinition } from "../nodes/grouped-node.js";
import { BUILD_ERROR_CODES, createBuildIssue } from "./errors.js";

export const BUILD_EDGE_ROLES = {
  SIGNAL: "signal",
  CONTROL: "control",
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneLayout(layout) {
  return {
    inputs: layout.inputs.map((port) => ({ ...port })),
    outputs: layout.outputs.map((port) => ({ ...port })),
  };
}

function createContextMessagePrefix(context = {}) {
  if (context.groupId && context.nodeId) {
    return `Group "${context.groupId}" node "${context.nodeId}"`;
  }

  if (context.groupId) {
    return `Group "${context.groupId}"`;
  }

  if (context.nodeId) {
    return `Node "${context.nodeId}"`;
  }

  return "Node";
}

function validatePortLayout(shape, issues, context = {}) {
  const prefix = createContextMessagePrefix(context);
  const expectedInputCount = shape.inputs + shape.controlPorts;

  if (
    !isPlainObject(shape.layout) ||
    !Array.isArray(shape.layout.inputs) ||
    !Array.isArray(shape.layout.outputs)
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.PORT_COUNT_MISMATCH,
        `${prefix} layout "${shape.layoutKey}" must return inputs[] and outputs[] arrays.`,
        context,
      ),
    );
    return;
  }

  if (
    shape.layout.inputs.length !== expectedInputCount ||
    shape.layout.outputs.length !== shape.outputs
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.PORT_COUNT_MISMATCH,
        `${prefix} layout "${shape.layoutKey}" returned ${shape.layout.inputs.length} inputs and ${shape.layout.outputs.length} outputs, expected ${expectedInputCount} inputs and ${shape.outputs} outputs.`,
        context,
      ),
    );
  }

  for (let index = 0; index < shape.layout.inputs.length; index += 1) {
    const expectedRole =
      index < shape.inputs ? BUILD_EDGE_ROLES.SIGNAL : BUILD_EDGE_ROLES.CONTROL;
    const port = shape.layout.inputs[index];

    if (!isPlainObject(port) || port.index !== index || port.role !== expectedRole) {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.ROLE_MISMATCH,
          `${prefix} layout "${shape.layoutKey}" input slot ${index} must be role "${expectedRole}" with matching index.`,
          {
            ...context,
            portSlot: index,
          },
        ),
      );
    }
  }

  for (let index = 0; index < shape.layout.outputs.length; index += 1) {
    const port = shape.layout.outputs[index];

    if (
      !isPlainObject(port) ||
      port.index !== index ||
      port.role !== BUILD_EDGE_ROLES.SIGNAL
    ) {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.ROLE_MISMATCH,
          `${prefix} layout "${shape.layoutKey}" output slot ${index} must be role "signal" with matching index.`,
          {
            ...context,
            portSlot: index,
          },
        ),
      );
    }
  }
}

export function createCompiledPortId(nodeId, direction, slotId) {
  return createPortId(nodeId, direction, slotId);
}

export function getInputRole(shape, portSlot) {
  if (!Number.isInteger(portSlot) || portSlot < 0) {
    return undefined;
  }

  if (portSlot < shape.inputs) {
    return BUILD_EDGE_ROLES.SIGNAL;
  }

  if (portSlot < shape.inputs + shape.controlPorts) {
    return BUILD_EDGE_ROLES.CONTROL;
  }

  return undefined;
}

export function getOutputRole(shape, portSlot) {
  if (!Number.isInteger(portSlot) || portSlot < 0) {
    return undefined;
  }

  return portSlot < shape.outputs ? BUILD_EDGE_ROLES.SIGNAL : undefined;
}

function createBuildShape(node, definition, layout) {
  return {
    nodeId: node.id,
    type: definition.type,
    layoutKey: definition.layout,
    definition,
    layout: cloneLayout(layout),
    inputs: definition.inputs,
    outputs: definition.outputs,
    controlPorts: definition.controlPorts,
    hasParam: definition.hasParam === true,
    defaultParam:
      typeof definition.defaultParam === "number" &&
      Number.isFinite(definition.defaultParam)
        ? definition.defaultParam
        : 1,
    initState:
      typeof definition.initState === "function" ? definition.initState : null,
  };
}

export function resolveNodeShape(node, groups, registry, issues, context = {}) {
  const baseDefinition = registry.getNodeDefinition(node.type);

  if (!baseDefinition) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.UNKNOWN_NODE_TYPE,
        `Unknown node type "${node.type}".`,
        {
          ...context,
          nodeId: node.id,
        },
      ),
    );
    return null;
  }

  let definition = baseDefinition;

  if (isGroupBackedNodeType(node.type)) {
    if (typeof node.groupRef !== "string" || node.groupRef.trim() === "") {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.GROUP_MAPPING_INVALID,
          `Group-backed node "${node.id}" must reference a valid group definition.`,
          {
            ...context,
            nodeId: node.id,
          },
        ),
      );
      return null;
    }

    const groupDefinition = groups?.[node.groupRef];

    if (!groupDefinition) {
      issues.push(
        createBuildIssue(
          BUILD_ERROR_CODES.GROUP_MAPPING_INVALID,
          `Group-backed node "${node.id}" references missing group "${node.groupRef}".`,
          {
            ...context,
            nodeId: node.id,
            groupId: node.groupRef,
          },
        ),
      );
      return null;
    }

    definition = createGroupedNodeDefinition(groupDefinition, baseDefinition);
  }

  let layout;

  try {
    layout = registry.getLayout(
      definition.layout,
      definition.inputs,
      definition.outputs,
      definition.controlPorts,
    );
  } catch (error) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.PORT_COUNT_MISMATCH,
        `Failed to resolve layout "${definition.layout}" for node "${node.id}": ${error instanceof Error ? error.message : "unknown error"}.`,
        {
          ...context,
          nodeId: node.id,
        },
      ),
    );
    return null;
  }

  const shape = createBuildShape(node, definition, layout);

  validatePortLayout(shape, issues, {
    ...context,
    nodeId: node.id,
  });

  return shape;
}

function classifyEndpoint(shape, slot) {
  if (!shape) {
    return {
      hasInput: false,
      hasOutput: false,
      inputRole: undefined,
      outputRole: undefined,
    };
  }

  return {
    hasInput: getInputRole(shape, slot) !== undefined,
    hasOutput: getOutputRole(shape, slot) !== undefined,
    inputRole: getInputRole(shape, slot),
    outputRole: getOutputRole(shape, slot),
  };
}

function pushMissingNodeIssue(nodeId, edgeId, issues, context = {}) {
  issues.push(
    createBuildIssue(
      BUILD_ERROR_CODES.DANGLING_PORT,
      `Edge "${edgeId}" references missing node "${nodeId}".`,
      {
        ...context,
        edgeId,
        nodeId,
      },
    ),
  );
}

function pushInvalidPortIssue(nodeId, edgeId, portSlot, issues, context = {}) {
  issues.push(
    createBuildIssue(
      BUILD_ERROR_CODES.PORT_SLOT_INVALID,
      `Edge "${edgeId}" references invalid port slot ${portSlot} on node "${nodeId}".`,
      {
        ...context,
        edgeId,
        nodeId,
        portSlot,
      },
    ),
  );
}

export function normalizeEditorEdge(edge, nodeShapeById, issues, context = {}) {
  const sourceShape = nodeShapeById.get(edge.from.nodeId);
  const targetShape = nodeShapeById.get(edge.to.nodeId);

  if (!sourceShape) {
    pushMissingNodeIssue(edge.from.nodeId, edge.id, issues, context);
  }

  if (!targetShape) {
    pushMissingNodeIssue(edge.to.nodeId, edge.id, issues, context);
  }

  if (!sourceShape || !targetShape) {
    return null;
  }

  const asGivenSource = classifyEndpoint(sourceShape, edge.from.portSlot);
  const asGivenTarget = classifyEndpoint(targetShape, edge.to.portSlot);
  const swappedSource = classifyEndpoint(targetShape, edge.to.portSlot);
  const swappedTarget = classifyEndpoint(sourceShape, edge.from.portSlot);

  if (asGivenSource.hasOutput && asGivenTarget.hasInput) {
    return {
      edge: {
        id: edge.id,
        from: {
          nodeId: edge.from.nodeId,
          portSlot: edge.from.portSlot,
        },
        to: {
          nodeId: edge.to.nodeId,
          portSlot: edge.to.portSlot,
        },
      },
      role: asGivenTarget.inputRole,
    };
  }

  if (swappedSource.hasOutput && swappedTarget.hasInput) {
    return {
      edge: {
        id: edge.id,
        from: {
          nodeId: edge.to.nodeId,
          portSlot: edge.to.portSlot,
        },
        to: {
          nodeId: edge.from.nodeId,
          portSlot: edge.from.portSlot,
        },
      },
      role: swappedTarget.inputRole,
    };
  }

  if (!asGivenSource.hasInput && !asGivenSource.hasOutput) {
    pushInvalidPortIssue(edge.from.nodeId, edge.id, edge.from.portSlot, issues, context);
  }

  if (!asGivenTarget.hasInput && !asGivenTarget.hasOutput) {
    pushInvalidPortIssue(edge.to.nodeId, edge.id, edge.to.portSlot, issues, context);
  }

  if (
    (asGivenSource.hasInput && !asGivenSource.hasOutput &&
      asGivenTarget.hasInput && !asGivenTarget.hasOutput) ||
    (asGivenSource.hasOutput && !asGivenSource.hasInput &&
      asGivenTarget.hasOutput && !asGivenTarget.hasInput)
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.SAME_DIRECTION,
        `Edge "${edge.id}" must connect an output port to an input port.`,
        {
          ...context,
          edgeId: edge.id,
        },
      ),
    );
    return null;
  }

  if (
    asGivenSource.hasOutput &&
    asGivenTarget.hasOutput &&
    !asGivenTarget.hasInput &&
    !swappedSource.hasOutput
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.SAME_DIRECTION,
        `Edge "${edge.id}" connects two output ports.`,
        {
          ...context,
          edgeId: edge.id,
        },
      ),
    );
    return null;
  }

  if (
    asGivenSource.hasInput &&
    asGivenTarget.hasInput &&
    !asGivenSource.hasOutput &&
    !swappedTarget.hasInput
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.SAME_DIRECTION,
        `Edge "${edge.id}" connects two input ports.`,
        {
          ...context,
          edgeId: edge.id,
        },
      ),
    );
    return null;
  }

  if (
    !issues.some(
      (issue) =>
        issue.edgeId === edge.id &&
        (issue.code === BUILD_ERROR_CODES.PORT_SLOT_INVALID ||
          issue.code === BUILD_ERROR_CODES.SAME_DIRECTION),
    )
  ) {
    issues.push(
      createBuildIssue(
        BUILD_ERROR_CODES.ROLE_MISMATCH,
        `Edge "${edge.id}" cannot be normalized to a compatible output/input role pairing.`,
        {
          ...context,
          edgeId: edge.id,
        },
      ),
    );
  }

  return null;
}

export function getPortDirectionForEdgeRole(role) {
  return role === BUILD_EDGE_ROLES.SIGNAL
    ? PORT_DIRECTIONS.IN
    : PORT_DIRECTIONS.IN;
}
