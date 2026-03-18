import test from "node:test";
import assert from "node:assert/strict";

import { createAudioBridge } from "../src/index.js";
import { createRuntime, loadRuntimeFixture } from "./helpers/runtime-fixtures.js";
import {
  createAudioRuntimeStub,
  createFakeDough,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("audio bridge queries the runtime from the current clock boundary and schedules matching events", async () => {
  const fixture = await loadAudioFixture("valid-min.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const dough = createFakeDough();
  const sampleLoads = [];
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    loadSamples: async (slots) => {
      sampleLoads.push(slots);
    },
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock(fixture.clock);

  assert.deepEqual(runtime.queries, [[1, 1.75]]);
  assert.equal(sampleLoads.length, 1);
  assert.equal(dough.calls.length, 1);
  assert.deepEqual(dough.calls[0], {
    time: 1.5,
    dough: "play",
    s: "2",
    n: 0,
    speed: 1,
    end: 1,
    crush: 16,
    hpf: 100,
    lpf: 12000,
  });
});

test("updateSlots reloads the Dough sample mapping without changing runtime semantics", async () => {
  const fixture = await loadAudioFixture("valid-min.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const dough = createFakeDough();
  const sampleLoads = [];
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    loadSamples: async (slots) => {
      sampleLoads.push(slots.map((slot) => ({ ...slot })));
    },
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  bridge.updateSlots(
    createFixtureSlots({
      "2": { path: "/kits/alt/snare.wav" },
    }),
  );
  await flushAsyncWork();

  assert.equal(sampleLoads.length, 2);
  assert.equal(sampleLoads[1][1].path, "/kits/alt/snare.wav");
});

test("audio bridge waits for sample mappings to load before scheduling clock windows", async () => {
  const fixture = await loadAudioFixture("valid-min.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const dough = createFakeDough();
  let resolveLoadSamples;
  const loadSamplesPromise = new Promise((resolve) => {
    resolveLoadSamples = resolve;
  });
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => loadSamplesPromise,
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();

  const clockPromise = dough.emitClock(fixture.clock);
  await flushAsyncWork();

  assert.deepEqual(runtime.queries, []);
  assert.equal(dough.calls.length, 0);

  resolveLoadSamples();
  await clockPromise;

  assert.deepEqual(runtime.queries, [[1, 1.75]]);
  assert.equal(dough.calls.length, 1);
});

test("audio bridge does not skip the first output event sitting inside the lookahead band", async () => {
  const runtime = createRuntime(await loadRuntimeFixture("valid-min.json"));
  const dough = createFakeDough();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    config: {
      lookaheadSec: 0.06,
      horizonSec: 0.1,
    },
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => {},
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock({
    t0: 0.2,
    t1: 0.45,
    latency: 0.05,
  });

  assert.deepEqual(dough.calls, [
    {
      time: 0.5,
      dough: "play",
      s: "1",
      n: 0,
      speed: 1,
      end: 1,
      crush: 16,
      hpf: 100,
      lpf: 12000,
    },
  ]);
});

test("audio bridge composes onto the real runtime output contract", async () => {
  const runtime = createRuntime(await loadRuntimeFixture("valid-min.json"));
  const dough = createFakeDough();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    config: {
      lookaheadSec: 0,
      horizonSec: 2,
    },
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => {},
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(dough.calls.length, 2);
  assert.deepEqual(
    dough.calls.map((call) => [call.time, call.s]),
    [
      [0.5, "1"],
      [1.5, "1"],
    ],
  );
  assert.deepEqual(bridge.getMetrics(), {
    scheduled: 2,
    droppedLate: 0,
    droppedOverflow: 0,
    lastScheduledTick: 1.5,
  });
});
