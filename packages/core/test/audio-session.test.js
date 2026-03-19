import test from "node:test";
import assert from "node:assert/strict";

import { createAudioSession } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
} from "./helpers/audio-fixtures.js";

function createTransport() {
  return {
    bpm: 60,
    ticksPerBeat: 1,
    originSec: 0,
  };
}

test("audio session arms the engine without starting scheduling until explicitly activated", async () => {
  const audioContext = {
    state: "running",
  };
  const engine = createFakeAudioEngine({
    audioContext,
  });
  const session = createAudioSession({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 1 }], { repeat: true }),
    registry: createRegistryApi(),
    engine,
    transport: createTransport(),
    config: {
      lookaheadSec: 0,
      horizonSec: 2,
    },
    slots: createFixtureSlots(),
    logger: { warn() {} },
  });

  const resolvedAudioContext = await session.arm();
  await engine.emitClock({
    clock: true,
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(resolvedAudioContext, audioContext);
  assert.equal(engine.slotSyncCalls.length, 0);
  assert.equal(engine.calls.length, 0);

  session.setSchedulingActive(true);
  await flushAsyncWork();
  await engine.emitClock({
    clock: true,
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  assert.equal(engine.slotSyncCalls.length, 1);
  assert.equal(engine.calls.length, 1);
});

test("audio session defers slot syncs until active and then applies live slot updates", async () => {
  const engine = createFakeAudioEngine();
  const session = createAudioSession({
    runtime: createAudioRuntimeStub([{ tick: 1, value: 2 }], { repeat: true }),
    registry: createRegistryApi(),
    engine,
    transport: createTransport(),
    slots: createFixtureSlots(),
    logger: { warn() {} },
  });

  session.updateSlots(
    createFixtureSlots({
      "2": { path: "/kits/alt/snare.wav" },
    }),
  );
  await flushAsyncWork();

  assert.equal(engine.slotSyncCalls.length, 0);

  await session.arm();
  session.setSchedulingActive(true);
  await flushAsyncWork();

  assert.equal(engine.slotSyncCalls.length, 1);
  assert.equal(engine.slotSyncCalls[0][1].path, "/kits/alt/snare.wav");

  session.updateSlots(
    createFixtureSlots({
      "2": { path: "/kits/alt/rim.wav" },
    }),
  );
  await flushAsyncWork();

  assert.equal(engine.slotSyncCalls.length, 2);
  assert.equal(engine.slotSyncCalls[1][1].path, "/kits/alt/rim.wav");
});
