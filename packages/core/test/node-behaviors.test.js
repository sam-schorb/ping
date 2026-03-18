import test from "node:test";
import assert from "node:assert/strict";

import { getNodeDefinition } from "../src/index.js";
import { createBehaviorContext } from "./helpers/fixtures.js";

test("mux duplicates an incoming pulse to all six ordered outputs", () => {
  const node = getNodeDefinition("mux");
  const result = node.onSignal(createBehaviorContext({ pulse: { value: 6 } }));

  assert.equal(result.outputs.length, 6);
  assert.deepEqual(
    result.outputs.map((output) => [output.outPortIndex, output.value]),
    [
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
    ],
  );
});

test("pulse control updates the rate parameter and signal emits a fixed pulse value", () => {
  const node = getNodeDefinition("pulse");
  const controlResult = node.onControl(
    createBehaviorContext({
      pulse: { value: 6 },
    }),
  );
  const signalResult = node.onSignal(
    createBehaviorContext({
      param: 4,
    }),
  );

  assert.equal(controlResult.param, 6);
  assert.deepEqual(signalResult.outputs, [{ value: 1 }]);
});

test("switch control updates the selection and signal routing clamps to the sixth port", () => {
  const node = getNodeDefinition("switch");
  const controlResult = node.onControl(
    createBehaviorContext({ pulse: { value: 8 } }),
  );
  const signalResult = node.onSignal(
    createBehaviorContext({
      param: controlResult.param,
      pulse: { value: 5 },
    }),
  );

  assert.equal(controlResult.param, 8);
  assert.deepEqual(signalResult.outputs, [{ value: 5, outPortIndex: 5 }]);
});

test("constant nodes overwrite value while preserving incoming speed and params", () => {
  const node = getNodeDefinition("const3");
  const result = node.onSignal(
    createBehaviorContext({
      pulse: {
        value: 7,
        speed: 6,
        params: {
          crush: 2,
          hpf: 5,
        },
      },
    }),
  );

  assert.deepEqual(result.outputs, [
    {
      value: 3,
      speed: 6,
      params: {
        crush: 2,
        hpf: 5,
      },
    },
  ]);
});

test("speed overwrites pulse speed while preserving value", () => {
  const node = getNodeDefinition("speed");
  const result = node.onSignal(
    createBehaviorContext({
      param: 7,
      pulse: { value: 3, speed: 2 },
    }),
  );

  assert.deepEqual(result.outputs, [{ value: 3, speed: 7 }]);
});

test("pitch writes playback-speed params while preserving existing pulse params", () => {
  const node = getNodeDefinition("pitch");
  const result = node.onSignal(
    createBehaviorContext({
      param: 6,
      pulse: {
        value: 3,
        params: { crush: 2 },
      },
    }),
  );

  assert.deepEqual(result.outputs, [
    {
      value: 3,
      params: {
        crush: 2,
        pitch: 6,
      },
    },
  ]);
});

test("decay writes effect params while preserving existing pulse params", () => {
  const node = getNodeDefinition("decay");
  const result = node.onSignal(
    createBehaviorContext({
      param: 6,
      pulse: {
        value: 3,
        params: { crush: 2 },
      },
    }),
  );

  assert.deepEqual(result.outputs, [
    {
      value: 3,
      params: {
        crush: 2,
        decay: 6,
      },
    },
  ]);
});

test("every maintains deterministic state progression and normalizes count when N shrinks", () => {
  const node = getNodeDefinition("every");
  let state = node.initState();

  let result = node.onSignal(createBehaviorContext({ param: 3, state }));
  assert.equal(result.outputs.length, 0);
  state = result.state;

  result = node.onSignal(createBehaviorContext({ param: 3, state }));
  assert.equal(result.outputs.length, 0);
  state = result.state;

  result = node.onSignal(createBehaviorContext({ param: 3, state }));
  assert.deepEqual(result.outputs, [{ value: 4 }]);
  assert.equal(result.state.count, 1);

  result = node.onSignal(
    createBehaviorContext({
      param: 4,
      state: { count: 8 },
    }),
  );
  assert.deepEqual(result.outputs, [{ value: 4 }]);
  assert.equal(result.state.count, 1);
});

test("random uses the provided RNG and clamps to the current max parameter", () => {
  const node = getNodeDefinition("random");
  const lowRoll = node.onSignal(
    createBehaviorContext({
      param: 5,
      rng: () => 0,
    }),
  );
  const highRoll = node.onSignal(
    createBehaviorContext({
      param: 5,
      rng: () => 0.999,
    }),
  );

  assert.deepEqual(lowRoll.outputs, [{ value: 1 }]);
  assert.deepEqual(highRoll.outputs, [{ value: 5 }]);
});

test("counter reset happens before the next signal pulse in the same tick", () => {
  const node = getNodeDefinition("counter");
  const initialState = node.initState();
  const controlResult = node.onControl(
    createBehaviorContext({
      param: 5,
      state: initialState,
      pulse: { value: 2 },
    }),
  );
  const signalResult = node.onSignal(
    createBehaviorContext({
      param: 5,
      state: controlResult.state,
    }),
  );

  assert.equal(controlResult.state.count, 5);
  assert.deepEqual(signalResult.outputs, [{ value: 6 }]);
  assert.equal(signalResult.state.count, 6);
});

test("block stores the most recent control parity and gates the next signal accordingly", () => {
  const node = getNodeDefinition("block");
  const closedState = node.onControl(
    createBehaviorContext({
      pulse: { value: 3 },
      state: node.initState(),
    }),
  ).state;
  const blocked = node.onSignal(
    createBehaviorContext({
      state: closedState,
      pulse: { value: 7 },
    }),
  );
  const openState = node.onControl(
    createBehaviorContext({
      pulse: { value: 2 },
      state: closedState,
    }),
  ).state;
  const passed = node.onSignal(
    createBehaviorContext({
      state: openState,
      pulse: { value: 7 },
    }),
  );

  assert.equal(blocked.outputs.length, 0);
  assert.deepEqual(passed.outputs, [{ value: 7 }]);
});
