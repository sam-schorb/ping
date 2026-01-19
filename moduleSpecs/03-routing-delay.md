# Routing + Delay

## Purpose

Compute orthogonal cable routes and derive tick delays from path length. This module bridges visual geometry and runtime timing by turning the **graph model’s topology + geometry** into **orthogonal polylines** and **base delays in ticks**.

## Primary references

modmoduleSpecspecs

- `moduleSpecs/overview.md` (grid‑based delay mapping)

## Responsibilities

- Generate orthogonal polyline routes that honor manual corners and port anchors.
- Produce render geometry (`svgPathD`, rounded joins) for UI.
- Compute `edge.delay` in ticks from **grid‑based polyline length**.
- Recompute routes efficiently when geometry/topology changes.
- Provide deterministic routing with stable tie‑break rules.

## Explicit non-responsibilities

- Graph validity checks (Build/Validate module).
- Runtime scheduling or audio integration.
- Node parameter logic.

## Inputs

- **Graph snapshot**: nodes/edges with positions, rotations, manual corners (ports are derived).
- **Registry/archetypes**: for port layout and orientation.
- **Timing config**: ticks‑per‑grid (grid‑based mapping is locked).
- **Style config**: visual smoothing (round joins), stub length, and bend preference.

## Outputs

- **Routed geometry** for UI:
  - `points[]` (orth polyline in grid units)
  - `svgPathD` (renderable path)
  - `totalLength` (grid‑based length)
- **Derived delays**: `edge.delay` in ticks (base delay, before speed scaling)

### Route output shape (locked)

```ts
type RouteData = {
  points: { x: number; y: number }[]; // grid-unit integers
  svgPathD: string;
  totalLength: number; // grid units
};
```

**Delay mapping:** `baseDelayTicks = totalLength * ticksPerGrid` (default `ticksPerGrid = 1`).

---

## External contract (API surface, locked)
Routing is implemented as **pure functions** (no classes).

```ts
routeGraph(
  snapshot: GraphSnapshot,
  registry: RegistryAPI,
  config: RoutingConfig,
  changedEdges?: Set<string>,
  cache?: RoutingCache
): RouteResult

routeEdge(
  edgeId: string,
  snapshot: GraphSnapshot,
  registry: RegistryAPI,
  config: RoutingConfig
): RouteData
```

```ts
type RouteResult = {
  edgeRoutes: Map<string, RouteData>; // only updated edges if changedEdges provided
  edgeDelays: Map<string, number>;    // base delay in ticks
  errors?: RoutingError[];
};

// Registry API matches Build/Validate
type RegistryAPI = {
  getNodeDefinition: (type: string) => NodeDefinition | undefined;
  getLayout: (layout: string, inputs: number, outputs: number, controlPorts: number) => PortLayout;
};
```

### Config + error model (locked)
```ts
type RoutingConfig = {
  ticksPerGrid: number;                     // default 1
  stubLength: number;                       // default 1 (grid units)
  bendPreference: 'horizontal-first' | 'vertical-first';
};

type RoutingError = {
  code: string;
  edgeId: string;
  message: string;
};

type RoutingCache = {
  edgeRoutes: Map<string, RouteData>;
  edgeDelays: Map<string, number>;
  cacheKeys: Map<string, string>; // edgeId -> hash of inputs (pos/rot/layout/config)
};

// Error codes (prefix ROUTE_)
// ROUTE_MISSING_NODE, ROUTE_MISSING_EDGE, ROUTE_INVALID_PORT,
// ROUTE_ANCHOR_FAIL, ROUTE_INTERNAL_ERROR
```

### Cache behavior (locked)
- If `cache` is provided, `routeGraph` updates it in place.
- If `changedEdges` is provided, only those edges are recomputed; others are served from cache.
- If `changedEdges` is omitted, `routeGraph` recomputes all edges and refreshes cache.

---

## Coordinate conventions

- **Coordinates stored in grid units** (not pixels).
- **Port anchors** are **grid intersections** (no fractional anchors).
- **Node sizes** are derived so ports land exactly on grid points:
  - side length in grid units = `portsOnSide + 1`
  - port positions are integer steps along the side (1..n)
- **Rotation** is clockwise (0 → 90 → 180 → 270) and rotates port normals.

---

## Routing normalization

### Port anchor formula (locked)

