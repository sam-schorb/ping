export const NODE_MIN_VALUE = 1;
export const NODE_MAX_VALUE = 8;

export function clampNodeValue(value, fallback = NODE_MIN_VALUE) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(NODE_MAX_VALUE, Math.max(NODE_MIN_VALUE, numericValue));
}

export function clampDiscreteNodeValue(value, fallback = NODE_MIN_VALUE) {
  return Math.round(clampNodeValue(value, fallback));
}

export function clonePulseParams(params) {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const cloned = {};

  for (const [key, value] of Object.entries(params)) {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      cloned[key] = clampNodeValue(numericValue);
    }
  }

  return Object.keys(cloned).length > 0 ? cloned : undefined;
}

export function createOutput(value, overrides = {}) {
  const output = {
    value: clampNodeValue(value),
  };

  if (Number.isInteger(overrides.outPortIndex)) {
    output.outPortIndex = overrides.outPortIndex;
  }

  if (Object.hasOwn(overrides, "speed")) {
    output.speed = clampNodeValue(overrides.speed);
  }

  if (Object.hasOwn(overrides, "params")) {
    const params = clonePulseParams(overrides.params);

    if (params) {
      output.params = params;
    }
  }

  return output;
}

export function updatePulseParams(params, key, value) {
  return {
    ...(clonePulseParams(params) ?? {}),
    [key]: clampNodeValue(value),
  };
}

export function replaceState(state, patch) {
  return {
    ...(state && typeof state === "object" ? state : {}),
    ...patch,
  };
}
