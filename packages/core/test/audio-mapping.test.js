import test from "node:test";
import assert from "node:assert/strict";

import {
  AUDIO_WARNING_CODES,
  createAudioBridge,
  createAudioParamContext,
  createDoughPlaybackEvent,
} from "../src/index.js";
import {
  createAudioRuntimeStub,
  createFakeAudioEngine,
  createFixtureSlots,
  createRegistryApi,
  flushAsyncWork,
  loadAudioFixture,
} from "./helpers/audio-fixtures.js";

test("runtime output params map to canonical Dough event keys and slot selection", async () => {
  const fixture = await loadAudioFixture("valid-params.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const engine = createFakeAudioEngine();
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => fixture.slots,
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock(fixture.clock);

  assert.deepEqual(engine.calls[0], {
    time: 2,
    dough: "play",
    s: "8",
    n: 0,
    speed: 2.5,
    end: 0.625,
    crush: 8,
    hpf: 200,
    lpf: 200,
  });
  assert.equal("duration" in engine.calls[0], false);
});

test("omitted params are filled from registry defaults before Dough mapping", () => {
  const registry = createRegistryApi();
  const paramContext = createAudioParamContext(registry);
  const doughEvent = createDoughPlaybackEvent({
    runtimeEvent: {
      tick: 1,
      value: 3,
    },
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    slots: createFixtureSlots(),
    paramContext,
  });

  assert.deepEqual(doughEvent, {
    time: 1,
    dough: "play",
    s: "3",
    n: 0,
    speed: 1,
    end: 1,
    crush: 16,
    hpf: 100,
    lpf: 12000,
  });
});

test("slot target resolvers can decouple UI slot ids from engine-facing sound ids", () => {
  const registry = createRegistryApi();
  const paramContext = createAudioParamContext(registry);
  const doughEvent = createDoughPlaybackEvent({
    runtimeEvent: {
      tick: 1,
      value: 3,
    },
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    slots: createFixtureSlots(),
    paramContext,
    resolveSampleTarget(slot) {
      return {
        sound: `${slot.id}@rev-2`,
        index: 0,
      };
    },
  });

  assert.deepEqual(doughEvent, {
    time: 1,
    dough: "play",
    s: "3@rev-2",
    n: 0,
    speed: 1,
    end: 1,
    crush: 16,
    hpf: 100,
    lpf: 12000,
  });
});

test("missing slots emit AUDIO_MISSING_SAMPLE and drop the event", async () => {
  const fixture = await loadAudioFixture("invalid-missing-slot.json");
  const runtime = createAudioRuntimeStub(fixture.events);
  const engine = createFakeAudioEngine();
  const warnings = [];
  const bridge = createAudioBridge({
    runtime,
    registry: createRegistryApi(),
    engine,
    transport: fixture.transport,
    config: fixture.config,
    getSlots: () => fixture.slots,
    onWarning: (warning) => warnings.push(warning),
    logger: { warn() {} },
  });

  bridge.start();
  await flushAsyncWork();
  await engine.emitClock(fixture.clock);

  assert.equal(engine.calls.length, 0);
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.MISSING_SAMPLE,
      message: 'No sample is configured for slot "4".',
      slotId: "4",
      count: 1,
    },
  ]);
});

test("unknown registry mapping keys are ignored with an AUDIO_DOH_EVAL_FAIL warning", () => {
  const baseRegistry = createRegistryApi();
  const warnings = [];
  const registry = {
    getNodeDefinition(type) {
      const definition = baseRegistry.getNodeDefinition(type);

      if (type !== "decay") {
        return definition;
      }

      return {
        ...definition,
        paramMap: {
          param: {
            ...definition.paramMap.param,
            mapping: "unknownTable",
          },
        },
      };
    },
  };
  const paramContext = createAudioParamContext(registry);
  const doughEvent = createDoughPlaybackEvent({
    runtimeEvent: {
      tick: 1,
      value: 1,
      params: {
        decay: 4,
      },
    },
    transport: {
      bpm: 60,
      ticksPerBeat: 1,
      originSec: 0,
    },
    slots: createFixtureSlots(),
    paramContext,
    emitWarning(code, message) {
      warnings.push({ code, message });
    },
  });

  assert.deepEqual(doughEvent, {
    time: 1,
    dough: "play",
    s: "1",
    n: 0,
    speed: 1,
    crush: 16,
    hpf: 100,
    lpf: 12000,
  });
  assert.deepEqual(warnings, [
    {
      code: AUDIO_WARNING_CODES.DOH_EVAL_FAIL,
      message: 'Ignored unsupported audio mapping "unknownTable".',
    },
  ]);
});
