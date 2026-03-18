import { DEFAULT_TEMPO_BPM } from "../serialisation/errors.js";

export const DEFAULT_AUDIO_CONFIG = Object.freeze({
  lookaheadSec: 0.06,
  horizonSec: 0.1,
});

export const DEFAULT_TRANSPORT = Object.freeze({
  bpm: DEFAULT_TEMPO_BPM,
  ticksPerBeat: 1,
  originSec: 0,
});

export const AUDIO_EVENT_MAX_BYTES = 1024;
export const AUDIO_RESYNC_EPSILON_SEC = 0.001;
export const AUDIO_MIN_RESYNC_GAP_SEC = 0.1;

export const AUDIO_PARAM_TABLES = Object.freeze({
  pitchTable: Object.freeze({
    1: 1,
    2: 1.5,
    3: 2,
    4: 2.5,
    5: 3,
    6: 3.5,
    7: 4,
    8: 4.5,
  }),
  endTable: Object.freeze({
    1: 1,
    2: 0.875,
    3: 0.75,
    4: 0.625,
    5: 0.5,
    6: 0.375,
    7: 0.25,
    8: 0.125,
  }),
  crushTable: Object.freeze({
    1: 16,
    2: 14,
    3: 12,
    4: 10,
    5: 8,
    6: 6,
    7: 4,
    8: 2,
  }),
  hpfTable: Object.freeze({
    1: 100,
    2: 200,
    3: 400,
    4: 800,
    5: 1600,
    6: 3200,
    7: 6400,
    8: 12000,
  }),
  lpfTable: Object.freeze({
    1: 12000,
    2: 6400,
    3: 3200,
    4: 1600,
    5: 800,
    6: 400,
    7: 200,
    8: 100,
  }),
});

export function createAudioMetrics() {
  return {
    scheduled: 0,
    droppedLate: 0,
    droppedOverflow: 0,
    lastScheduledTick: Number.NEGATIVE_INFINITY,
  };
}

export function snapshotAudioMetrics(metrics) {
  return {
    scheduled: metrics.scheduled,
    droppedLate: metrics.droppedLate,
    droppedOverflow: metrics.droppedOverflow,
    lastScheduledTick: metrics.lastScheduledTick,
  };
}
