# Audio Integration (Sequencer Bridge)

## Purpose

Bridge the tick‑based runtime to Dough’s second‑based scheduling API, using the AudioWorklet clock for tight timing. This layer is intentionally thin because Dough already provides its JS glue and clock windows.

## Primary references

- `moduleSpecs/overview.md` (module boundaries)

## Responsibilities

- Convert runtime output events (ticks) into absolute seconds.
- Use Dough’s `onTick({t0,t1})` window to schedule events ahead of time.
- Implement lookahead/safety windows and dedupe to avoid double‑scheduling.
- Marshal events into Dough event objects and call `dough.evaluate(...)`.
- Drive the Runtime via **windowed queries** (JIT scheduling) so node processing and audio scheduling stay aligned.

## Explicit non-responsibilities

- Node simulation (Runtime module).
- DSP or voice allocation (Dough).
- Graph editing or routing.

## Required inputs

- **Runtime output events** in ticks (value + params).
- **Transport mapping** (BPM, ticksPerBeat, originSec).
- **Lookahead/safety config** (e.g., 30–80ms safety + horizon).
- **Dough clock** via `onTick({ t0, t1 })`.
- **Node registry** (default params + param mapping metadata).
- **Sound/sample mapping** (output value → sound params, if needed).
- **Runtime query API** (windowed execution) for fetching events in a time window.

## Outputs

- **Dough event objects** with absolute `time` (seconds) sent to `dough.evaluate(...)`.
- Optional **diagnostics** (late events dropped, queue overflow, voice limit reached).

## Browser requirements (locked)

Dough uses **SharedArrayBuffer** in the browser, which requires **cross‑origin isolation**.

**Required headers:**
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

These headers must be set on any page that runs Dough (e.g., the Next.js app).

---

## External contract (locked)
Audio Integration is a **stateful bridge** (class or factory object) with explicit lifecycle and update hooks.

```ts
type AudioBridge = {
  start(): void;
  stop(): void;
  updateTransport(transport: Transport): void;
  updateSlots(slots: Slot[]): void;
  getMetrics(): AudioMetrics;
};

function createAudioBridge(opts: {
  runtime: Runtime;
  registry: RegistryAPI;
  dough: DoughAPI;
  transport: Transport;
  config: AudioConfig;
  getSlots: () => Slot[];
}): AudioBridge;

// Registry API matches Build/Validate
type RegistryAPI = {
  getNodeDefinition: (type: string) => NodeDefinition | undefined;
  getLayout: (layout: string, inputs: number, outputs: number, controlPorts: number) => PortLayout;
};
```

```ts
type AudioMetrics = {
  scheduled: number;
  droppedLate: number;
  droppedOverflow: number;
  lastScheduledTick: number;
};
```

**Reset pulses integration (locked):**
- UI reset triggers `runtime.resetPulses()`; Audio Integration does **not** reset transport or watermark.
- Subsequent `queryWindow()` calls naturally schedule from the re‑seeded pulse sources.

## Runtime → Audio Integration contract

Audio Integration expects **tick‑based output events** from Runtime with:

- **Required**: `tick`, `value`
- **Optional**: `params` (object of numeric parameters)
- **Debug‑only (optional)**: `nodeId`, `edgeId` for diagnostics; not required for scheduling.

**Default‑param omission:** Runtime may omit params that are still at their defaults. Audio Integration must **fill missing params from registry defaults** before mapping to Dough. This keeps events concise without relying on Dough defaults.

This matches the runtime output contract and keeps audio scheduling payloads minimal while still allowing parameter‑rich events.

## Tick → seconds conversion

**Decision: fixed mapping with fractional ticks.**  
Use:

```
secondsPerTick = 60 / (BPM * ticksPerBeat)
timeSec = originSec + tick * secondsPerTick
```

**Transport schema (locked):**
```ts
type Transport = {
  bpm: number;          // persisted in project settings
  ticksPerBeat: number; // global constant (not persisted)
  originSec: number;    // clock origin in seconds
};
```
This matches Serialisation (tempo persisted; ticksPerBeat is a constant) and Runtime (tick‑based).

Ticks are **fractional** (not quantized to integers), so timing is continuous and not grid‑stepped. Accuracy comes from the AudioWorklet clock (`onTick`) plus lookahead scheduling, not from a coarse tick grid.

## Lookahead + windowing policy

**Decision: fixed lookahead.** Use a fixed safety lookahead of **~60 ms** (0.06s) as a safe default for this application.  
Guideline: ensure `lookahead >= onTick.latency + 10ms` (e.g., with CLOCK_SIZE=16 and BLOCK_SIZE=128 at 48kHz, latency ≈ 43ms, so 60ms is safe).

