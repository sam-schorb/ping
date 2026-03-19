import {
  AUDIO_EVENT_MAX_BYTES,
  AUDIO_MIN_RESYNC_GAP_SEC,
  AUDIO_RESYNC_EPSILON_SEC,
  DEFAULT_AUDIO_CONFIG,
  createAudioMetrics,
  snapshotAudioMetrics,
} from "./constants.js";
import { AUDIO_WARNING_CODES, createAudioWarning } from "./errors.js";
import {
  compareRuntimeOutputEvents,
  createAudioParamContext,
  normalizeTransport,
  resolveAudioBatchCap,
  secondsToTick,
} from "./mapper.js";
import { normalizeAudioSlots } from "./samples.js";

function createWarningBucket() {
  const warnings = new Map();

  return {
    warn(code, message, details = {}) {
      const key = `${code}:${details.slotId ?? ""}:${message}`;
      const entry = warnings.get(key);

      if (entry) {
        entry.count += 1;
        return;
      }

      warnings.set(key, {
        code,
        message,
        slotId: details.slotId,
        count: details.count ?? 1,
      });
    },
    flush() {
      return Array.from(warnings.values()).map((warning) =>
        createAudioWarning(warning.code, warning.message, {
          slotId: warning.slotId,
          count: warning.count,
        }),
      );
    },
  };
}

function isSameTransport(left, right) {
  return (
    left.bpm === right.bpm &&
    left.ticksPerBeat === right.ticksPerBeat &&
    left.originSec === right.originSec
  );
}

function normalizeAudioConfig(config) {
  return {
    lookaheadSec:
      Number.isFinite(config?.lookaheadSec) && config.lookaheadSec >= 0
        ? config.lookaheadSec
        : DEFAULT_AUDIO_CONFIG.lookaheadSec,
    horizonSec:
      Number.isFinite(config?.horizonSec) && config.horizonSec > 0
        ? config.horizonSec
        : DEFAULT_AUDIO_CONFIG.horizonSec,
  };
}

function shouldResyncClock(previousT1, clockWindow, config) {
  if (!Number.isFinite(previousT1)) {
    return false;
  }

  const gap = clockWindow.t0 - previousT1;
  const maxExpectedGap = Math.max(
    AUDIO_MIN_RESYNC_GAP_SEC,
    Number.isFinite(clockWindow.latency) ? clockWindow.latency * 2 : 0,
    config.lookaheadSec + config.horizonSec,
  );

  return gap < -AUDIO_RESYNC_EPSILON_SEC || gap > maxExpectedGap;
}

function groupEventsByTick(events) {
  const groups = [];

  for (const event of events) {
    const lastGroup = groups.at(-1);

    if (lastGroup && lastGroup.tick === event.tick) {
      lastGroup.events.push(event);
      continue;
    }

    groups.push({
      tick: event.tick,
      events: [event],
    });
  }

  return groups;
}

