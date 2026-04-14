import test from "node:test";
import assert from "node:assert/strict";

import {
  getAudibleClockTimeSec,
  getAudibleLatencySec,
  getClockTimeSec,
  getPresentationClockTimeSec,
  getTransportClockTimeSec,
  rebaseTransportAtCurrentTick,
  tickFromTransport,
} from "./presentation-clock.mjs";

test("presentation clock stays on the transport scheduling clock even when audio latency is reported", () => {
  const audioContext = {
    currentTime: 12.5,
    baseLatency: 0.08,
    outputLatency: 0.04,
  };

  assert.equal(getClockTimeSec(audioContext), 12.5);
  assert.equal(getAudibleLatencySec(audioContext), 0.12);
  assert.equal(getAudibleClockTimeSec(audioContext), 12.38);
  assert.equal(getPresentationClockTimeSec(audioContext), 12.5);
});

test("tickFromTransport converts seconds onto the current transport origin", () => {
  assert.equal(
    tickFromTransport(
      {
        originTimeSec: 5,
        originTick: 8,
        bpm: 120,
      },
      6.5,
    ),
    11,
  );
});

test("tickFromTransport falls back to the transport origin when tempo is inactive", () => {
  assert.equal(
    tickFromTransport(
      {
        originTimeSec: 5,
        originTick: 13,
        bpm: 0,
      },
      20,
    ),
    13,
  );
});

test("transport clock time stays on the presentation clock once audio is armed", () => {
  const audioContext = {
    currentTime: 8.25,
    baseLatency: 0.08,
    outputLatency: 0.04,
  };

  assert.equal(getTransportClockTimeSec(audioContext, 123456), 8.25);
});

test("tempo rebasing preserves the current transport tick on the shared presentation clock", () => {
  const previousTransport = {
    originTimeSec: 1,
    originTick: 4,
    bpm: 70,
  };
  const nowTimeSec = 1.375;
  const currentTick = tickFromTransport(previousTransport, nowTimeSec);
  const rebasedTransport = rebaseTransportAtCurrentTick(previousTransport, 100, nowTimeSec);

  assert.deepEqual(rebasedTransport, {
    originTimeSec: nowTimeSec,
    originTick: currentTick,
    bpm: 100,
  });
  assert.equal(tickFromTransport(rebasedTransport, nowTimeSec), currentTick);
});