Audio Integration should query Runtime for events whose **intended times** fall within the **future window**:
`[t1 + lookahead, t1 + lookahead + horizon]`, then schedule those events with absolute seconds.

**Audio config schema (locked):**
```ts
type AudioConfig = {
  lookaheadSec: number; // default 0.06
  horizonSec: number;   // default 0.10
};
```

## Dedupe / watermark strategy

**Decision: tick watermark with reset.** Track `lastScheduledTick` and only schedule events with `tick > lastScheduledTick`.  
Reset the watermark on tempo/origin changes or clock resync to avoid missing events after a mapping change.

**Window boundary rule (locked):** query runtime for a **half‑open** tick range `[tStart, tEnd)` and schedule only events with `tick > lastScheduledTick`. This prevents duplicate scheduling across overlapping windows while preserving distinct events at the same tick.

## Dough event format

**Decision: full param mapping happens in Audio Integration.** Runtime outputs `{ tick, value, params? }` and Audio Integration maps those params into the **Dough event format** expected by `dough.evaluate()`, using registry mapping metadata.

Implementation intent:

- **Do not modify Dough’s files.**
- Add a small mapping layer (one or more new files) that translates runtime params → Dough keys and encodes the event for `dough.js`.

**Decision: use canonical Dough keys directly (no extra translation layer).**  
Preferred keys:

- `time` (absolute seconds)
- `s` (sound / sample name)
- `n` (sample index)
- `end` (sample end position)
- `crush`, `lpf`, `hpf` (FX params)
- plus any additional Dough‑recognized keys in the mapping table

Aliases like `sound` are accepted by Dough, but the mapper should emit a **single consistent key** to keep the event format stable.

**Event size guard:** Dough’s event input buffer is **1024 bytes**. Audio Integration must check the encoded event length; if it would exceed the buffer, **drop the event and warn** (do not truncate).

**Decision: event completeness (duration).**

- Use **`end` only** for sample playback; **do not send `duration`**.

## Late‑event handling

**Decision: drop and warn.** If an event would be late, drop it and emit a warning/diagnostic; do not reschedule. This avoids incorrect timing and mirrors Dough’s strict late‑event guard.

## Capacity / overflow policy

**Decision: pre‑flight cap + warn.** Audio Integration should cap events before sending if they exceed Dough’s limits (`MAX_EVENTS`, `MAX_VOICES`) and emit diagnostics. This keeps behavior predictable and avoids silent drops inside Dough.

## Horizon length (window size)

**Decision: fixed horizon.** Default horizon **~100 ms** (0.10s).  
Guideline: set `horizon >= onTick.latency` and keep it small enough to avoid overflowing Dough’s `MAX_EVENTS` in dense passages. With the current 43ms clock interval, 100ms provides a safe buffer without excessive event batching.

## Sample/asset mapping

Define how runtime output values map to Dough `sound/s` and `n`, and when to call `doughsamples()`.

**Decision: load on startup + reload on slot change.**

- Call `doughsamples()` on app init with the default kit.
- When a slot changes (project load or user replace), reload that slot’s sample mapping.

**Slot mapping (UI‑managed):**

- There are **8 sample slots** (1–8). Slot 1 plays sample 1, etc.
- Audio Integration maps value `1..8` → `{ s, n }` using the UI slot list.
- **Source of slots**: read from **project JSON**; if missing, fall back to **public default samples** (e.g., `/samples/*.wav`).
- **Slot schema (locked):**
```ts
type Slot = { id: string; path: string };
// slots: Slot[8]
```
Allow a future extension to `{ type, value }` for remote sources without breaking compatibility.

**Effect/param mapping tables live in Audio Integration; registry provides mapping keys only:**
- **Decay length (sample end)**: map to Dough `end` (0–1):
  - 1: 1.00, 2: 0.875, 3: 0.75, 4: 0.625, 5: 0.50, 6: 0.375, 7: 0.25, 8: 0.125
- **Crush** (`crush`): 1–8 → 16, 14, 12, 10, 8, 6, 4, 2
- **HPF** (`hpf`): 1–8 → 100, 200, 400, 800, 1600, 3200, 6400, 12000
- **LPF** (`lpf`): 1–8 → 12000, 6400, 3200, 1600, 800, 400, 200, 100
- **Vowel**: not found as a Dough parameter in `dough.js` / `dough.c` (exclude for now).
- **Grain splat**: not present (exclude).

**Mapping key lookup (clarity):** Audio Integration uses `paramMap.mapping` keys from the registry to select the corresponding local table (e.g., `"decayTable"`, `"lpfTable"`). Unknown keys are ignored with a warning.

**Archived ranges (for future reference, not active):**

