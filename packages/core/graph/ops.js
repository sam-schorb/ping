import { isGroupReferenced } from "./grouping.js";
import {
  MODEL_ERROR_CODES,
  createGraphOpError,
  createModelIssue,
} from "./errors.js";
import {
  normalizeEdgeRecord,
  normalizeGraphSnapshot,
  normalizeGroupDefinition,
  normalizeNodeRecord,
} from "./snapshot.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNodeIndex(snapshot, id) {
  return snapshot.nodes.findIndex((node) => node.id === id);
}

function getEdgeIndex(snapshot, id) {
  return snapshot.edges.findIndex((edge) => edge.id === id);
}

function createInvalidOperation(opIndex, opType, message, entityId) {
  return createGraphOpError(
    createModelIssue(MODEL_ERROR_CODES.INVALID_OPERATION, message, entityId),
    opIndex,
    opType,
  );
}

function validateOpEnvelope(op, opIndex) {
  if (!isPlainObject(op) || typeof op.type !== "string") {
    return createInvalidOperation(
      opIndex,
      typeof op?.type === "string" ? op.type : "unknown",
      "Graph ops must be objects with a string type.",
    );
  }

  if (!("payload" in op)) {
    return createInvalidOperation(opIndex, op.type, "Graph ops must include payload.");
  }

  return null;
}

function removeEdgesForNode(snapshot, nodeId) {
  snapshot.edges = snapshot.edges.filter(
    (edge) => edge.from.nodeId !== nodeId && edge.to.nodeId !== nodeId,
  );
}

