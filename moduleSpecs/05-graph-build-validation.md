# Graph Build / Validation

## Purpose

Validate the editor graph and compile it into a runtime‑ready graph (nodes, edges, roles, delays) that the Runtime module can execute.

## Primary references

- `moduleSpecs/node-behavior-table.md` (port layout + control semantics)
- `moduleSpecs/overview.md` (module boundaries)

## Responsibilities

- Validate connectivity (in→out only, one cable per port).
- Validate port/role compatibility (signal vs param/control).
- Enforce `delay >= 0` on all edges (runtime clamps to `minDelayTicks`).
- Compile the graph into a runtime representation with stable ordering.

## Explicit non-responsibilities

- Routing or delay computation (Routing+Delay handles geometry and delay).
- Runtime scheduling or audio integration.

## Inputs

- **Graph snapshot** (from Graph Model).
- **Node registry** (port layout + control rules).
- **Edge delays** (from Routing+Delay).

## Outputs

- **Runtime graph**: nodes with params/state, edges with roles + delays.
- **Errors/warnings** for invalid connections or unsupported layouts.

---

## Runtime graph output schema

**Decision: rich graph object.** The build output is a runtime‑ready graph object that includes:

- Canonical node/edge arrays (stable order).
- Adjacency maps/indexes (edgesByNode, edgesByPort, etc.).
- Precomputed role/port ordering and per‑node metadata needed by the runtime.

The rich object matches a “graph of pure functions” model (Tidal/Strudel‑style) while keeping deterministic arrays as the source of truth. Adjacency maps are derived from those arrays and treated as build‑time structures.

---

## External contract (locked)
Build/Validate is a **pure function module** that consumes a graph snapshot + registry + delays.

```ts
buildGraph(
  snapshot: GraphSnapshot,
  registry: RegistryAPI,
  delays: Map<string, number>,
  opts?: BuildOptions
): BuildResult

validateGraph(
  snapshot: GraphSnapshot,
  registry: RegistryAPI,
  delays: Map<string, number>
): ValidationResult
```

```ts
type BuildResult = {
  ok: boolean;
  graph?: CompiledGraph;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type BuildOptions = {
  includeDebugMaps?: boolean; // default true
};

type RegistryAPI = {
  getNodeDefinition: (type: string) => NodeDefinition | undefined;
  getLayout: (layout: string, inputs: number, outputs: number, controlPorts: number) => PortLayout;
};

**Runtime update handoff (locked):**
- Build/Validate returns a **full CompiledGraph** only (no diff/patch output).
- The caller is responsible for deciding `setGraph` vs `applyPatch` in Runtime.
```

---

## Compiled graph schema (locked)
```ts
type CompiledGraph = {
  nodes: CompiledNode[];
  edges: CompiledEdge[];
  edgesByNodeId: Map<string, string[]>; // edge IDs in deterministic order
  edgesByPortId: Map<string, string>;   // 1 cable per port (portId = `${nodeId}:${direction}:${slotId}`)
  nodeIndex: Map<string, number>;
  edgeIndex: Map<string, number>;
  groupMeta?: GroupMeta;
  debug?: DebugMaps;
};

type CompiledNode = {
  id: string;
  type: string;
  param: number;          // snapshot.params.param ?? registry.defaultParam
  state: NodeState;       // registry initState() result (or {})
  inputs: number;
  outputs: number;
  controlPorts: number;
};

type CompiledEdge = {
  id: string;
  from: { nodeId: string; portSlot: number };
  to: { nodeId: string; portSlot: number };
  role: 'signal' | 'control';
  delay: number;          // base delay (float ticks)
};

type DebugMaps = {
  nodeIdToSourceId: Map<string, string>;
  edgeIdToSourceId: Map<string, string>;
};
```

---

## Validation error codes (locked)
Errors use the `BUILD_` prefix (distinct from `REG_` and `MODEL_`):
- `BUILD_UNKNOWN_NODE_TYPE`
- `BUILD_PORT_COUNT_MISMATCH`
- `BUILD_PORT_SLOT_INVALID`
- `BUILD_ROLE_MISMATCH`
- `BUILD_SAME_DIRECTION`
- `BUILD_PORT_ALREADY_CONNECTED`
- `BUILD_DANGLING_PORT`
- `BUILD_MISSING_DELAY`
- `BUILD_GROUP_MAPPING_INVALID`