- **BPF** (`bpf`): 1–8 → 100, 200, 400, 800, 1600, 3200, 6400, 12000
- **Vowel**: “move through the resonant range 1/8th at a time”
- **Grain splat**: 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0

## Transport updates mid‑stream

**Decision: apply tempo/origin changes at the next window boundary.**  
Runtime stays tick‑based; **tempo only affects tick→seconds mapping**. When tempo changes:

- Future window queries use the new mapping immediately.
- Already‑scheduled Dough events (within the current lookahead window) are **not** retimed.
- In‑flight runtime pulses remain in tick time and naturally speed up/slow down in **real time** as the mapping changes.

## Clock drift / resync policy

**Decision: reset watermark and resync.** On clock jumps/suspend/resume, reset the scheduling watermark and resume from the next valid `onTick` window. This avoids duplicate scheduling and late events, at the cost of skipping any events that fell inside the jump.

## Thread boundary + batching

**Decision: main‑thread conversion, batch per window.** Use `onTick` on the main thread to compute the tick window, query Runtime, map params, and send a batch of events to Dough. This aligns with Dough’s JS API and avoids worklet‑side complexity.

**Batching detail:** **batch per `onTick` window** (send a list of events for the window in one pass).

## Same‑time event ordering

**Decision: accept Dough’s non‑deterministic ordering for same‑time events.** This can introduce tiny, sub‑sample differences but is effectively inaudible. If future reproducibility issues arise, we can add micro‑offsets later.

## Immediate events (no time)

**Decision: never send events without `time`.** All events are scheduled with absolute seconds to preserve timing guarantees.

## Error surface / logging

**Decision: UI console + rate‑limited logs.** Surface only actionable items to the user:

- **Late events dropped** (count + last window).
- **Capacity overflows** (events dropped due to MAX_EVENTS / voice limits).
- **Missing sample slot** or failed sample load.
- **Audio context not running / worklet not ready**.
- **Clock resync events** (watermark reset after suspend/resume).

Implementation note: keep console messages concise, include affected slot IDs or counts, and rate‑limit repeats (e.g., aggregate per window).

### Error/warning model (locked)
```ts
type AudioWarning = {
  code: string;
  message: string;
  slotId?: string;
  count?: number;
};
```

// Warning codes (prefix AUDIO_)
// AUDIO_LATE_EVENT, AUDIO_DROPPED_OVERFLOW, AUDIO_MISSING_SAMPLE,
// AUDIO_DOH_EVAL_FAIL, AUDIO_CLOCK_RESYNC

## Testing hooks

Define tests for timing accuracy, late‑event handling, and dedupe.  
**Note:** full testing plan to be written later.

---

## Testing strategy (locked)
- **Fixtures**: `test/fixtures/audio/`
  - `valid-min.json` (single output event → dough event)
  - `valid-dedupe.json` (overlapping windows do not double‑schedule)
  - `valid-params.json` (param mapping tables applied correctly)
  - `invalid-missing-slot.json` → `AUDIO_MISSING_SAMPLE`
  - `invalid-late.json` → `AUDIO_LATE_EVENT`
- **Core tests**:
  - `test/audio-window.test.js` — window query ranges and half‑open boundaries `[tStart, tEnd)`.
  - `test/audio-transport.test.js` — tick→seconds mapping with BPM changes.
  - `test/audio-dedupe.test.js` — watermark resets on tempo/origin change.
  - `test/audio-mapping.test.js` — Dough event format and param tables.
  - `test/audio-overflow.test.js` — overflow/drop behavior + warnings.
**Passing criteria:** correct tick→seconds conversion, no duplicate scheduling across windows, proper param mapping, and expected warnings for late/overflow/missing slots.

---

## Implementation file layout (recommended)
- `packages/core/audio/bridge.js` — `createAudioBridge()` implementation.
- `packages/core/audio/mapper.js` — param mapping + Dough event translation.
- `packages/core/audio/samples.js` — slot loading + `doughsamples()` integration.
- `packages/core/audio/errors.js` — `AUDIO_*` warning codes + helpers.
- `packages/core/audio/constants.js` — defaults (lookahead, horizon, etc.).

## Core requirements

- **Schedule ahead**: Dough drops late events (~1ms tolerance in browser build).
- **Use worklet clock** (`onTick`) as the timing source (not `performance.now`).
- **Absolute seconds**: Dough expects `time` and `duration` in seconds.
- **Watermark/dedupe**: avoid rescheduling the same window twice.
- **Jitter target**: keep output scheduling jitter ≤ **1 ms** (ideally ≤ 0.5 ms).

## Technical requirements to finalize later

- **Testing plan** (full strategy to be written).

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
