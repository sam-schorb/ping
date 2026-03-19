import test from "node:test";
import assert from "node:assert/strict";

import { createAudioBridge, secondsToTick, tickToSeconds } from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
} from "./helpers/audio-fixtures.js";

test("tick and second conversion uses the locked transport mapping", () => {
  const transport = {
    bpm: 120,
    ticksPerBeat: 2,
    originSec: 1,
  };

  assert.equal(tickToSeconds(3, transport), 1.75);
  assert.equal(secondsToTick(1.75, transport), 3);
});

test("transport updates apply at the next window boundary without retiming already scheduled events", async () => {
  const runtime = createAudioRuntimeStub([
    { tick: 2, value: 1 },
    { tick: 8, value: 2 },
  ]);
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
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock({
    t0: 0,
    t1: 0,
    latency: 0.05,
  });

  bridge.updateTransport({
    bpm: 120,
    ticksPerBeat: 1,
    originSec: 0,
  });
  await engine.emitClock({
    t0: 3,
    t1: 3,
    latency: 0.05,
  });

  assert.deepEqual(
    engine.calls.map((call) => call.time),
    [2, 4],
  );
  assert.deepEqual(bridge.getMetrics(), {
    scheduled: 2,
    droppedLate: 0,
    droppedOverflow: 0,
    lastScheduledTick: 8,
  });
});