Define anchors in **node‑local** grid coordinates at rotation 0:

- Let `L = portsOnSide + 1` (node side length in grid units).
- **Left side inputs**: `(x=0, y=1..N)` top→bottom.
- **Right side outputs**: `(x=L, y=1..N)` top→bottom.
- **Top side outputs**: `(x=1..N, y=0)` left→right.
- **Bottom side outputs**: `(x=1..N, y=L)` left→right.

Rotation is applied **around the node center** `(cx = x + L/2, cy = y + L/2)` in 90° steps.  
**Slot ordering does not change** with rotation; only anchor positions rotate.

- Each edge is normalized as **out → in** by the model.
- Routing constraints are ordered as:
  `anchor(out) → manualCorner1 → manualCorner2 → ... → anchor(in)`
- Manual corners are **hard constraints** and split the path into segments.

---

## Input data shape (locked)

Routing derives **port anchors on demand** from the graph snapshot + registry. Ports are **not** stored in the snapshot.

**Required node fields:**

- `id`, `type`
- `pos: {x, y}` (grid units)
- `rot` (0/90/180/270)

**Required edge fields:**

- `id`
- `from: { nodeId, portSlot }` (output slot)
- `to: { nodeId, portSlot }` (input slot)
- `manualCorners: {x, y}[]` (grid units)

**Registry inputs:**

- `getNodeDefinition(type)` → `layout`, `inputs`, `outputs`, `controlPorts`
- `getLayout(layout, inputs, outputs, controlPorts)` → ordered port lists **with side placement**

**Anchor derivation:**

- Use `node.pos`, `node.rot`, `node.type` + registry layout to compute anchors.
- `portSlot` indexes into the ordered input/output lists (signal inputs first, then control inputs).

---

## Routing algorithm (X6‑style definition)

**X6‑style orth routing with stubs + deterministic bends + no obstacle avoidance.**

Full behavior:

1. **Stub**: every cable starts with a **1‑grid stub** leaving the port along its **normal** direction (outports outward, inports inward).
2. **Orth only**: all segments are horizontal/vertical.
3. **Minimal bends**: each segment between constraints uses the fewest bends possible.
4. **Deterministic bend preference**: if both L‑paths are valid, choose by length:
   - `|dx| > |dy|` → **horizontal‑first**
   - `|dy| > |dx|` → **vertical‑first**
   - equal → **horizontal‑first**
5. **No obstacle avoidance**: routes do not detour around nodes.
6. **Manual corners**: segments are routed **independently** between consecutive constraints.
7. **Aligned case**: if a segment’s anchors are aligned, route straight (stub + straight).
8. **No backtracking**: avoid immediate reversals unless forced by constraints.

---

## Rounding & rendering

- **Canonical geometry is square** (orth polyline).
- **No geometric rounding** is stored in data.
- **Visual smoothing only** using `stroke-linejoin: round` to avoid jagged corners.
- Smoothing **never affects delay**.

### Routing config (locked)

- `stubLength` is configurable (default **1 grid**).
- `bendPreference` is configurable (`"horizontal-first"` or `"vertical-first"`).
- Rounding remains **visual only** and is not part of route data.

---

## Length computation (base delay)

- **Base delay** is computed from **polyline length in grid units**.
- Rounded/visual smoothing is ignored for length.
- `edge.delay = polylineLengthInGridUnits` (ticks; can be **0** for zero‑gap geometry).
- Runtime applies pulse speed: raw delay = `baseDelay / speed`.
- Runtime then clamps to **minimum delay**: `effectiveDelay = max(rawDelay, minDelayTicks)`.
  **Delay type:** delays are **floats** (fractional ticks allowed).

---

## Caching & invalidation

**Caching scope (locked):** cache points + svgPathD + totalLength in the routing layer.

**Invalidation triggers (affected edges only):**

- node move/rotate → reroute all edges connected to that node
- corner add/move/remove → reroute that edge only
- edge create/delete → compute/remove that edge only
- edge endpoint change (reconnect) → reroute that edge only
- node type / port layout change → reroute all edges connected to that node
- group port count/mapping change → reroute edges connected to that group node
- param change → **no reroute**
- group internal edit → reroute edges inside that group only (unless external ports changed)
- routing config change (stub length / bend preference) → reroute affected edges or all edges if global

