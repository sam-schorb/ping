import { createPortId, derivePortRecords } from "./ports.js";
import { PORT_DIRECTIONS } from "./constants.js";
import { MODEL_ERROR_CODES, createModelIssue } from "./errors.js";

function clonePortRecord(port) {
  return {
    id: port.id,
    nodeId: port.nodeId,
    direction: port.direction,
    slotId: port.slotId,
    ...(port.connectedEdgeId !== undefined
      ? { connectedEdgeId: port.connectedEdgeId }
      : {}),
  };
}

export function buildGraphIndexes(snapshot, getNodeDefinition, options = {}) {
  const nodeById = new Map();
  const edgeById = new Map();
  const portById = new Map();
  const edgesByNodeId = new Map();
  const edgeByPortId = new Map();
  const groups = snapshot.groups;

  for (const node of snapshot.nodes) {
    if (nodeById.has(node.id)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.DUPLICATE_ID,
          `Duplicate node id "${node.id}" found in graph.`,
          node.id,
        ),
      };
    }

    const resolution = derivePortRecords(
      node,
      groups,
      getNodeDefinition,
      options,
    );

    if (resolution.issue) {
      return resolution;
    }

    nodeById.set(node.id, node);
    edgesByNodeId.set(node.id, new Set());

    for (const port of resolution.ports) {
      if (portById.has(port.id)) {
        return {
          issue: createModelIssue(
            MODEL_ERROR_CODES.DUPLICATE_ID,
            `Duplicate port id "${port.id}" found in graph.`,
            port.id,
          ),
        };
      }

      portById.set(port.id, port);
    }
  }

  const resolveEdgePort = (endpoint, direction, edgeId) => {
    const portId = createPortId(endpoint.nodeId, direction, endpoint.portSlot);
    const directPort = portById.get(portId);

    if (directPort) {
      return { portId };
    }

    const inverseDirection =
      direction === PORT_DIRECTIONS.OUT
        ? PORT_DIRECTIONS.IN
        : PORT_DIRECTIONS.OUT;
    const inversePortId = createPortId(
      endpoint.nodeId,
      inverseDirection,
      endpoint.portSlot,
    );

    if (portById.has(inversePortId)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.EDGE_DIRECTION_INVALID,
          `Edge "${edgeId}" must connect output ports to input ports only.`,
          edgeId,
        ),
      };
    }

    if (!nodeById.has(endpoint.nodeId)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.EDGE_DANGLING_ENDPOINT,
          `Edge "${edgeId}" references missing node "${endpoint.nodeId}".`,
          edgeId,
        ),
      };
    }

    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.PORT_INVALID,
        `Edge "${edgeId}" references invalid ${direction} port ${endpoint.portSlot} on node "${endpoint.nodeId}".`,
        edgeId,
      ),
    };
  };

  for (const edge of snapshot.edges) {
    if (edgeById.has(edge.id)) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.DUPLICATE_ID,
          `Duplicate edge id "${edge.id}" found in graph.`,
          edge.id,
        ),
      };
    }

    const fromResolution = resolveEdgePort(edge.from, PORT_DIRECTIONS.OUT, edge.id);

    if (fromResolution.issue) {
      return fromResolution;
    }

    const toResolution = resolveEdgePort(edge.to, PORT_DIRECTIONS.IN, edge.id);

    if (toResolution.issue) {
      return toResolution;
    }

    if (
      edgeByPortId.has(fromResolution.portId) ||
      edgeByPortId.has(toResolution.portId)
    ) {
      return {
        issue: createModelIssue(
          MODEL_ERROR_CODES.PORT_ALREADY_CONNECTED,
          `Edge "${edge.id}" reuses a port that is already connected.`,
          edge.id,
        ),
      };
    }

    edgeById.set(edge.id, edge);
    edgeByPortId.set(fromResolution.portId, edge.id);
    edgeByPortId.set(toResolution.portId, edge.id);
    edgesByNodeId.get(edge.from.nodeId)?.add(edge.id);
    edgesByNodeId.get(edge.to.nodeId)?.add(edge.id);
  }

  for (const [portId, edgeId] of edgeByPortId.entries()) {
    const port = portById.get(portId);

    if (port) {
      portById.set(portId, {
        ...port,
        connectedEdgeId: edgeId,
      });
    }
  }

  return {
    indexes: {
      nodeById,
      edgeById,
      portById,
      edgesByNodeId,
      edgeByPortId,
    },
  };
}

export function cloneGraphIndexes(indexes) {
  return {
    nodeById: new Map(
      Array.from(indexes.nodeById.entries(), ([nodeId, node]) => [nodeId, { ...node, pos: { ...node.pos }, params: { ...node.params } }]),
    ),
    edgeById: new Map(
      Array.from(indexes.edgeById.entries(), ([edgeId, edge]) => [
        edgeId,
        {
          ...edge,
          from: { ...edge.from },
          to: { ...edge.to },
          manualCorners: edge.manualCorners.map((point) => ({ ...point })),
        },
      ]),
    ),
    portById: new Map(
      Array.from(indexes.portById.entries(), ([portId, port]) => [
        portId,
        clonePortRecord(port),
      ]),
    ),
    edgesByNodeId: new Map(
      Array.from(indexes.edgesByNodeId.entries(), ([nodeId, edgeIds]) => [
        nodeId,
        new Set(edgeIds),
      ]),
    ),
    edgeByPortId: new Map(indexes.edgeByPortId),
  };
}
