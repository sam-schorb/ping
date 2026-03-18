import {
  clampDiscreteNodeValue,
  clampNodeValue,
  createOutput,
  replaceState,
  updatePulseParams,
} from "./shared.js";

export function setParamFromControl(ctx) {
  return {
    param: clampNodeValue(ctx.pulse.value),
  };
}

export function pulseSignal(ctx) {
  return {
    outputs: [createOutput(1)],
  };
}

export function sinkSignal() {
  return {
    outputs: [],
  };
}

export function muxSignal(ctx) {
  return {
    outputs: Array.from({ length: 6 }, (_, outPortIndex) =>
      createOutput(ctx.pulse.value, { outPortIndex }),
    ),
  };
}

export function demuxSignal(ctx) {
  return {
    outputs: [createOutput(ctx.pulse.value)],
  };
}

export function addSignal(ctx) {
  return {
    outputs: [createOutput(ctx.pulse.value + ctx.param)],
  };
}

export function subSignal(ctx) {
  return {
    outputs: [createOutput(ctx.pulse.value - ctx.param)],
  };
}

export function setSignal(ctx) {
  return {
    outputs: [createOutput(ctx.param)],
  };
}

export function createConstantSignal(constantValue) {
  return function constantSignal(ctx) {
    return {
      outputs: [
        createOutput(constantValue, {
          speed: ctx.pulse.speed,
          params: ctx.pulse.params,
        }),
      ],
    };
  };
}

export function speedSignal(ctx) {
  return {
    outputs: [createOutput(ctx.pulse.value, { speed: ctx.param })],
  };
}

export function createEffectSignal(paramKey) {
  return function effectSignal(ctx) {
    return {
      outputs: [
        createOutput(ctx.pulse.value, {
          params: updatePulseParams(ctx.pulse.params, paramKey, ctx.param),
        }),
      ],
    };
  };
}

export function switchSignal(ctx) {
  const outPortIndex = Math.min(6, clampDiscreteNodeValue(ctx.param)) - 1;

  return {
    outputs: [createOutput(ctx.pulse.value, { outPortIndex })],
  };
}

export function createBlockState() {
  return {
    allow: true,
  };
}

export function blockControl(ctx) {
  const allow = clampDiscreteNodeValue(ctx.pulse.value) % 2 === 0;

  return {
    state: replaceState(ctx.state, { allow }),
  };
}

export function blockSignal(ctx) {
  return {
    outputs: ctx.state?.allow === false ? [] : [createOutput(ctx.pulse.value)],
  };
}

export function createEveryState() {
  return {
    count: 1,
  };
}

function normalizeEveryCount(rawCount, step) {
  let count = Number.isFinite(rawCount) ? Math.trunc(rawCount) : 1;

  if (count < 0) {
    count = 1;
  }

  if (count > step) {
    count %= step;
  }

  return count;
}

export function everySignal(ctx) {
  const step = clampDiscreteNodeValue(ctx.param);
  const count = normalizeEveryCount(ctx.state?.count, step);
  const shouldPass = count === step || count === 0;
  const nextCount = shouldPass ? 1 : count + 1;

  return {
    outputs: shouldPass ? [createOutput(ctx.pulse.value)] : [],
    state: replaceState(ctx.state, { count: nextCount }),
  };
}

export function randomSignal(ctx) {
  const maxValue = clampDiscreteNodeValue(ctx.param);
  const roll = clampNodeValue(
    Math.min(maxValue, Math.floor(ctx.rng() * maxValue) + 1),
  );

  return {
    outputs: [createOutput(roll)],
  };
}

export function createCounterState() {
  return {
    count: 0,
  };
}

export function counterControl(ctx) {
  return {
    state: replaceState(ctx.state, {
      count: clampDiscreteNodeValue(ctx.param),
    }),
  };
}

export function counterSignal(ctx) {
  const nextCount = clampDiscreteNodeValue((ctx.state?.count ?? 0) + 1);

  return {
    outputs: [createOutput(nextCount)],
    state: replaceState(ctx.state, { count: nextCount }),
  };
}

export function createComparisonSignal(compare) {
  return function comparisonSignal(ctx) {
    return {
      outputs: compare(ctx.pulse.value, ctx.param)
        ? [createOutput(ctx.pulse.value)]
        : [],
    };
  };
}

export function groupSignal() {
  return {
    outputs: [],
  };
}
