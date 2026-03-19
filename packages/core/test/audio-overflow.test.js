import test from "node:test";
import assert from "node:assert/strict";

import { AUDIO_WARNING_CODES, createAudioBridge } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("bridge caps submissions before Dough overflow limits and aggregates AUDIO_DROPPED_OVERFLOW warnings", async () => {
  const runtime = createAudioRuntimeStub([
    { tick: 1, value: 1 },
    { tick: 1.5, value: 2 },
    { tick: 2, value: 3 },
    { tick: 2.5, value: 4 },
  ]);
  const engine = createFakeAudioEngine({
    MAX_EVENTS: 3,
    MAX_VOICES: 2,
  });
  const warnings = [];
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
      horizonSec: 4,
    },
    getSlots: () => createFixtureSlots(),
    onWarning: (warning) => warnings.push(warning),
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
  assert.deepEqual(bridge.getMetrics(), {
    scheduled: 2,
    droppedLate: 0,
    droppedOverflow: 2,
    lastScheduledTick: 2.5,
  });
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.DROPPED_OVERFLOW,
      message: "Dropped audio events because the Dough submission window is full.",
      count: 2,
    },
  ]);
});

test("oversize Dough payloads are dropped as overflow before evaluate runs", async () => {
  const engine = createFakeAudioEngine({
    measureEventSize() {
      return 2048;
    },
  });
  const bridge = createAudioBridge({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 1 }]),
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

  assert.equal(engine.calls.length, 0);
  assert.equal(bridge.getMetrics().droppedOverflow, 1);
});

test("late audio events are dropped with AUDIO_LATE_EVENT warnings", async () => {
  const fixture = await loadAudioFixture("invalid-late.json");
  const runtime = createAudioRuntimeStub(fixture.events, {
    respectWindow: false,
  });
  const engine = createFakeAudioEngine();
  const warnings = [];
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock(fixture.clock);

  assert.equal(engine.calls.length, 0);
  assert.equal(bridge.getMetrics().droppedLate, 1);
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.LATE_EVENT,
      message: "Dropped a late audio event at tick 1.",
      count: 1,
    },
  ]);
});

test("Dough evaluate failures surface AUDIO_DOH_EVAL_FAIL warnings", async () => {
  const engine = createFakeAudioEngine({
    scheduleError: new Error("worklet not ready"),
  });
  const warnings = [];
  const bridge = createAudioBridge({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 1 }]),
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
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(engine.calls.length, 1);
  assert.equal(bridge.getMetrics().scheduled, 0);
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
      message: "Failed to schedule a Dough event: worklet not ready.",
      count: 1,
    },
  ]);
});
