export const AUDIO_WARNING_CODES = Object.freeze({
  LATE_EVENT: "AUDIO_LATE_EVENT",
  DROPPED_OVERFLOW: "AUDIO_DROPPED_OVERFLOW",
  MISSING_SAMPLE: "AUDIO_MISSING_SAMPLE",
  DOH_EVAL_FAIL: "AUDIO_DOH_EVAL_FAIL",
  CLOCK_RESYNC: "AUDIO_CLOCK_RESYNC",
});

export function createAudioWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...(details.slotId !== undefined ? { slotId: details.slotId } : {}),
    ...(details.count !== undefined ? { count: details.count } : {}),
  };
}
