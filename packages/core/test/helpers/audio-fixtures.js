import { readFile } from "node:fs/promises";

import {
  createAudioParamContext,
  createDefaultSampleSlots,
  createDoughPlaybackEvent,
  getNodeDefinition,
} from "../../src/index.js";

const FIXTURE_ROOT = new URL("../fixtures/audio/", import.meta.url);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }

  return value;
}

export async function loadAudioFixture(name) {
  const text = await readFile(new URL(name, FIXTURE_ROOT), "utf8");
  return JSON.parse(text);
}

export function createAudioRuntimeStub(events = [], options = {}) {
  const pending = events.map((event) => cloneValue(event));
  const queries = [];
  const repeat = options.repeat === true;
  const respectWindow = options.respectWindow !== false;

  return {
    queries,
    queryWindow(t0Tick, t1Tick) {
      queries.push([t0Tick, t1Tick]);

      const matches = pending.filter((event) => {
        if (!respectWindow) {
          return true;
        }

        return event.tick >= t0Tick && event.tick < t1Tick;
      });

      if (!repeat) {
        for (const event of matches) {
          const index = pending.indexOf(event);

          if (index >= 0) {
            pending.splice(index, 1);
          }
        }
      }

      return matches.map((event) => cloneValue(event));
    },
    resetPulses() {},
  };
}

export function createFakeDough(options = {}) {
  const calls = [];
  const encoder = new TextEncoder();
  const port = {
    onmessage: async () => {},
  };
  const maybeLoadCalls = [];
  const stopWorkletCalls = [];
  const resumeCalls = [];
  let currentAudioContext = options.audioContext ?? null;

  const dough = {
    ready: options.ready ?? Promise.resolve(),
    initAudio: options.initAudio ?? Promise.resolve(currentAudioContext),
    worklet: {
      port,
    },
    MAX_EVENTS: options.MAX_EVENTS ?? 64,
    MAX_VOICES: options.MAX_VOICES ?? 32,
    get audioContext() {
      return currentAudioContext;
    },
    set audioContext(value) {
      currentAudioContext = value;
    },
    encodeEvent(event) {
      if (typeof options.encodeEvent === "function") {
        return options.encodeEvent(event);
      }

      const payload = Object.entries(event)
        .map(([key, value]) => `${key}/${value}`)
        .join("/");
      return encoder.encode(`${payload}\0`);
    },
    async evaluate(event) {
      calls.push(cloneValue(event));

      if (typeof options.evaluate === "function") {
        return options.evaluate(event);
      }

      if (options.evaluateError) {
        throw options.evaluateError;
      }

      return undefined;
    },
    async maybeLoadFile(event) {
      maybeLoadCalls.push(cloneValue(event));

      if (typeof options.maybeLoadFile === "function") {
        return options.maybeLoadFile(event);
      }

      return undefined;
    },
    async resume() {
      resumeCalls.push({ at: Date.now() });

      if (typeof options.resume === "function") {
        return options.resume();
      }

      return undefined;
    },
    async stopWorklet() {
      stopWorkletCalls.push({ at: Date.now() });

      if (typeof options.stopWorklet === "function") {
        return options.stopWorklet();
      }

      return undefined;
    },
    async emitClock(clock) {
      if (typeof port.onmessage === "function") {
        await port.onmessage({
          data: {
            clock: true,
            ...clock,
          },
        });
      }
    },
  };

  Object.defineProperty(dough, "calls", {
    get() {
      return calls.map((entry) => cloneValue(entry));
    },
  });
  Object.defineProperty(dough, "maybeLoadCalls", {
    get() {
      return maybeLoadCalls.map((entry) => cloneValue(entry));
    },
  });
  Object.defineProperty(dough, "resumeCalls", {
    get() {
      return resumeCalls.length;
    },
  });
  Object.defineProperty(dough, "stopWorkletCalls", {
    get() {
      return stopWorkletCalls.length;
    },
  });

  return dough;
}

export function createFakeAudioEngine(options = {}) {
  const calls = [];
  const slotSyncCalls = [];
  const encoder = new TextEncoder();
  const registry = options.registry ?? createRegistryApi();
  const paramContext = createAudioParamContext(registry);
  let clockListener = null;
  const slotTargets = new Map();

  function applySlotBindings(slots, bindings = options.bindings) {
    slotTargets.clear();

    for (const slot of slots ?? []) {
      if (!slot?.id) {
        continue;
      }

      const override = typeof bindings === "function" ? bindings(slot) : bindings?.[slot.id];
      if (override === null) {
        continue;
      }

      if (override && typeof override === "object") {
        slotTargets.set(slot.id, {
          sound: override.sound ?? override.s ?? slot.id,
          index: Number.isFinite(override.index) ? override.index : 0,
        });
        continue;
      }

      slotTargets.set(slot.id, {
        sound: slot.id,
        index: 0,
      });
    }
  }

  return {
    MAX_EVENTS: options.MAX_EVENTS ?? 64,
    MAX_VOICES: options.MAX_VOICES ?? 32,
    async arm() {
      if (typeof options.arm === "function") {
        return options.arm();
      }

      return options.audioContext ?? null;
    },
    async dispose() {
      if (typeof options.dispose === "function") {
        return options.dispose();
      }

      return undefined;
    },
    async attachClockListener(listener) {
      clockListener = listener;

      if (typeof options.attachClockListener === "function") {
        return options.attachClockListener(listener);
      }

      return () => {
        if (clockListener === listener) {
          clockListener = null;
        }
      };
    },
    async emitClock(clock) {
      await clockListener?.({
        clock: true,
        ...cloneValue(clock),
      });
    },
    async syncSlots(slots) {
      const cloned = cloneValue(slots);
      slotSyncCalls.push(cloned);
      applySlotBindings(cloned);

      if (typeof options.syncSlots === "function") {
        return options.syncSlots(cloned);
      }

      return undefined;
    },
    createPlaybackEvent({ runtimeEvent, transport, slots, emitWarning }) {
      if (typeof options.createPlaybackEvent === "function") {
        return options.createPlaybackEvent({
          runtimeEvent,
          transport,
          slots,
          paramContext,
          emitWarning,
        });
      }

      return createDoughPlaybackEvent({
        runtimeEvent,
        transport,
        slots,
        paramContext,
        emitWarning,
        resolveSampleTarget(slot) {
          return slotTargets.get(slot.id) ?? { sound: slot.id, index: 0 };
        },
      });
    },
    measureEventSize(event) {
      if (typeof options.measureEventSize === "function") {
        return options.measureEventSize(event);
      }

      if (typeof options.encodeEvent === "function") {
        return options.encodeEvent(event).length;
      }

      const payload = Object.entries(event)
        .map(([key, value]) => `${key}/${value}`)
        .join("/");
      return encoder.encode(`${payload}\0`).length;
    },
    async schedule(event) {
      calls.push(cloneValue(event));

      if (typeof options.schedule === "function") {
        return options.schedule(event);
      }

      if (options.scheduleError) {
        throw options.scheduleError;
      }

      return undefined;
    },
    getAudioContext() {
      return options.audioContext ?? null;
    },
    get calls() {
      return calls.map((entry) => cloneValue(entry));
    },
    get slotSyncCalls() {
      return slotSyncCalls.map((entry) => cloneValue(entry));
    },
  };
}

export function createRegistryApi() {
  return {
    getNodeDefinition,
  };
}

export function createFixtureSlots(overrides = {}) {
  return createDefaultSampleSlots().map((slot) => ({
    ...slot,
    ...(overrides[slot.id] ?? {}),
  }));
}

export async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}
