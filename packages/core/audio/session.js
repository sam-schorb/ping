import { createAudioBridge } from "./bridge.js";
import { normalizeAudioSlots } from "./samples.js";

function hasActiveTransport(transport) {
  return (
    Number.isFinite(transport?.bpm) &&
    transport.bpm > 0 &&
    Number.isFinite(transport?.ticksPerBeat) &&
    transport.ticksPerBeat > 0 &&
    Number.isFinite(transport?.originSec)
  );
}

export function createAudioSession(opts) {
  const engine = opts.engine;
  let slots = normalizeAudioSlots(opts.slots ?? opts.getSlots?.());
  let transport = opts.transport ?? null;
  let schedulingActive = false;
  let armPromise = null;
  let armedAudioContext = null;
  const bridge = createAudioBridge({
    runtime: opts.runtime,
    registry: opts.registry,
    engine,
    transport: transport ?? undefined,
    config: opts.config,
    getSlots: () => slots,
    onWarning: opts.onWarning,
    logger: opts.logger,
  });

  function syncBridgeRunningState() {
    if (schedulingActive && hasActiveTransport(transport)) {
      bridge.start();
      return;
    }

    bridge.stop();
  }

  return {
    async arm() {
      if (armedAudioContext) {
        return armedAudioContext;
      }

      if (armPromise) {
        return armPromise;
      }

      armPromise = (async () => {
        armedAudioContext = (await engine.arm?.()) ?? engine.getAudioContext?.() ?? null;
        return armedAudioContext;
      })();

      try {
        return await armPromise;
      } finally {
        if (armPromise) {
          armPromise = null;
        }
      }
    },
    setSchedulingActive(active) {
      schedulingActive = active === true;
      syncBridgeRunningState();
    },
    updateTransport(nextTransport) {
      transport = nextTransport ?? null;
      bridge.updateTransport(nextTransport ?? undefined);
      syncBridgeRunningState();
    },
    updateSlots(nextSlots) {
      slots = normalizeAudioSlots(nextSlots);
      bridge.updateSlots(slots);
    },
    updateConfig(nextConfig) {
      bridge.updateConfig(nextConfig);
    },
    getMetrics() {
      return bridge.getMetrics();
    },
    getAudioContext() {
      return armedAudioContext ?? engine.getAudioContext?.() ?? null;
    },
    async dispose() {
      schedulingActive = false;
      bridge.stop();
      armedAudioContext = null;
      await engine.dispose?.();
    },
  };
}
