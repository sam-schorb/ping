import { clampDiscreteNodeValue, clonePulseParams } from "../nodes/behaviors/shared.js";
import { NODE_REGISTRY } from "../nodes/index.js";
import { AUDIO_EVENT_MAX_BYTES, AUDIO_PARAM_TABLES, DEFAULT_TRANSPORT } from "./constants.js";
import { AUDIO_WARNING_CODES } from "./errors.js";
import { getSlotForValue } from "./samples.js";

function compareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function getRegistryDefinition(registry, type) {
  return registry?.getNodeDefinition?.(type) ?? NODE_REGISTRY.find((entry) => entry.type === type);
}

export function compareRuntimeOutputEvents(left, right) {
  if (left.tick !== right.tick) {
    return left.tick - right.tick;
  }

  const nodeCompare = compareText(left.nodeId, right.nodeId);

  if (nodeCompare !== 0) {
    return nodeCompare;
  }

  const edgeCompare = compareText(left.edgeId, right.edgeId);

  if (edgeCompare !== 0) {
    return edgeCompare;
  }

  return clampDiscreteNodeValue(left.value) - clampDiscreteNodeValue(right.value);
}

export function tickToSeconds(tick, transport) {
  const resolved = normalizeTransport(transport);
  const secondsPerTick = 60 / (resolved.bpm * resolved.ticksPerBeat);

  return resolved.originSec + tick * secondsPerTick;
}

export function secondsToTick(timeSec, transport) {
  const resolved = normalizeTransport(transport);
  const secondsPerTick = 60 / (resolved.bpm * resolved.ticksPerBeat);

  return (timeSec - resolved.originSec) / secondsPerTick;
}

export function normalizeTransport(transport, fallback = DEFAULT_TRANSPORT) {
  return {
    bpm:
      Number.isFinite(transport?.bpm) && transport.bpm > 0
        ? transport.bpm
        : fallback.bpm,
    ticksPerBeat:
      Number.isFinite(transport?.ticksPerBeat) && transport.ticksPerBeat > 0
        ? transport.ticksPerBeat
        : fallback.ticksPerBeat,
    originSec: Number.isFinite(transport?.originSec) ? transport.originSec : fallback.originSec,
  };
}

export function createAudioParamContext(registry) {
  const descriptors = [];

  for (const entry of NODE_REGISTRY) {
    const definition = getRegistryDefinition(registry, entry.type);

    if (!definition?.paramMap || typeof definition.paramMap !== "object") {
      continue;
    }

    const [paramMeta] = Object.values(definition.paramMap);

    if (
      !paramMeta ||
      typeof paramMeta !== "object" ||
      typeof paramMeta.target !== "string" ||
      typeof paramMeta.mapping !== "string"
    ) {
      continue;
    }

    descriptors.push({
      sourceKey: definition.type,
      targetKey: paramMeta.target,
      mappingKey: paramMeta.mapping,
      defaultValue: clampDiscreteNodeValue(definition.defaultParam, 1),
    });
  }

  return {
    descriptors,
    defaultParams: Object.freeze(
      Object.fromEntries(
        descriptors.map((descriptor) => [descriptor.sourceKey, descriptor.defaultValue]),
      ),
    ),
  };
}

export function fillRuntimeParams(params, paramContext) {
  const normalized = {
    ...(paramContext?.defaultParams ?? {}),
  };
  const cloned = clonePulseParams(params) ?? {};

  for (const [key, value] of Object.entries(cloned)) {
    normalized[key] = clampDiscreteNodeValue(value);
  }

  return normalized;
}

export function mapRuntimeParamsToDough(normalizedParams, paramContext, emitWarning) {
  const doughParams = {};

  for (const descriptor of paramContext.descriptors) {
    const table = AUDIO_PARAM_TABLES[descriptor.mappingKey];

    if (!table) {
      emitWarning?.(
        AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
        `Ignored unsupported audio mapping "${descriptor.mappingKey}".`,
      );
      continue;
    }

    const discreteValue = clampDiscreteNodeValue(
      normalizedParams[descriptor.sourceKey],
      descriptor.defaultValue,
    );
    doughParams[descriptor.targetKey] = table[discreteValue];
  }

  return doughParams;
}

function encodeWithFallback(dough, event) {
  if (typeof dough?.encodeEvent === "function") {
    return dough.encodeEvent(event);
  }

  const encoder = new TextEncoder();
  const entries = [];

  for (const [key, value] of Object.entries(event)) {
    entries.push(`${key}/${value}`);
  }

  return encoder.encode(`${entries.join("/")}\0`);
}

export function resolveDoughEventSize(dough, event) {
  return encodeWithFallback(dough, event).length;
}

export function createDoughPlaybackEvent({
  runtimeEvent,
  transport,
  slots,
  paramContext,
  emitWarning,
}) {
  const { slot } = getSlotForValue(runtimeEvent.value, slots);

  if (!slot || typeof slot.path !== "string" || slot.path.trim() === "") {
    emitWarning?.(
      AUDIO_WARNING_CODES.MISSING_SAMPLE,
      `No sample is configured for slot "${slot?.id ?? "unknown"}".`,
      {
        slotId: slot?.id,
      },
    );
    return null;
  }

  const filledParams = fillRuntimeParams(runtimeEvent.params, paramContext);
  const mappedParams = mapRuntimeParamsToDough(filledParams, paramContext, emitWarning);

  return {
    time: tickToSeconds(runtimeEvent.tick, transport),
    dough: "play",
    s: slot.id,
    n: 0,
    ...mappedParams,
  };
}

export function resolveAudioBatchCap(dough) {
  const maxEvents =
    Number.isFinite(dough?.MAX_EVENTS) && dough.MAX_EVENTS > 0 ? dough.MAX_EVENTS : Infinity;
  const maxVoices =
    Number.isFinite(dough?.MAX_VOICES) && dough.MAX_VOICES > 0 ? dough.MAX_VOICES : Infinity;

  return Math.min(maxEvents, maxVoices);
}

export function isOversizeDoughEvent(dough, event) {
  return resolveDoughEventSize(dough, event) > AUDIO_EVENT_MAX_BYTES;
}
