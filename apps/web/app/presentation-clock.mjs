export function getClockTimeSec(preferredAudioContext = null, fallbackNowMs = null) {
  const audioContext = preferredAudioContext ?? null;

  if (audioContext && Number.isFinite(audioContext.currentTime)) {
    return audioContext.currentTime;
  }

  if (Number.isFinite(fallbackNowMs)) {
    return fallbackNowMs / 1000;
  }

  return performance.now() / 1000;
}

export function getAudibleLatencySec(preferredAudioContext = null) {
  const audioContext = preferredAudioContext ?? null;

  if (!audioContext) {
    return 0;
  }

  const baseLatency = Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency : 0;
  const outputLatency = Number.isFinite(audioContext.outputLatency)
    ? audioContext.outputLatency
    : 0;

  return Math.max(0, baseLatency + outputLatency);
}

export function getAudibleClockTimeSec(preferredAudioContext = null, fallbackNowMs = null) {
  const audioContext = preferredAudioContext ?? null;

  return Math.max(
    0,
    getClockTimeSec(audioContext, fallbackNowMs) - getAudibleLatencySec(audioContext),
  );
}

export function getPresentationClockTimeSec(
  preferredAudioContext = null,
  fallbackNowMs = null,
) {
  return getClockTimeSec(preferredAudioContext, fallbackNowMs);
}

export function tickFromTransport(transport, nowTimeSec) {
  if (!(transport?.bpm > 0) || !Number.isFinite(nowTimeSec)) {
    return Number.isFinite(transport?.originTick) ? transport.originTick : 0;
  }

  return transport.originTick + (nowTimeSec - transport.originTimeSec) * (transport.bpm / 60);
}
