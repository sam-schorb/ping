import {
  clampDiscreteNodeValue,
  clonePulseParams,
} from "../nodes/behaviors/shared.js";
import { createRuntimeWarning, RUNTIME_WARNING_CODES } from "./errors.js";

export const DEFAULT_EVENT_SPEED = 1;
export const PULSE_SOURCE_PERIOD_TICKS = 1;
export const PULSE_SOURCE_PHASE_UNITS = 840;
export const INTERNAL_PULSE_EDGE_PREFIX = "__runtime:pulse:";
export const RUNTIME_EVENT_ROLES = Object.freeze({
  SIGNAL: "signal",
  CONTROL: "control",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isInternalPulseEdgeId(edgeId) {
  return typeof edgeId === "string" && edgeId.startsWith(INTERNAL_PULSE_EDGE_PREFIX);
}

export function createInternalPulseEdgeId(nodeId) {
  return `${INTERNAL_PULSE_EDGE_PREFIX}${nodeId}`;
}

export function hashNodeSeed(globalSeed, nodeId) {
  let hash = Number.isFinite(globalSeed) ? Math.trunc(globalSeed) >>> 0 : 0;

  for (let index = 0; index < nodeId.length; index += 1) {
    hash = Math.imul(hash ^ nodeId.charCodeAt(index), 16777619) >>> 0;
  }

  return hash >>> 0;
}

export function createNodeRng(seed) {
  let state = (seed >>> 0) || 1;

  return function nextRandom() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sanitizeParams(params, warnings, context = {}) {
  if (params === undefined) {
    return undefined;
  }

  if (!isPlainObject(params)) {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        `Invalid pulse params were dropped for node "${context.nodeId ?? "unknown"}".`,
        context,
      ),
    );
    return undefined;
  }

  const cloned = clonePulseParams(params);
  const sourceKeys = Object.keys(params);

  if (sourceKeys.length === 0) {
    return undefined;
  }

  const clonedKeys = Object.keys(cloned ?? {});
  const changed =
    clonedKeys.length !== sourceKeys.length ||
    clonedKeys.some((key) => cloned[key] !== Number(params[key]));

  if (changed) {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        `Invalid pulse params were dropped for node "${context.nodeId ?? "unknown"}".`,
        context,
      ),
    );
  }

  return cloned;
}

export function sanitizeRuntimeEvent(event, warnings) {
  if (!event || typeof event !== "object") {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        "Dropped a malformed runtime event.",
      ),
    );
    return null;
  }

  if (
    typeof event.nodeId !== "string" ||
    typeof event.edgeId !== "string" ||
    (event.role !== RUNTIME_EVENT_ROLES.SIGNAL &&
      event.role !== RUNTIME_EVENT_ROLES.CONTROL) ||
    !Number.isFinite(event.tick) ||
    !Number.isFinite(event.emitTime)
  ) {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        "Dropped a malformed runtime event.",
        {
          ...(typeof event.nodeId === "string" ? { nodeId: event.nodeId } : {}),
          ...(typeof event.edgeId === "string" ? { edgeId: event.edgeId } : {}),
        },
      ),
    );
    return null;
  }

  const value = clampDiscreteNodeValue(event.value);
  const speed = clampDiscreteNodeValue(
    event.speed,
    DEFAULT_EVENT_SPEED,
  );

  if (value !== event.value || speed !== event.speed) {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        `Clamped an invalid runtime event payload for node "${event.nodeId}".`,
        {
          nodeId: event.nodeId,
          edgeId: event.edgeId,
        },
      ),
    );
  }

  return {
    ...event,
    value,
    speed,
    params: sanitizeParams(event.params, warnings, {
      nodeId: event.nodeId,
      edgeId: event.edgeId,
    }),
  };
}

export function sanitizeNodeOutput(output, inheritedPulse, warnings, context = {}) {
  if (!output || typeof output !== "object") {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        `Dropped a malformed node output from node "${context.nodeId ?? "unknown"}".`,
        context,
      ),
    );
    return null;
  }

  const value = clampDiscreteNodeValue(output.value);
  const speed = clampDiscreteNodeValue(
    output.speed ?? inheritedPulse.speed ?? DEFAULT_EVENT_SPEED,
    DEFAULT_EVENT_SPEED,
  );
  const outPortIndex =
    Number.isInteger(output.outPortIndex) && output.outPortIndex >= 0
      ? output.outPortIndex
      : 0;

  if (
    value !== output.value ||
    speed !== (output.speed ?? inheritedPulse.speed ?? DEFAULT_EVENT_SPEED) ||
    outPortIndex !== (output.outPortIndex ?? 0)
  ) {
    warnings.push(
      createRuntimeWarning(
        RUNTIME_WARNING_CODES.INVALID_VALUE,
        `Clamped an invalid node output from node "${context.nodeId ?? "unknown"}".`,
        context,
      ),
    );
  }

  return {
    value,
    speed,
    outPortIndex,
    params: sanitizeParams(output.params ?? inheritedPulse.params, warnings, context),
  };
}

export function createScheduledEvent({
  tick,
  nodeId,
  edgeId,
  role,
  value,
  speed,
  params,
  emitTime,
  internal = false,
  sequence,
  ...extra
}) {
  return {
    tick,
    nodeId,
    edgeId,
    role,
    value,
    speed,
    params,
    emitTime,
    __internal: internal,
    __seq: sequence,
    ...extra,
  };
}

export function createInternalPulseSeedEvent(nodeId, tick, sequence) {
  return createInternalPulseSeedEventAtPhase(nodeId, tick, sequence, 0);
}

export function createInternalPulseSeedEventAtPhase(nodeId, tick, sequence, pulseUnits) {
  return createScheduledEvent({
    tick,
    nodeId,
    edgeId: createInternalPulseEdgeId(nodeId),
    role: "signal",
    value: 1,
    speed: DEFAULT_EVENT_SPEED,
    emitTime: tick,
    internal: true,
    sequence,
    ...(Number.isInteger(pulseUnits) ? { __pulseUnits: pulseUnits } : {}),
  });
}

export function createOutputEvent(event, nodeId) {
  const params = clonePulseParams(event.params);

  return {
    tick: event.tick,
    value: clampDiscreteNodeValue(event.value),
    ...(params ? { params } : {}),
    ...(nodeId !== undefined ? { nodeId } : {}),
    ...(event.edgeId !== undefined ? { edgeId: event.edgeId } : {}),
  };
}

export function previousFloat64(value) {
  if (Number.isNaN(value) || value === -Infinity) {
    return value;
  }

  if (value === Infinity) {
    return Number.MAX_VALUE;
  }

  if (Object.is(value, 0)) {
    return -Number.MIN_VALUE;
  }

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);

  bits = value > 0 ? bits - 1n : bits + 1n;
  view.setBigUint64(0, bits, false);

  return view.getFloat64(0, false);
}

export function cloneRuntimeState(state) {
  if (Array.isArray(state)) {
    return state.map((entry) => cloneRuntimeState(entry));
  }

  if (isPlainObject(state)) {
    return Object.fromEntries(
      Object.entries(state).map(([key, entry]) => [key, cloneRuntimeState(entry)]),
    );
  }

  return state;
}