---

## Validation rules (explicit)
- **Unknown node type** → `BUILD_UNKNOWN_NODE_TYPE` (registry is source of truth).
- **Port slot out of range** → `BUILD_PORT_SLOT_INVALID`.
- **Role mismatch** (signal ↔ control) → `BUILD_ROLE_MISMATCH`.
- **Same‑direction endpoints** (out→out or in→in) → `BUILD_SAME_DIRECTION`.
- **One cable per port** → `BUILD_PORT_ALREADY_CONNECTED`.
- **Dangling endpoints** (node/port missing) → `BUILD_DANGLING_PORT`.
- **Missing delay** for any edgeId → `BUILD_MISSING_DELAY`.
- **Group mapping invalid** (missing node/port/param, duplicates) → `BUILD_GROUP_MAPPING_INVALID`.

---

## Group flattening model (locked)
- **Runtime graph is flattened**: internal group nodes/edges are added to `nodes[]`/`edges[]`.
- **Group boundaries are preserved in metadata only**:
```ts
type GroupMeta = {
  groupsById: Map<string, {
    nodeIds: string[];
    externalInputs: { groupPortSlot: number; nodeId: string; portSlot: number }[];
    externalOutputs: { groupPortSlot: number; nodeId: string; portSlot: number }[];
    controls: { groupPortSlot: number; nodeId: string; paramKey?: string }[];
  }>;
};
```

---

## Ordering guarantees (locked)
- **Node order**: insertion order from the graph snapshot.
- **Edge order**: insertion order from the graph snapshot.
- **Adjacency lists**: preserve edge insertion order per node for deterministic runtime scheduling.

---

## Validation issue shape (locked)
```ts
type ValidationIssue = {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  groupId?: string;
  portSlot?: number;
};
```

---

## Delay input contract (locked)
- `delays` is a **Map<edgeId, number>** with **base delay in ticks** (float).
- Missing delay for any edge is **fatal** (`BUILD_MISSING_DELAY`).

## Build purity

**Decision: pure build (no mutation of the editor graph).** Build produces a new compiled graph object every time. This does **not** imply resetting runtime state; runtime uses live‑patching to preserve in‑flight pulses and only drops/reschedules affected events. Keeping build side‑effect‑free makes diffing and hot‑reload safer and more predictable.

## Validation rules (full checklist)

This checklist is **fully covered** by the explicit rules above; no additional rules are required.

## Error & warning model

**Decision: collect all errors (no fail‑fast).** Build runs through the entire graph, accumulating every error so the user can fix issues in one pass. If any errors exist, the build fails and no runtime graph is emitted. Warnings may still be reported, but only errors block compilation.

## Unknown node types

**Decision: unknown node types are errors (build fails).** Runtime continues using the last valid compiled graph so pulses keep running. This avoids silently dropping nodes or changing behavior.

## Param range enforcement

**Decision: clamp in runtime using the function/registry definitions.** Build does not error or warn on out‑of‑range params; the runtime/registry mapping clamps values to the 1–8 range when they are applied.

## Control vs signal role assignment

**Decision: registry‑explicit only.** Build assigns edge roles strictly from registry port definitions; no derived fallback by position/index.

## Edge normalization

**Decision: derive direction from port roles and normalize to `out → in`.** Edges are stored as endpoints only; build assigns a canonical orientation based on port roles. Same‑direction connections (in→in or out→out) are errors.

## Port ordering source

**Decision: registry order only.** Port ordering comes from the registry (and the behavior table’s global ordering) with no per‑graph overrides.

## Ordering guarantees

**Decision: preserve insertion order.** Use the graph model’s stable insertion order for node and edge arrays. Port ordering is taken from the registry/behavior table. Event ordering (if precomputed) follows edge order.

## Handling invalid edges

**Decision: invalid edges are errors (build fails),** but the runtime continues using the **last valid compiled graph**. This keeps pulses running while the user fixes mistakes, and avoids silently changing behavior.

## Dangling references

**Decision: dangling references are errors (build fails).** Runtime keeps the last valid compiled graph.

## Runtime state initialization

**Decision: build initializes node params/state from the registry defaults (merged with any per‑node values in the graph snapshot).** The runtime consumes the compiled state as‑is and does not re‑initialize on load. This keeps behavior deterministic and makes the compiled graph self‑contained.

