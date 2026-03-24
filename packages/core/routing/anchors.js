import { getPortSideSlot } from "../nodes/archetypes.js";
import { getGroupPortCounts } from "../nodes/grouped-node.js";
import { isGroupBackedNodeType } from "../graph/constants.js";
import { DEFAULT_ROUTING_CONFIG, ROTATION_VECTORS, SIDE_NORMALS } from "./constants.js";
import { ROUTING_ERROR_CODES, createRoutingError } from "./errors.js";

function countPortsBySide(layout) {
  const counts = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };

  for (const port of [...layout.inputs, ...layout.outputs]) {
    counts[port.side] += 1;
  }

  return counts;
}

function resolveNodeLayoutInfo(node, snapshot, registry, edgeId) {
  const definition = registry.getNodeDefinition(node.type);

  if (!definition) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.ANCHOR_FAIL,
      edgeId,
      `Node "${node.id}" uses unknown type "${node.type}" during routing.`,
    );
  }

  const counts =
    isGroupBackedNodeType(node.type) && node.groupRef && snapshot.groups?.[node.groupRef]
      ? getGroupPortCounts(snapshot.groups[node.groupRef])
      : {
          inputs: definition.inputs,
          outputs: definition.outputs,
          controlPorts: definition.controlPorts,
        };

  let layout;

  try {
    layout = registry.getLayout(
      definition.layout,
      counts.inputs,
      counts.outputs,
      counts.controlPorts,
    );
  } catch (error) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.ANCHOR_FAIL,
      edgeId,
      `Failed to derive layout for node "${node.id}".`,
    );
  }

  const sideCounts = countPortsBySide(layout);
  const size = Math.max(1, ...Object.values(sideCounts)) + 1;

  return {
    definition,
    layout,
    size,
  };
}

function resolvePortDefinition(node, direction, slotId, snapshot, registry, edgeId) {
  const { definition, layout, size } = resolveNodeLayoutInfo(
    node,
    snapshot,
    registry,
    edgeId,
  );
  const ports = direction === "out" ? layout.outputs : layout.inputs;
  const port = ports.find((entry) => entry.index === slotId);

  if (!port) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.INVALID_PORT,
      edgeId,
      `Node "${node.id}" does not have ${direction} port ${slotId}.`,
    );
  }

  const sideSlot = getPortSideSlot(port, ports);

  let local;

  if (port.side === "left") {
    local = {
      x: 0,
      y: sideSlot,
    };
  } else if (port.side === "right") {
    local = {
      x: size,
      y: sideSlot,
    };
  } else if (port.side === "top") {
    local = {
      x: sideSlot,
      y: 0,
    };
  } else if (port.side === "bottom") {
    local = {
      x: sideSlot,
      y: size,
    };
  } else {
    throw createRoutingError(
      ROUTING_ERROR_CODES.ANCHOR_FAIL,
      edgeId,
      `Node "${node.id}" uses unsupported side "${port.side}" for routing.`,
    );
  }

  if (!Number.isInteger(local.x) || !Number.isInteger(local.y) || local.x < 0 || local.y < 0) {
    throw createRoutingError(
      ROUTING_ERROR_CODES.ANCHOR_FAIL,
      edgeId,
      `Failed to derive a valid anchor for node "${node.id}" port ${slotId}.`,
    );
  }

  return {
    definition,
    layout,
    size,
    local,
    side: port.side,
  };
}

export function getNodeRoutingBounds(node, snapshot, registry, edgeId) {
  const { size } = resolveNodeLayoutInfo(node, snapshot, registry, edgeId);

  return {
    x0: node.pos.x,
    y0: node.pos.y,
    x1: node.pos.x + size,
    y1: node.pos.y + size,
  };
}

function rotateLocalPoint(local, size, rot) {
  if (rot === 0) {
    return local;
  }

  if (rot === 90) {
    return { x: size - local.y, y: local.x };
  }

  if (rot === 180) {
    return { x: size - local.x, y: size - local.y };
  }

  return { x: local.y, y: size - local.x };
}

export function resolveRoutingConfig(config = {}) {
  const merged = {
    ...DEFAULT_ROUTING_CONFIG,
    ...(config ?? {}),
  };

  if (
    typeof merged.ticksPerGrid !== "number" ||
    !Number.isFinite(merged.ticksPerGrid) ||
    merged.ticksPerGrid < 0
  ) {
    throw new Error("Routing config ticksPerGrid must be a finite number >= 0.");
  }

  if (
    !Number.isInteger(merged.stubLength) ||
    merged.stubLength < 0
  ) {
    throw new Error("Routing config stubLength must be an integer >= 0.");
  }

  if (
    merged.bendPreference !== "horizontal-first" &&
    merged.bendPreference !== "vertical-first"
  ) {
    throw new Error(
      'Routing config bendPreference must be "horizontal-first" or "vertical-first".',
    );
  }

  return merged;
}

export function getPortAnchor(node, direction, slotId, snapshot, registry, edgeId, config = DEFAULT_ROUTING_CONFIG) {
  const resolvedConfig = resolveRoutingConfig(config);
  const resolved = resolvePortDefinition(
    node,
    direction,
    slotId,
    snapshot,
    registry,
    edgeId,
  );
  const rotatedLocal = rotateLocalPoint(resolved.local, resolved.size, node.rot ?? 0);
  const rotatedNormal = ROTATION_VECTORS[node.rot ?? 0](SIDE_NORMALS[resolved.side]);

  return {
    point: {
      x: node.pos.x + rotatedLocal.x,
      y: node.pos.y + rotatedLocal.y,
    },
    outward: rotatedNormal,
    side: resolved.side,
    size: resolved.size,
    bendPreference: resolvedConfig.bendPreference,
  };
}
