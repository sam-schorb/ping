# Runtime (Event‑Driven Simulation)

## Purpose

Simulate pulse propagation through the graph using an event queue, producing output‑node events in ticks. This is the core execution engine.

## Primary references

- `moduleSpecs/node-behavior-table.md` (node behaviors + edge cases)
- `moduleSpecs/overview.md` (scheduler interface + boundaries)

## Responsibilities

- Maintain an event queue (scheduler) keyed by tick.
- Process events per tick with control‑first semantics.
- Run node behavior functions and update node state deterministically.
- Emit new events along outgoing edges with `delay >= minDelayTicks` (epsilon).
- Emit output‑node events (ticks) for the Audio Integration layer.
- Support **windowed stepping**: advance only as far as needed to fulfill a requested tick window.
- **Lookahead-friendly**: compute future events ahead of time, but timestamp them for their exact target times within the window.

## Explicit non-responsibilities

- Audio scheduling or DSP.
- Routing or delay calculation.
- UI updates (except for debug hooks if needed).

## Inputs

- **Runtime graph** (nodes, edges, delays, roles) from Build/Validate.
- **Node registry** behavior map (type → definition).
- **Scheduler** implementation (ring buffer by default, swappable).
- **minDelayTicks** config (epsilon > 0 to prevent zero‑time loops).
- **Tick window** / query calls from Audio Integration (lookahead scheduling, windowed stepping).
- **RNG seed** (for deterministic random node behavior).

## Outputs

- **Output events** in ticks (value + params) for Audio Integration.
- Optional **debug metrics** (event counts, queue size).
- Optional **visual pulse state** for UI thumbs (edgeId + position/progress).

### Visual pulse state (locked)
```ts
type ThumbState = {
  edgeId: string;
  progress: number; // 0..1 along edge from from→to
  speed: number; // 1..8 (for UI styling; no param payload)
  emitTick?: number; // optional stable identity for UI keys
};
```
Notes:
- Thumbs are UI‑only; they carry **no effect params**.
- When an edge reroutes or moves, UI reprojects `progress` onto the new geometry.

**Delivery method (locked):** UI pulls thumb state on demand.
```ts
getThumbState(nowTick: number): ThumbState[];
```
- Runtime derives `progress` from in‑flight events (`progress = (nowTick − emitTick) / delay`).
- UI may call on each animation frame or at a lower cadence with interpolation.

---

## External contract (locked)
Runtime is a **class** that owns scheduler state, RNG state, and live‑patching state.

```ts
class Runtime {
  constructor(opts: {
    registry: RegistryAPI;
    scheduler: Scheduler;
    minDelayTicks: number;
    rngSeed: number;
  });

  setGraph(graph: CompiledGraph): void;
  resetPulses(): void; // clears in-flight events and re-seeds pulse sources
  queryWindow(t0Tick: number, t1Tick: number): OutputEvent[];
  applyPatch(patch: RuntimePatch): void;
  getThumbState(nowTick: number): ThumbState[];
  getMetrics(): RuntimeMetrics;
}
```

```ts
type RuntimeMetrics = {
  eventsProcessed: number;
  eventsScheduled: number;
  queueSize: number;
  lastTickProcessed: number;
};
```

**Build/Validate handoff (locked):**
- Build/Validate always produces a **full CompiledGraph**.
- The caller decides whether to call:
  - `setGraph(graph)` for full replacement (load project, bulk edits), or
  - `applyPatch(patch)` for incremental live edits (preserve in‑flight pulses).

**Reset pulses (locked):**
- `resetPulses()` clears the scheduler queue and **re‑seeds pulses** from all `pulse` nodes in the active graph.
- This is a **runtime‑only** reset; graph state and params are unchanged.

## Runtime graph contract

**Locked:** Runtime consumes the **CompiledGraph** schema from Build/Validate verbatim.

```ts
type CompiledGraph = {
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  edgesByNodeId: Map<string, string[]>;
  edgesByPortId: Map<string, string>;
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  groupMeta?: GroupMeta;
  debug?: DebugMaps;
};

type CompiledNode = {
  id: string;
  type: string;
  param: number;
  state: NodeState;
  inputs: number;
  outputs: number;
  controlPorts: number;
};

type CompiledEdge = {
  id: string;
  from: { nodeId: string; portSlot: number };
  to: { nodeId: string; portSlot: number };
  role: 'signal' | 'control';
  delay: number;
};
```

## Event schema

