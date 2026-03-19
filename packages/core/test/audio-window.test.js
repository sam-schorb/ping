import test from "node:test";
import assert from "node:assert/strict";

import { createAudioBridge, createAudioParamContext, createDoughPlaybackEvent } from "../src/index.js";
import { createRuntime, loadRuntimeFixture } from "./helpers/runtime-fixtures.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("audio bridge queries the runtime from the current clock boundary and schedules matching events", async () => {
  const fixture = await loadAudioFixture("valid-min.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const engine = createFakeAudioEngine();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock(fixture.clock);

  assert.deepEqual(runtime.queries, [[1, 1.75]]);
  assert.equal(engine.slotSyncCalls.length, 1);
  assert.equal(engine.calls.length, 1);
  assert.deepEqual(engine.calls[0], {
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
  const engine = createFakeAudioEngine();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
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

  assert.equal(engine.slotSyncCalls.length, 2);
  assert.equal(engine.slotSyncCalls[1][1].path, "/kits/alt/snare.wav");
});

test("audio bridge waits for sample mappings to load before scheduling clock windows", async () => {
  const fixture = await loadAudioFixture("valid-min.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  let resolveLoadSamples;
  const loadSamplesPromise = new Promise((resolve) => {
    resolveLoadSamples = resolve;
  });
  const waitingEngine = createFakeAudioEngine({
    syncSlots: async () => loadSamplesPromise,
  });
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine: waitingEngine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();

  const clockPromise = waitingEngine.emitClock(fixture.clock);
  await flushAsyncWork();

  assert.deepEqual(runtime.queries, []);
  assert.equal(waitingEngine.calls.length, 0);

  resolveLoadSamples();
  await clockPromise;

  assert.deepEqual(runtime.queries, [[1, 1.75]]);
  assert.equal(waitingEngine.calls.length, 1);
});

test("audio bridge schedules future playback against refreshed slot bindings after a slot change", async () => {
  const runtime = createAudioRuntimeStub(
    [
      { tick: 1, value: 2 },
      { tick: 2, value: 2 },
    ],
    { repeat: true },
  );
  let slotRevision = 0;
  let currentSoundRef = "slot-2@rev-1";
  let releaseSecondSync;
  const secondSync = new Promise((resolve) => {
    releaseSecondSync = resolve;
  });
  const engine = createFakeAudioEngine({
    async syncSlots(slots) {
      slotRevision += 1;
      currentSoundRef = `slot-2@rev-${slotRevision}`;

      if (slotRevision === 2) {
        await secondSync;
      }

      return slots;
    },
    createPlaybackEvent({ runtimeEvent, transport, slots, emitWarning }) {
      return createDoughPlaybackEvent({
        runtimeEvent,
        transport,
        paramContext: createAudioParamContext(createRegistryApi()),
        slots: slots.map((slot) =>
          slot.id === "2" ? { ...slot, id: currentSoundRef } : { ...slot },
        ),
        emitWarning,
      });
    },
  });
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    config: {
      lookaheadSec: 0,
      horizonSec: 1.5,
    },
    getSlots: () => createFixtureSlots(),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(engine.calls[0]?.s, "slot-2@rev-1");

  bridge.updateSlots(
    createFixtureSlots({
      "2": { path: "/kits/alt/snare.wav" },
    }),
  );
  const pendingClock = engine.emitClock({
    t0: 1,
    t1: 1,
    latency: 0.05,
  });
  await flushAsyncWork();

  assert.equal(engine.calls.length, 1);

  releaseSecondSync();
  await pendingClock;

  assert.equal(engine.calls.length, 2);
  assert.equal(engine.calls[1].s, "slot-2@rev-2");
});

test("audio bridge does not skip the first output event sitting inside the lookahead band", async () => {
  const runtime = createRuntime(await loadRuntimeFixture("valid-min.json"));
  const engine = createFakeAudioEngine();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
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
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0.2,
    t1: 0.45,
    latency: 0.05,
  });

  assert.deepEqual(engine.calls, [
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
  const engine = createFakeAudioEngine();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
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
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(engine.calls.length, 2);
  assert.deepEqual(
    engine.calls.map((call) => [call.time, call.s]),
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