export function applyGraphOp(
  snapshot,
  op,
  opIndex,
  context,
) {
  const envelopeError = validateOpEnvelope(op, opIndex);

  if (envelopeError) {
    return { error: envelopeError };
  }

  const opType = op.type;
  const payload = op.payload;

  switch (opType) {
    case "addNode": {
      if (!isPlainObject(payload) || !("node" in payload)) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'addNode payload must include "node".',
          ),
        };
      }

      const normalized = normalizeNodeRecord(
        payload.node,
        context.getNodeDefinition,
        snapshot.groups,
        { source: "op" },
      );

      if (normalized.issue) {
        return {
          error: createGraphOpError(normalized.issue, opIndex, opType),
        };
      }

      snapshot.nodes.push(normalized.node);

      return { changed: true };
    }

    case "removeNode": {
      if (!isPlainObject(payload) || typeof payload.id !== "string") {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'removeNode payload must include string "id".',
          ),
        };
      }

      const nodeIndex = getNodeIndex(snapshot, payload.id);

      if (nodeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.NODE_NOT_FOUND,
              `Node "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      snapshot.nodes.splice(nodeIndex, 1);
      removeEdgesForNode(snapshot, payload.id);

      return { changed: true };
    }

    case "moveNode": {
      if (
        !isPlainObject(payload) ||
        typeof payload.id !== "string" ||
        !isPlainObject(payload.pos)
      ) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'moveNode payload must include "id" and "pos".',
          ),
        };
      }

      const nodeIndex = getNodeIndex(snapshot, payload.id);

      if (nodeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.NODE_NOT_FOUND,
              `Node "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      const normalizedPos = normalizeNodeRecord(
        {
          ...snapshot.nodes[nodeIndex],
          pos: payload.pos,
        },
        context.getNodeDefinition,
        snapshot.groups,
        { source: "op" },
      );

      if (normalizedPos.issue) {
        return {
          error: createGraphOpError(normalizedPos.issue, opIndex, opType),
        };
      }

      const previous = snapshot.nodes[nodeIndex].pos;

      if (previous.x === payload.pos.x && previous.y === payload.pos.y) {
        return { changed: false };
      }

      snapshot.nodes[nodeIndex] = {
        ...snapshot.nodes[nodeIndex],
        pos: normalizedPos.node.pos,
      };

      return { changed: true };
    }

    case "rotateNode": {
      if (
        !isPlainObject(payload) ||
        typeof payload.id !== "string" ||
        typeof payload.rot !== "number"
      ) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'rotateNode payload must include "id" and numeric "rot".',
          ),
        };
      }

      const nodeIndex = getNodeIndex(snapshot, payload.id);

      if (nodeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.NODE_NOT_FOUND,
              `Node "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      const normalizedNode = normalizeNodeRecord(
        {
          ...snapshot.nodes[nodeIndex],
          rot: payload.rot,
        },
        context.getNodeDefinition,
        snapshot.groups,
        { source: "op" },
      );

      if (normalizedNode.issue) {
        return {
          error: createGraphOpError(normalizedNode.issue, opIndex, opType),
        };
      }

      if (snapshot.nodes[nodeIndex].rot === payload.rot) {
        return { changed: false };
      }

      snapshot.nodes[nodeIndex] = {
        ...snapshot.nodes[nodeIndex],
        rot: normalizedNode.node.rot,
      };

      return { changed: true };
    }

    case "setParam": {
      if (
        !isPlainObject(payload) ||
        typeof payload.id !== "string" ||
        typeof payload.param !== "number" ||
        !Number.isFinite(payload.param)
      ) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'setParam payload must include "id" and numeric "param".',
          ),
        };
      }

      const nodeIndex = getNodeIndex(snapshot, payload.id);

      if (nodeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.NODE_NOT_FOUND,
              `Node "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      if (snapshot.nodes[nodeIndex].params.param === payload.param) {
        return { changed: false };
      }

      snapshot.nodes[nodeIndex] = {
        ...snapshot.nodes[nodeIndex],
        params: {
          ...snapshot.nodes[nodeIndex].params,
          param: payload.param,
        },
      };

      return { changed: true };
    }

    case "renameNode": {
      if (
        !isPlainObject(payload) ||
        typeof payload.id !== "string" ||
        typeof payload.name !== "string"
      ) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'renameNode payload must include "id" and string "name".',
          ),
        };
      }

      const nodeIndex = getNodeIndex(snapshot, payload.id);

      if (nodeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.NODE_NOT_FOUND,
              `Node "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      if (snapshot.nodes[nodeIndex].name === payload.name) {
        return { changed: false };
      }

      snapshot.nodes[nodeIndex] = {
        ...snapshot.nodes[nodeIndex],
        name: payload.name,
      };

      return { changed: true };
    }

    case "addEdge": {
      if (!isPlainObject(payload) || !("edge" in payload)) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'addEdge payload must include "edge".',
          ),
        };
      }

      const normalized = normalizeEdgeRecord(payload.edge, { source: "op" });

      if (normalized.issue) {
        return {
          error: createGraphOpError(normalized.issue, opIndex, opType),
        };
      }

      snapshot.edges.push(normalized.edge);

      return { changed: true };
    }

    case "removeEdge": {
      if (!isPlainObject(payload) || typeof payload.id !== "string") {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'removeEdge payload must include string "id".',
          ),
        };
      }

      const edgeIndex = getEdgeIndex(snapshot, payload.id);

      if (edgeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.EDGE_NOT_FOUND,
              `Edge "${payload.id}" was not found.`,
              payload.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      snapshot.edges.splice(edgeIndex, 1);

      return { changed: true };
    }

    case "addCorner":
    case "moveCorner":
    case "removeCorner": {
      if (!isPlainObject(payload) || typeof payload.edgeId !== "string") {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            `${opType} payload must include string "edgeId".`,
          ),
        };
      }

      const edgeIndex = getEdgeIndex(snapshot, payload.edgeId);

      if (edgeIndex === -1) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.EDGE_NOT_FOUND,
              `Edge "${payload.edgeId}" was not found.`,
              payload.edgeId,
            ),
            opIndex,
            opType,
          ),
        };
      }

      const edge = snapshot.edges[edgeIndex];

      if (!Number.isInteger(payload.index) || payload.index < 0) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            `${opType} payload must include a non-negative integer "index".`,
            payload.edgeId,
          ),
        };
      }

      if (opType === "addCorner") {
        if (!isPlainObject(payload.point)) {
          return {
            error: createInvalidOperation(
              opIndex,
              opType,
              'addCorner payload must include "point".',
              payload.edgeId,
            ),
          };
        }

        const normalized = normalizeGraphSnapshot(
          {
            nodes: [],
            edges: [
              {
                id: edge.id,
                from: edge.from,
                to: edge.to,
                manualCorners: [payload.point],
              },
            ],
          },
          context.getNodeDefinition,
          { allowGroups: false },
        );

        if (normalized.issue) {
          return {
            error: createGraphOpError(normalized.issue, opIndex, opType),
          };
        }

        if (payload.index > edge.manualCorners.length) {
          return {
            error: createInvalidOperation(
              opIndex,
              opType,
              `Corner index ${payload.index} is out of bounds for edge "${edge.id}".`,
              edge.id,
            ),
          };
        }

        const nextCorners = [...edge.manualCorners];
        nextCorners.splice(payload.index, 0, normalized.snapshot.edges[0].manualCorners[0]);
        snapshot.edges[edgeIndex] = {
          ...edge,
          manualCorners: nextCorners,
        };

        return { changed: true };
      }

      if (payload.index >= edge.manualCorners.length) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            `Corner index ${payload.index} is out of bounds for edge "${edge.id}".`,
            edge.id,
          ),
        };
      }

      if (opType === "removeCorner") {
        const nextCorners = [...edge.manualCorners];
        nextCorners.splice(payload.index, 1);
        snapshot.edges[edgeIndex] = {
          ...edge,
          manualCorners: nextCorners,
        };

        return { changed: true };
      }

      if (!isPlainObject(payload.point)) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'moveCorner payload must include "point".',
            payload.edgeId,
          ),
        };
      }

      const normalized = normalizeGraphSnapshot(
        {
          nodes: [],
          edges: [
            {
              id: edge.id,
              from: edge.from,
              to: edge.to,
              manualCorners: [payload.point],
            },
          ],
        },
        context.getNodeDefinition,
        { allowGroups: false },
      );

      if (normalized.issue) {
        return {
          error: createGraphOpError(normalized.issue, opIndex, opType),
        };
      }

      const point = normalized.snapshot.edges[0].manualCorners[0];
      const existingPoint = edge.manualCorners[payload.index];

      if (existingPoint.x === point.x && existingPoint.y === point.y) {
        return { changed: false };
      }

      const nextCorners = edge.manualCorners.map((corner, index) =>
        index === payload.index ? point : { ...corner },
      );

      snapshot.edges[edgeIndex] = {
        ...edge,
        manualCorners: nextCorners,
      };

      return { changed: true };
    }

    case "addGroup": {
      if (!isPlainObject(payload) || !("group" in payload)) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'addGroup payload must include "group".',
          ),
        };
      }

      const normalized = normalizeGroupDefinition(
        payload.group,
        context.getNodeDefinition,
      );

      if (normalized.issue) {
        return {
          error: createGraphOpError(normalized.issue, opIndex, opType),
        };
      }

      if (snapshot.groups?.[normalized.group.id]) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.DUPLICATE_ID,
              `Group "${normalized.group.id}" already exists.`,
              normalized.group.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      snapshot.groups = {
        ...(snapshot.groups ?? {}),
        [normalized.group.id]: normalized.group,
      };

      return { changed: true };
    }

    case "updateGroup": {
      if (!isPlainObject(payload) || !("group" in payload)) {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'updateGroup payload must include "group".',
          ),
        };
      }

      const normalized = normalizeGroupDefinition(
        payload.group,
        context.getNodeDefinition,
      );

      if (normalized.issue) {
        return {
          error: createGraphOpError(normalized.issue, opIndex, opType),
        };
      }

      if (!snapshot.groups?.[normalized.group.id]) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.GROUP_NOT_FOUND,
              `Group "${normalized.group.id}" was not found.`,
              normalized.group.id,
            ),
            opIndex,
            opType,
          ),
        };
      }

      snapshot.groups = {
        ...(snapshot.groups ?? {}),
        [normalized.group.id]: normalized.group,
      };

      return { changed: true };
    }

    case "removeGroup": {
      if (!isPlainObject(payload) || typeof payload.groupId !== "string") {
        return {
          error: createInvalidOperation(
            opIndex,
            opType,
            'removeGroup payload must include string "groupId".',
          ),
        };
      }

      if (!snapshot.groups?.[payload.groupId]) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.GROUP_NOT_FOUND,
              `Group "${payload.groupId}" was not found.`,
              payload.groupId,
            ),
            opIndex,
            opType,
          ),
        };
      }

      if (isGroupReferenced(snapshot.nodes, payload.groupId)) {
        return {
          error: createGraphOpError(
            createModelIssue(
              MODEL_ERROR_CODES.GROUP_REF_INVALID,
              `Group "${payload.groupId}" is still referenced by a node instance.`,
              payload.groupId,
            ),
            opIndex,
            opType,
          ),
        };
      }

      const nextGroups = { ...snapshot.groups };
      delete nextGroups[payload.groupId];
      snapshot.groups =
        Object.keys(nextGroups).length > 0 ? nextGroups : undefined;

      return { changed: true };
    }

    default:
      return {
        error: createInvalidOperation(
          opIndex,
          opType,
          `Unsupported graph op "${opType}".`,
        ),
      };
  }
}