**RuntimeEvent (locked):**
```ts
type RuntimeEvent = {
  tick: number;                  // float ticks (scheduled time)
  nodeId: string;                // target node
  edgeId: string;                // required for reschedule/cancel
  role: 'signal' | 'control';
  value: number;                 // 1..8
  speed: number;                 // 1..8
  params?: Record<string, number>;
  emitTime: number;              // tick when this event was emitted
};
```

Control vs signal is determined solely by `role`. The runtime groups events by `nodeId` per tick, applies all **control** first, then **signal**.

## Scheduler interface

Runtime uses a **swappable scheduler** interface. The **default implementation is a ring buffer** indexed by tick (modulo a fixed horizon) and optimized for dense, bounded lookahead windows. A heap is an acceptable alternative for unbounded horizons. If an edge delay exceeds the ring buffer horizon, the implementation must either (a) reject scheduling as an error, or (b) fall back to a secondary structure (heap/calendar queue) for long‑delay events.

The scheduler stores **all events together** in a single queue (no separate control queue). Control‑first is enforced by the runtime after dequeue.

### Scheduler API (locked)
```ts
type Scheduler = {
  enqueue(event: RuntimeEvent): void;
  popUntil(tick: number): RuntimeEvent[]; // inclusive
  removeByNode(nodeId: string): void;
  removeByEdge(edgeId: string): void;
  peekMinTick(): number | null;
  size?(): number; // optional helper for metrics
  clear?(): void;  // optional helper for setGraph/reset
};
```

## Windowed execution API (locked)
Runtime is queried by Audio Integration using **tick windows**:

```ts
queryWindow(t0Tick: number, t1Tick: number): OutputEvent[]
```

- Returns output events **sorted by tick** (stable order within a tick).
- Advances the internal cursor to `t1Tick` after processing the window.

## Ordering rules

Deterministic ordering per tick:

1. Group events by target node.
2. Apply **all control events first** in stable insertion order.
3. Process **all signal events** in stable insertion order.
4. Enqueue emitted events in the same deterministic order.

Stable ordering is derived from build insertion order for nodes/edges and the runtime scheduling order.

## Grouped nodes execution model

**Reconciled with Build/Validate:** groups are **flattened for runtime**. Runtime does not execute virtual group nodes; it only needs group metadata for debug/diagnostics and any **future** graph‑language representation.

## Live patching workflow

Runtime applies **live graph updates** without resetting in‑flight pulses:

- **Node delete** → drop all events targeting that node.
- **Edge delete** → drop all events scheduled along that edge.
- **Param change** → affects already‑scheduled events (params read at processing time).
- **Geometry change** → reschedule pending events on affected edges using `emitTime + newDelay`.

Required event metadata: `edgeId` + `emitTime`.  
Guardrails: preserve deterministic ordering on reschedule; **do not reschedule events inside the current audio lookahead window**; throttle rescheduling during active drags.

### Live patching API (locked)
Runtime supports **full replace** and **incremental patch** updates:

```ts
setGraph(compiledGraph: CompiledGraph): void

applyPatch(patch: RuntimePatch): void
```

```ts
type RuntimePatch = {
  addedNodes?: CompiledNode[];
  addedEdges?: CompiledEdge[];
  removedNodes?: string[];
  removedEdges?: string[];
  updatedEdges?: { edgeId: string; delay: number }[]; // geometry changes
  updatedParams?: { nodeId: string; param: number }[];
};
```

**Semantics:**
- `setGraph` replaces the active graph (use for full reloads).
- `applyPatch` preserves in‑flight pulses and applies the minimal changes:
  - `removedNodes/removedEdges` drop pending events targeting them.
  - `updatedEdges` reschedules pending events on those edges **outside** the current lookahead window using `emitTime + newDelay`.
  - `updatedParams` affect already‑scheduled events (params read at processing time).

## Pulse speed semantics

Speed is carried **on each event/pulse** (default 1) and persists until modified (e.g., by the speed node).  
Effective delay is computed as:
`effectiveDelay = max(baseDelay / speed, minDelayTicks)`.  
Outputs **inherit input speed** unless explicitly overridden. Clamp speed to 1–8 before scheduling.

## Output event contract

Runtime emits **tick‑based output events only** (no seconds).  
Audio Integration converts ticks → seconds and builds Dough event objects.

**OutputEvent (locked):**
```ts
type OutputEvent = {
  tick: number;                 // float ticks
  value: number;                // 1..8
  params?: Record<string, number>;
  nodeId?: string;              // debug only
  edgeId?: string;              // debug only
};
```

