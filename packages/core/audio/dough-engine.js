import { Dough, doughsamples } from "dough-synth/dough.js";

import { createDoughPlaybackEvent, resolveDoughEventSize } from "./mapper.js";
import { normalizeAudioSlots } from "./samples.js";

function normalizeSamplePath(path) {
  return typeof path === "string" ? path.trim() : "";
}

function createDoughSoundId(slotId, revision) {
  return `ping-slot:${slotId}:rev:${revision}`;
}

export function createDoughAudioEngine(opts = {}) {
  const DoughClass = opts.DoughClass ?? Dough;
  const doughsamplesImpl = opts.doughsamplesImpl ?? doughsamples;
  const sampleBaseUrl = typeof opts.sampleBaseUrl === "string" ? opts.sampleBaseUrl : "";
  const dough =
    opts.dough ??
    new DoughClass({
      base: opts.basePath ?? "./",
      onTick() {},
    });

  let audioContext = null;
  let armPromise = null;
  let slotBindings = new Map();
  const slotRevisions = new Map();

  async function arm() {
    if (audioContext) {
      return audioContext;
    }

    if (armPromise) {
      return armPromise;
    }

    armPromise = (async () => {
      const nextAudioContext = (await Promise.resolve(dough.initAudio)) ?? dough.audioContext ?? null;
      await Promise.resolve(dough.ready);
      await dough.resume?.();
      audioContext = nextAudioContext ?? dough.audioContext ?? null;
      return audioContext;
    })();

    try {
      return await armPromise;
    } finally {
      if (armPromise) {
        armPromise = null;
      }
    }
  }

  async function syncSlots(slots) {
    const normalizedSlots = normalizeAudioSlots(slots);
    const nextBindings = new Map();
    const seenSlotIds = new Set();
    const preloadTargets = [];
    const sampleMap = {};

    for (const slot of normalizedSlots) {
      if (!slot?.id || seenSlotIds.has(slot.id)) {
        continue;
      }

      seenSlotIds.add(slot.id);
      const path = normalizeSamplePath(slot.path);

      if (path === "") {
        continue;
      }

      const previousBinding = slotBindings.get(slot.id);
      let binding = previousBinding;

      if (!binding || binding.path !== path) {
        const nextRevision = (slotRevisions.get(slot.id) ?? 0) + 1;
        slotRevisions.set(slot.id, nextRevision);
        binding = {
          slotId: slot.id,
          path,
          sound: createDoughSoundId(slot.id, nextRevision),
          index: 0,
        };
        preloadTargets.push(binding);
      }

      nextBindings.set(slot.id, binding);
      sampleMap[binding.sound] = [path];
    }

    slotBindings = nextBindings;

    await doughsamplesImpl(sampleMap, sampleBaseUrl);

    for (const binding of preloadTargets) {
      await dough.maybeLoadFile?.({
        s: binding.sound,
        n: binding.index,
      });
    }
  }

  function resolveSampleTarget(slot) {
    const binding = slotBindings.get(slot.id);

    if (!binding) {
      return null;
    }

    return {
      sound: binding.sound,
      index: binding.index,
    };
  }

  return {
    get MAX_EVENTS() {
      return dough.MAX_EVENTS;
    },
    get MAX_VOICES() {
      return dough.MAX_VOICES;
    },
    async arm() {
      return arm();
    },
    async dispose() {
      await dough.stopWorklet?.();
    },
    async attachClockListener(listener) {
      await Promise.resolve(dough.ready);

      const port = dough.worklet?.port;

      if (!port) {
        throw new Error("Dough worklet is not ready for clock-driven scheduling.");
      }

      const previousClockHandler = port.onmessage;
      port.onmessage = async (event) => {
        if (typeof previousClockHandler === "function") {
          await previousClockHandler(event);
        }

        await listener(event?.data);
      };

      return () => {
        if (dough.worklet?.port === port) {
          port.onmessage = previousClockHandler;
        }
      };
    },
    async syncSlots(slots) {
      await syncSlots(slots);
    },
    createPlaybackEvent(args) {
      return createDoughPlaybackEvent({
        ...args,
        resolveSampleTarget,
      });
    },
    measureEventSize(event) {
      return resolveDoughEventSize(dough, event);
    },
    async schedule(event) {
      await dough.evaluate(event);
    },
    getAudioContext() {
      return audioContext;
    },
  };
}