export function createAudioBridge(opts) {
  const runtime = opts.runtime;
  const registry = opts.registry;
  const engine = opts.engine;
  const logger = opts.logger ?? console;
  const onWarning = typeof opts.onWarning === "function" ? opts.onWarning : null;
  const paramContext = createAudioParamContext(registry);

  let transport = normalizeTransport(opts.transport);
  let config = normalizeAudioConfig(opts.config);
  let slots = normalizeAudioSlots(opts.getSlots?.());
  let metrics = createAudioMetrics();
  let started = false;
  let clockAttached = false;
  let attachPromise = null;
  let detachClockListener = null;
  let lastClockT1 = Number.NaN;
  let sampleLoadPromise = Promise.resolve();

  function publishWarnings(warnings) {
    for (const warning of warnings) {
      onWarning?.(warning);
      const suffix = [
        warning.slotId ? `slot=${warning.slotId}` : null,
        warning.count && warning.count > 1 ? `count=${warning.count}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      logger?.warn?.(
        `[${warning.code}] ${warning.message}${suffix ? ` (${suffix})` : ""}`,
      );
    }
  }

  function resetWatermark() {
    metrics.lastScheduledTick = Number.NEGATIVE_INFINITY;
  }

  async function reloadSamples() {
    sampleLoadPromise = (async () => {
      try {
        await engine.syncSlots(slots);
      } catch (error) {
        publishWarnings([
          createAudioWarning(
            AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
            `Failed to load sample slots: ${error?.message ?? "unknown error"}.`,
          ),
        ]);
      }
    })();

    await sampleLoadPromise;
  }

  async function handleClockWindow(clockWindow) {
    if (!started || !clockWindow?.clock) {
      return;
    }

    await sampleLoadPromise;

    if (!started || !clockWindow?.clock) {
      return;
    }

    const warningBucket = createWarningBucket();

    if (shouldResyncClock(lastClockT1, clockWindow, config)) {
      resetWatermark();
      warningBucket.warn(
        AUDIO_WARNING_CODES.CLOCK_RESYNC,
        "Audio clock resynced; scheduling watermark was reset.",
      );
      lastClockT1 = clockWindow.t1;
      publishWarnings(warningBucket.flush());
      return;
    }

    lastClockT1 = clockWindow.t1;

    const tStartTick = secondsToTick(clockWindow.t1, transport);
    const tEndTick = secondsToTick(
      clockWindow.t1 + config.lookaheadSec + config.horizonSec,
      transport,
    );
    const runtimeEvents = runtime
      .queryWindow(tStartTick, tEndTick)
      .sort(compareRuntimeOutputEvents);
    const batchCap = resolveAudioBatchCap(engine);
    let scheduledThisWindow = 0;

    for (const group of groupEventsByTick(runtimeEvents)) {
      if (!(group.tick > metrics.lastScheduledTick)) {
        continue;
      }

      for (const runtimeEvent of group.events) {
        const doughEvent = engine.createPlaybackEvent({
          runtimeEvent,
          transport,
          slots,
          paramContext,
          emitWarning(code, message, details) {
            warningBucket.warn(code, message, details);
          },
        });

        if (!doughEvent) {
          continue;
        }

        if (!(doughEvent.time > clockWindow.t1)) {
          metrics.droppedLate += 1;
          warningBucket.warn(
            AUDIO_WARNING_CODES.LATE_EVENT,
            `Dropped a late audio event at tick ${runtimeEvent.tick}.`,
          );
          continue;
        }

        if (
          scheduledThisWindow >= batchCap ||
          engine.measureEventSize(doughEvent) > AUDIO_EVENT_MAX_BYTES
        ) {
          metrics.droppedOverflow += 1;
          warningBucket.warn(
            AUDIO_WARNING_CODES.DROPPED_OVERFLOW,
            "Dropped audio events because the Dough submission window is full.",
          );
          continue;
        }

        try {
          await engine.schedule(doughEvent);
          scheduledThisWindow += 1;
          metrics.scheduled += 1;
        } catch (error) {
          warningBucket.warn(
            AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
            `Failed to schedule a Dough event: ${error?.message ?? "unknown error"}.`,
          );
        }
      }

      metrics.lastScheduledTick = group.tick;
    }

    publishWarnings(warningBucket.flush());
  }

  async function attachClockListener() {
    if (clockAttached || attachPromise) {
      return attachPromise;
    }

    attachPromise = (async () => {
      try {
        detachClockListener = await engine.attachClockListener(handleClockWindow);
      } catch (error) {
        publishWarnings([
          createAudioWarning(
            AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
            `Audio engine failed to become ready: ${error?.message ?? "unknown error"}.`,
          ),
        ]);
        return;
      }

      if (!started) {
        detachClockListener?.();
        detachClockListener = null;
        return;
      }
      clockAttached = true;
    })();

    try {
      await attachPromise;
    } finally {
      attachPromise = null;
    }
  }

  return {
    start() {
      if (started) {
        return;
      }

      slots = normalizeAudioSlots(opts.getSlots?.());
      started = true;
      void reloadSamples();
      void attachClockListener();
    },
    stop() {
      started = false;
      lastClockT1 = Number.NaN;
      detachClockListener?.();
      detachClockListener = null;
      clockAttached = false;
    },
    updateTransport(nextTransport) {
      const normalized = normalizeTransport(nextTransport, transport);
      const changed = !isSameTransport(transport, normalized);
      transport = normalized;

      if (changed) {
        resetWatermark();
      }
    },
    updateSlots(nextSlots) {
      slots = normalizeAudioSlots(nextSlots ?? opts.getSlots?.());

      if (started) {
        void reloadSamples();
      }
    },
    updateConfig(nextConfig) {
      config = normalizeAudioConfig(nextConfig);
    },
    getMetrics() {
      return snapshotAudioMetrics(metrics);
    },
  };
}
