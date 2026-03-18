import { SAMPLE_SLOT_COUNT, createDefaultSampleSlots } from "../serialisation/errors.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAudioSlots(slots) {
  const fallbackSlots = createDefaultSampleSlots();

  if (!Array.isArray(slots) || slots.length !== SAMPLE_SLOT_COUNT) {
    return fallbackSlots;
  }

  return Array.from({ length: SAMPLE_SLOT_COUNT }, (_, index) => {
    const rawSlot = slots[index];
    const fallback = fallbackSlots[index];

    if (!isPlainObject(rawSlot)) {
      return fallback;
    }

    return {
      id:
        typeof rawSlot.id === "string" && rawSlot.id.trim() !== ""
          ? rawSlot.id
          : fallback.id,
      path: typeof rawSlot.path === "string" ? rawSlot.path : "",
    };
  });
}

export function getSlotForValue(value, slots) {
  const index = Math.min(SAMPLE_SLOT_COUNT, Math.max(1, Math.round(Number(value) || 1))) - 1;
  const normalizedSlots = normalizeAudioSlots(slots);

  return {
    index,
    slot: normalizedSlots[index],
  };
}

export function createDoughSampleMap(slots) {
  const sampleMap = {};

  for (const slot of normalizeAudioSlots(slots)) {
    if (typeof slot.path === "string" && slot.path.trim() !== "") {
      sampleMap[slot.id] = [slot.path];
    }
  }

  return sampleMap;
}
