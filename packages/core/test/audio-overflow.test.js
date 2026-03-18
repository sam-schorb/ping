import test from "node:test";
import assert from "node:assert/strict";

import { AUDIO_WARNING_CODES, createAudioBridge } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeDough,
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
  const dough = createFakeDough({
    MAX_EVENTS: 3,
    MAX_VOICES: 2,
  });
  const warnings = [];
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
      horizonSec: 4,
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
    t1: 0,
    latency: 0.05,
  });

  assert.equal(dough.calls.length, 2);
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
  const dough = createFakeDough({
    encodeEvent() {
      return new Uint8Array(2048);
    },
  });
  const bridge = createAudioBridge({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 1 }]),
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

  assert.equal(dough.calls.length, 0);
  assert.equal(bridge.getMetrics().droppedOverflow, 1);
});

test("late audio events are dropped with AUDIO_LATE_EVENT warnings", async () => {
  const fixture = await loadAudioFixture("invalid-late.json");
  const runtime = createAudioRuntimeStub(fixture.events, {
    respectWindow: false,
  });
  const dough = createFakeDough();
  const warnings = [];
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    dough,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => createFixtureSlots(),
    loadSamples: async () => {},
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock(fixture.clock);

  assert.equal(dough.calls.length, 0);
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
  const dough = createFakeDough({
    evaluateError: new Error("worklet not ready"),
  });
  const warnings = [];
  const bridge = createAudioBridge({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 1 }]),
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
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await dough.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(dough.calls.length, 1);
  assert.equal(bridge.getMetrics().scheduled, 0);
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
      message: "Failed to schedule a Dough event: worklet not ready.",
      count: 1,
    },
  ]);
});