**Output batching (locked):** `queryWindow()` returns a **flat list** of `OutputEvent` items sorted by `tick` (stable within a tick). No per‑tick batching object is used.

**Output node rule (locked):** when a pulse reaches a node of type `output`, runtime emits an `OutputEvent` (value + params) and does **not** emit any further graph events from that node.

## Error handling

Runtime is **resilient** and never hard‑fails during performance:

- Missing node/edge/type → drop event + warn.
- NaN or out‑of‑range values → clamp/repair or drop + warn.

### Error/warning model (locked)
```ts
type RuntimeWarning = {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
};
```

// Warning codes (prefix RUNTIME_)
// RUNTIME_MISSING_NODE, RUNTIME_MISSING_EDGE, RUNTIME_MISSING_TYPE,
// RUNTIME_INVALID_VALUE, RUNTIME_QUEUE_OVERFLOW, RUNTIME_LATE_EVENT

## Performance / back‑pressure

Soft cap with warnings only — **never** delay or shift event times.  
If queue size exceeds a threshold, emit warnings/metrics and optionally skip non‑essential debug work.  
An emergency hard cap may drop overflow events **with explicit warnings** to prevent runaway, but **never** reschedule events to later times.

## Testing hooks

Expose minimal metrics (`eventsProcessed`, `eventsScheduled`, `queueSize`, `lastTickProcessed`) for diagnostics.  
Per‑node metrics and full traces are optional debug‑only features.

---

## Testing strategy (locked)
- **Fixtures**: `test/fixtures/runtime/`
  - `valid-min.json` (single pulse → output)
  - `valid-control-first.json` (control + signal same tick)
  - `valid-speed.json` (speed modifies delay)
  - `valid-random-seed.json` (deterministic RNG)
  - `invalid-missing-node.json` → `RUNTIME_MISSING_NODE`
- **Core tests**:
  - `test/runtime-window.test.js` — `queryWindow()` returns sorted outputs and advances cursor.
  - `test/runtime-ordering.test.js` — control‑first + stable ordering within tick.
  - `test/runtime-clamp.test.js` — values/params/speed clamped to 1..8.
  - `test/runtime-patching.test.js` — `applyPatch()` drops/reschedules correctly.
  - `test/runtime-metrics.test.js` — metrics counters update correctly.
**Passing criteria:** deterministic output traces for fixed inputs; correct ordering; correct clamping; warnings emitted for invalid inputs.

---

## Implementation file layout (recommended)
- `packages/core/runtime/runtime.js` — `Runtime` class implementation.
- `packages/core/runtime/scheduler/` — ring buffer + optional heap scheduler.
- `packages/core/runtime/events.js` — `RuntimeEvent` helpers + emit/clamp utilities.
- `packages/core/runtime/patching.js` — applyPatch logic + reschedule rules.
- `packages/core/runtime/errors.js` — `RUNTIME_*` warning codes + builders.
- `packages/core/runtime/metrics.js` — metrics counters + helpers.

## Core requirements

- **Event‑driven**: graph is topology, event queue is execution.
- **Control‑first**: apply all param/control events before signal events at the same node/tick.
- **Polyphony**: multiple pulses at the same tick are processed independently.
- **Determinism**: stable ordering per tick; **per‑node RNG** seeded by `(globalSeed + nodeId)` for random behaviors.
- **Cycles allowed**: guaranteed by `delay >= minDelayTicks` (no zero‑time loops).
- **Clamping**: node outputs and params are clamped to 1–8.
- **Grouped nodes**: runtime executes a **flattened graph**; group boundaries are preserved only as metadata for debug/representation.
- **Pulse speed**: pulses carry a `speed` (default 1). Raw delay = `baseDelay / speed` (fractional ticks allowed).
- **Minimum delay**: schedule with `effectiveDelay = max(baseDelay / speed, minDelayTicks)` so zero‑gap geometry still advances time.
- **Windowed execution**: runtime should be queryable by a time window so it can run ahead of time like an audio scheduler.
- **Timing accuracy**: fractional tick scheduling is required to meet ≤1 ms output jitter without inflating tick rate.
- **Live patching**: runtime must support in‑place updates when the graph changes, preserving in‑flight pulses.

## Technical requirements to finalize later

- **Fractional tick representation**: **float ticks** (locked; routing outputs floats and audio mapping expects floats).
- **Build/Validate API dependency**: how compiled graphs are delivered/updated.
- **Testing strategy**: golden traces vs property tests (or both).

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
