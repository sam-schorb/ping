import test from "node:test";
import assert from "node:assert/strict";

import { createAudioParamContext, createDoughAudioEngine } from "../src/index.js";
import {
  createFakeDough,
  createFixtureSlots,
  createRegistryApi,
} from "./helpers/audio-fixtures.js";

function createTransport() {
  return {
    bpm: 60,
    ticksPerBeat: 1,
    originSec: 0,
  };
}

test("dough audio engine issues a new engine sound ref only for slots whose sample path changed", async () => {
  const sampleMaps = [];
  const dough = createFakeDough();
  const registry = createRegistryApi();
  const paramContext = createAudioParamContext(registry);
  const initialSlots = createFixtureSlots();
  const updatedSlots = createFixtureSlots({
    "2": { path: "/kits/alt/snare.wav" },
  });
  const engine = createDoughAudioEngine({
    dough,
    doughsamplesImpl: async (sampleMap) => {
      sampleMaps.push({ ...sampleMap });
    },
  });

  await engine.syncSlots(initialSlots);
  const initialEvent = engine.createPlaybackEvent({
    runtimeEvent: {
      tick: 1,
      value: 2,
    },
    transport: createTransport(),
    slots: initialSlots,
    paramContext,
  });
  const initialLoadCount = dough.maybeLoadCalls.length;

  await engine.syncSlots(updatedSlots);
  const updatedEvent = engine.createPlaybackEvent({
    runtimeEvent: {
      tick: 2,
      value: 2,
    },
    transport: createTransport(),
    slots: updatedSlots,
    paramContext,
  });

  assert.match(initialEvent.s, /^ping-slot:2:rev:1$/);
  assert.match(updatedEvent.s, /^ping-slot:2:rev:2$/);
  assert.notEqual(initialEvent.s, updatedEvent.s);
  assert.equal(sampleMaps.length, 2);
  assert.equal(sampleMaps[0][initialEvent.s][0], initialSlots[1].path);
  assert.equal(sampleMaps[1][updatedEvent.s][0], "/kits/alt/snare.wav");
  assert.equal(dough.maybeLoadCalls.length, initialLoadCount + 1);
  assert.equal(dough.maybeLoadCalls.at(-1).s, updatedEvent.s);
});

test("dough audio engine delegates arm and dispose to Dough lifecycle methods", async () => {
  const audioContext = {
    state: "suspended",
  };
  const dough = createFakeDough({
    audioContext,
  });
  const engine = createDoughAudioEngine({
    dough,
    doughsamplesImpl: async () => {},
  });

  const resolvedAudioContext = await engine.arm();
  await engine.dispose();

  assert.equal(resolvedAudioContext, audioContext);
  assert.equal(engine.getAudioContext(), audioContext);
  assert.equal(dough.resumeCalls, 1);
  assert.equal(dough.stopWorkletCalls, 1);
});
