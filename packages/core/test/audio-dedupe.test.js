import test from "node:test";
import assert from "node:assert/strict";

import { createAudioBridge, AUDIO_WARNING_CODES } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("watermark dedupe preserves same-tick polyphony and prevents duplicate scheduling across overlapping windows", async () => {
  const fixture = await loadAudioFixture("valid-dedupe.json");
  const runtime = createAudioRuntimeStub(fixture.events, { repeat: true });
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
  await engine.emitClock(fixture.clocks[0]);
  await engine.emitClock(fixture.clocks[1]);

  assert.equal(engine.calls.length, 3);
  assert.deepEqual(
    engine.calls.map((call) => [call.time, call.s]),
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
  await engine.emitClock({
    t0: 1.0,
    t1: 1.0,
    latency: 0.05,
  });

  assert.equal(engine.calls.length, 6);
});

test("clock jumps reset the watermark and emit AUDIO_CLOCK_RESYNC warnings", async () => {
  const warnings = [];
  const runtime = createAudioRuntimeStub([{ tick: 1.5, value: 1 }], { repeat: true });
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
      horizonSec: 3,
    },
    getSlots: () => createFixtureSlots(),
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0,
    t1: 0.5,
    latency: 0.05,
  });
  await engine.emitClock({
    t0: 10,
    t1: 10.5,
    latency: 0.05,
  });

  assert.equal(engine.calls.length, 1);
  assert.equal(
    warnings.at(-1)?.code,
    AUDIO_WARNING_CODES.CLOCK_RESYNC,
  );
});
