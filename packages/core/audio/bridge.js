import {
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
  createDoughPlaybackEvent,
  isOversizeDoughEvent,
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

async function defaultLoadSamples() {}

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
  const dough = opts.dough;
  const logger = opts.logger ?? console;
  const onWarning = typeof opts.onWarning === "function" ? opts.onWarning : null;
  const loadSamples = typeof opts.loadSamples === "function" ? opts.loadSamples : defaultLoadSamples;
  const paramContext = createAudioParamContext(registry);

  let transport = normalizeTransport(opts.transport);
  let config = normalizeAudioConfig(opts.config);
  let slots = normalizeAudioSlots(opts.getSlots?.());
  let metrics = createAudioMetrics();
  let started = false;
  let clockAttached = false;
  let attachPromise = null;
  let previousClockHandler = null;
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
        await loadSamples(slots);
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

    const tStartTick = secondsToTick(clockWindow.t1 + config.lookaheadSec, transport);
    const tEndTick = secondsToTick(
      clockWindow.t1 + config.lookaheadSec + config.horizonSec,
      transport,
    );
    const runtimeEvents = runtime
      .queryWindow(tStartTick, tEndTick)
      .sort(compareRuntimeOutputEvents);
    const batchCap = resolveAudioBatchCap(dough);
    let scheduledThisWindow = 0;

    for (const group of groupEventsByTick(runtimeEvents)) {
      if (!(group.tick > metrics.lastScheduledTick)) {
        continue;
      }

      for (const runtimeEvent of group.events) {
        const doughEvent = createDoughPlaybackEvent({
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

        if (scheduledThisWindow >= batchCap || isOversizeDoughEvent(dough, doughEvent)) {
          metrics.droppedOverflow += 1;
          warningBucket.warn(
            AUDIO_WARNING_CODES.DROPPED_OVERFLOW,
            "Dropped audio events because the Dough submission window is full.",
          );
          continue;
        }

        try {
          await dough.evaluate(doughEvent);
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
        await Promise.resolve(dough.ready);
      } catch (error) {
        publishWarnings([
          createAudioWarning(
            AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
            `Dough failed to become ready: ${error?.message ?? "unknown error"}.`,
          ),
        ]);
        return;
      }

      if (!started) {
        return;
      }

      const port = dough.worklet?.port;

      if (!port) {
        publishWarnings([
          createAudioWarning(
            AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
            "Dough worklet is not ready for clock-driven scheduling.",
          ),
        ]);
        return;
      }

      previousClockHandler = port.onmessage;
      port.onmessage = async (event) => {
        if (typeof previousClockHandler === "function") {
          await previousClockHandler(event);
        }

        await handleClockWindow(event?.data);
      };
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

      if (clockAttached && dough.worklet?.port) {
        dough.worklet.port.onmessage = previousClockHandler;
      }

      previousClockHandler = null;
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
      void reloadSamples();
    },
    updateConfig(nextConfig) {
      config = normalizeAudioConfig(nextConfig);
    },
    getMetrics() {
      return snapshotAudioMetrics(metrics);
    },
  };
}