## Invariant enforcement

**Decision: strict enforcement in build.** Invariant violations (e.g., one‑cable‑per‑port, incompatible roles) are errors; build fails and runtime keeps the last valid compiled graph.

## Debug maps

**Decision: include debug maps.** Build output includes mappings from compiled nodes/edges back to source IDs for diagnostics and UI console selection.

## Grouped node compilation

**Decision: flatten for runtime, preserve boundaries for representation.**

- Internal nodes are compiled into the main runtime graph (no virtual group nodes in execution).
- Group boundaries are preserved via metadata (groupId → internal node IDs + port mappings).
- This allows a future graph‑language view or UI to represent a group as a single function **or** expand it to show internal nodes.

## Grouped node validation details

**Decision: mapping errors are fatal.** If any group mapping is invalid or stale, build fails. Runtime keeps the last valid compiled graph so pulses keep running.

## Delay integration boundary

**Decision: missing delay is an error.** Build fails if an edge has no delay entry; runtime continues using the last valid compiled graph.

## Min delay clamping

**Decision: runtime‑only clamping.** Build stores raw delays; runtime applies `minDelayTicks` when scheduling. (Optional: UI/console can display effectiveDelay for diagnostics.)

## Testing hooks

**Testing strategy (locked):**

- **Fixtures**: `test/fixtures/build/`
  - `valid-min.json` (small valid graph)
  - `invalid-unknown-type.json` → `BUILD_UNKNOWN_NODE_TYPE`
  - `invalid-port-mismatch.json` → `BUILD_PORT_COUNT_MISMATCH`
  - `invalid-role-compat.json` → `BUILD_ROLE_MISMATCH`
  - `invalid-same-direction.json` → `BUILD_SAME_DIRECTION`
  - `invalid-one-cable-per-port.json` → `BUILD_PORT_ALREADY_CONNECTED`
  - `invalid-missing-delay.json` → `BUILD_MISSING_DELAY`
  - `invalid-dangling-port.json` → `BUILD_DANGLING_PORT`
  - `invalid-group-mapping.json` → `BUILD_GROUP_MAPPING_INVALID`
- **Core tests**:
  - `test/build-validate.test.js` — build/validate runs against each fixture and asserts the expected `BUILD_*` codes.
  - `test/build-graph.test.js` — valid graph compiles to a **stable, deterministic** runtime graph (snapshot or golden JSON).
  - `test/build-ordering.test.js` — insertion order for nodes/edges is preserved and reflected in compiled ordering.
  - `test/build-grouping.test.js` — group flattening preserves internal topology and group metadata.
- `test/build-delays.test.js` — delays are applied per edge and preserved in compiled graph.
- `test/build-role-assign.test.js` — edge roles match registry port roles (signal vs control).
- `test/build-params.test.js` — param merge rule (snapshot override vs registry default) is correct.
- `test/build-debug-maps.test.js` — debug maps are present when `includeDebugMaps` is true.
**Passing criteria:** valid graphs compile with zero errors; invalid fixtures yield the expected `BUILD_*` codes; compiled graphs are deterministic and stable; delay/role/param/debug behavior matches the locked rules.

---

## Implementation file layout (recommended)
- `packages/core/build/build-graph.js` — `buildGraph()` entry point.
- `packages/core/build/validate-graph.js` — `validateGraph()` entry point.
- `packages/core/build/compile.js` — compiled graph assembly (nodes, edges, adjacency).
- `packages/core/build/roles.js` — role assignment (signal/control) from registry port roles.
- `packages/core/build/groups.js` — group flattening + metadata.
- `packages/core/build/errors.js` — `BUILD_*` error codes + builders.
- `packages/core/build/debug.js` — debug map creation.

## Core requirements

- Normalize edges to `out → in` (if not already).
- Assign `role` on each edge: `signal` or `param` (control).
- Apply control‑first semantics based on **registry‑defined control ports**.
- Enforce global port ordering for multi‑I/O nodes.
- Preserve deterministic ordering (stable insertion order) for edges and events.
- For **grouped nodes**, validate external port mappings and ensure they reference valid internal ports/params.

## Technical requirements to finalize later

- None. All technical requirements are locked in this spec.

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
