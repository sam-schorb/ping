# Project Overview

This is the **high‑level overview** of the system. It describes module boundaries and data flow only. **All detailed specs live in the module files** and are the source of truth.

---

## 1) System flow (end‑to‑end)

```
User
  → UI Module (Editor + Thumbs)
  → Graph Model (ops → snapshot)
  → Routing+Delay (geometry + base delays)
  → Build/Validate (compiled runtime graph)
  → Runtime (event simulation)
  → Audio Integration (windowed scheduling)
  → Dough JS Glue → Dough C/WASM → Audio

Serialisation sits alongside the graph model (load/save JSON).
```

---

## 2) Locked global decisions

- **Ticks are grid‑distance units**; conversion to seconds happens only at the audio boundary.
- **Delay mapping is grid‑based** (1 grid unit = 1 tick unless configured otherwise in Routing+Delay).
- **JSON is canonical** for project storage; any graph DSL is a future derived view only.
- **Ports are derived** from registry layout (never stored in the graph snapshot).

---

## 3) Module boundaries (summary)

### UI Module (Editor + Visual Thumbs)
- **Inputs**: graph snapshot, routed geometry, palette metadata, diagnostics, optional runtime thumb state.
- **Outputs**: UI intents (graph ops, tempo updates, slot updates, reset pulses, selection changes, undo snapshots).
- **Notes**: Uses a framework‑agnostic core + thin Next.js/React wrapper. Thumbs are visual only; UI never simulates pulses.

### Graph Model
- **Inputs**: graph ops from UI, loaded snapshot from Serialisation.
- **Outputs**: graph snapshot to Routing+Delay and Build/Validate.
- **Notes**: Single source of truth; ports are derived from registry.

### Routing + Delay
- **Inputs**: graph snapshot + registry layout + routing config.
- **Outputs**: routed geometry (polyline + svg path + total length), base delay per edge (ticks).
- **Notes**: Pure functions; geometry and delay are intentionally coupled.

### Node Registry
- **Inputs**: node definitions (from node behavior table + group definitions).
- **Outputs**: palette metadata + behavior dispatch + layout rules.
- **Notes**: Parameter mapping tables live in Audio Integration; registry provides mapping keys only.

### Build / Validate
- **Inputs**: graph snapshot, registry, edge delays.
- **Outputs**: compiled runtime graph + errors/warnings.
- **Notes**: Pure function; runtime decides `setGraph` vs `applyPatch`.

### Runtime
- **Inputs**: compiled graph, registry behavior, scheduler, tick window.
- **Outputs**: output events (ticks) for Audio Integration; optional thumb state for UI.
- **Notes**: Class API; supports `resetPulses()` and `getThumbState(nowTick)`.

### Audio Integration
- **Inputs**: output events (ticks), transport (BPM/ticksPerBeat/origin), sample slots, lookahead config.
- **Outputs**: scheduled Dough events in absolute seconds.
- **Notes**: Pulls runtime in windowed queries; owns param mapping tables.

### Serialisation
- **Inputs**: graph snapshot + project settings.
- **Outputs**: canonical project JSON + parsed snapshots.

---

## 4) Integration glue (key points)

- **Routing ↔ Build/Validate**: both consume the same snapshot; delays are provided as a Map keyed by edgeId.
- **Build/Validate ↔ Runtime**: build returns a full compiled graph; caller chooses `setGraph` or `applyPatch`.
- **Runtime ↔ Audio**: Audio Integration queries runtime by tick windows and converts ticks → seconds.
- **UI ↔ Runtime**: UI pulls `getThumbState(nowTick)` for visual thumbs; reset pulses calls `resetPulses()`.

---

## 5) Source of truth

If this overview conflicts with any module spec, **the module spec wins**. Use this document for orientation only.
