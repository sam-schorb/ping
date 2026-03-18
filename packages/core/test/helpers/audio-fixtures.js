import { readFile } from "node:fs/promises";

import { createDefaultSampleSlots, getNodeDefinition } from "../../src/index.js";

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

  const dough = {
    ready: options.ready ?? Promise.resolve(),
    worklet: {
      port,
    },
    MAX_EVENTS: options.MAX_EVENTS ?? 64,
    MAX_VOICES: options.MAX_VOICES ?? 32,
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

  return dough;
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
