import test from "node:test";
import assert from "node:assert/strict";

import { createAudioBridge, AUDIO_WARNING_CODES } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeDough,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("watermark dedupe preserves same-tick polyphony and prevents duplicate scheduling across overlapping windows", async () => {
  const fixture = await loadAudioFixture("valid-dedupe.json");
  const runtime = createAudioRuntimeStub(fixture.events, { repeat: true });
  const dough = createFakeDough();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => {},
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock(fixture.clocks[0]);
  await dough.emitClock(fixture.clocks[1]);

  assert.equal(dough.calls.length, 3);
  assert.deepEqual(
    dough.calls.map((call) => [call.time, call.s]),
    [
      [1.5, "1"],
      [1.5, "2"],
      [2.5, "3"],
    ],
  );
  assert.equal(bridge.getMetrics().lastScheduledTick, 2.5);

  bridge.updateTransport({
    ...fixture.transport,
    originSec: 0.5,
  });
  await dough.emitClock({
    t0: 1.0,
    t1: 1.0,
    latency: 0.05,
  });

  assert.equal(dough.calls.length, 6);
});

test("clock jumps reset the watermark and emit AUDIO_CLOCK_RESYNC warnings", async () => {
  const warnings = [];
  const runtime = createAudioRuntimeStub([{ tick: 1.5, value: 1 }], { repeat: true });
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
      horizonSec: 3,
    },
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => {},
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock({
    t0: 0,
    t1: 0.5,
    latency: 0.05,
  });
  await dough.emitClock({
    t0: 10,
    t1: 10.5,
    latency: 0.05,
  });

  assert.equal(dough.calls.length, 1);
  assert.equal(
    warnings.at(-1)?.code,
    AUDIO_WARNING_CODES.CLOCK_RESYNC,
  );
});