**Affected‑edge resolution:** routing uses model indexes (node→edges, port→edge) to compute the minimal affected set.

### Cache contract (locked)

- Routing accepts an **optional `changedEdges` set** and returns **only updated entries**.
- Cache keys include `(edgeId, node positions/rotations, layout version, routing config)`.

---

## Determinism guarantees

- For identical inputs, routing output is **identical** (stable points + path).
- Tie‑break rules are deterministic (see routing algorithm).
- Manual corner order is preserved exactly.

---

## Grouped nodes

**Routing is flat only**: the module routes **one graph snapshot at a time** and is unaware of group boundaries.  
The caller decides whether to pass the **top‑level graph** (collapsed groups) or a **group‑internal graph** (expanded view).

- Group nodes are treated **exactly like normal nodes** for routing.
- External edges connect to the group’s **exposed ports** with the same anchor/stub rules.
- Internal routing and delays are computed within the group subgraph and are preserved.
- Group port mappings connect directly to internal ports/params (no special routing beyond mapping).

---

## Performance expectations

- **Per‑edge recompute only when affected** (no full recompute by default).
- During drag, allow throttled recompute; finalize geometry on drag end.
- Caching ensures constant‑time rendering for stable edges.

---

## Core requirements (summary)

- Orthogonal routing only; no obstacle avoidance.
- Anchor points align with grid.
- Fixed stub length = **1 grid cell**.
- Manual corners are hard constraints and **ordered**.
- Delay uses **polyline length** in grid units only.
- Visual smoothing does not affect timing.
- Routing is deterministic with explicit tie‑break rules.
- Base delay may be **0**; runtime enforces a **minimum delay** via `minDelayTicks`.

---

## Edge cases / failure behavior

- **Stub clamping**: if a full 1‑grid stub would overshoot or create an immediate backtrack (anchors too close), clamp the stub length down to the available distance (allow **zero‑length stubs**) so nodes can connect with **no gap**.
- **Zero‑length segments** collapse to a point; duplicate points are removed.
- If manual corners create immediate backtracking, preserve them but avoid extra bends when possible.
- If anchor + corner are coincident, skip that segment.
- If routing config changes globally, reroute all edges.
- **Routing failure**: if an edge cannot be routed, emit an explicit error and **do not** return geometry or delay for that edge (no silent fallback).

---

## Validation / testing hooks

- Test routing determinism with fixed inputs.
- Test that delay equals polyline length for a known path.
- Test that anchor placement lands on grid intersections.

---

## Testing strategy (locked)
- **Fixtures**: `test/fixtures/routing/`
  - `valid-min.json` (single edge, no corners)
  - `valid-multi-corner.json` (edge with manual corners)
  - `valid-multi-io.json` (multi‑out and multi‑in nodes, ordering check)
  - `invalid-missing-node.json` → `ROUTE_MISSING_NODE`
  - `invalid-invalid-port.json` → `ROUTE_INVALID_PORT`
- **Core tests**:
  - `test/routing-determinism.test.js` — same inputs → identical `points`, `svgPathD`, `totalLength`.
  - `test/routing-length.test.js` — `totalLength` equals sum of orth segments.
- `test/routing-delay.test.js` — `edgeDelays` equals `totalLength * ticksPerGrid`.
- `test/routing-anchors.test.js` — anchor points are integer grid intersections and respect `side`.
- `test/routing-cache.test.js` — with `changedEdges`, only those edges recompute and cache updates.
**Passing criteria:** valid fixtures produce routes/delays with no errors; invalid fixtures return expected `ROUTE_*` codes; determinism holds across runs.

---

## Implementation file layout (recommended)
- `packages/core/routing/route-graph.js` — `routeGraph()` batch entry point.
- `packages/core/routing/route-edge.js` — `routeEdge()` per‑edge helper.
- `packages/core/routing/anchors.js` — anchor derivation from node + layout (`side` aware).
- `packages/core/routing/path.js` — orth routing algorithm + bend preference rules.
- `packages/core/routing/length.js` — polyline length computation.
- `packages/core/routing/cache.js` — cache helpers + key hashing.
- `packages/core/routing/errors.js` — `ROUTE_*` error codes + builders.
- `packages/core/routing/constants.js` — defaults (ticksPerGrid, stubLength, bendPreference).

---

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
- Open decisions (explicit list)
