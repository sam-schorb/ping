# Graph Model / State

## Purpose

Maintain the canonical graph state: nodes, ports, edges, positions, rotations, and manual corners. This is the **single source of truth** for topology + geometry. The model is designed to support **live patching** (no runtime resets) and a **highly responsive editor**.

## Primary references

- `moduleSpecs/overview.md` (module boundaries)
- `moduleSpecs/node-registry.md` (node type metadata)

## Responsibilities

- Store nodes with stable IDs, positions (top‑left), rotation, and params.
- Store ports with stable ordering (`slotId`) and connection state.
- Store edges normalized as **out → in**, with manual corners.
- Provide **snapshot accessors** for routing, validation, runtime build, and serialisation.
- Apply user intents as **atomic graph mutations** with deterministic ordering.
- Maintain indexes for fast lookup (node → edges, port → edge, id → entity).

## Explicit non-responsibilities

- Routing or path geometry (Routing+Delay module does this).
- Runtime simulation or scheduling.
- Audio integration.

## Ownership boundaries

- The graph model stores **only topology + geometry**.
- **UI state** (selection, camera, hover, drag state) is **not** stored here.
- **Derived geometry** (routed paths, edge lengths) is **not** stored here.

## Inputs

- **Edit operations** from the UI (command list of ops).
- **Loaded JSON** from Serialisation (project restore).

## Outputs

- **Graph snapshot** for Routing+Delay, Build/Validate, Serialisation.
- **Change events** for UI/runtime (if subscribed).

---

## Data shape (summary)

- **Node**: `id`, `type`, `x`, `y`, `rotation`, `params`, optional `name`.
- **Port**: `id`, `nodeId`, `direction`, `slotId`, `connectedEdgeId`.
- **Edge**: `id`, `from {nodeId, portSlot}`, `to {nodeId, portSlot}`, `manualCorners[]`.

### IDs & names

- **UUIDs** for nodes/edges (stable across save/load).
- **Port IDs are deterministic** (derived from `nodeId + direction + slotId`) so ports do not need to be stored in JSON.
- **Names/labels** are separate fields for display only; IDs never include names.
- Grouped nodes have their own UUID + name. Internal nodes keep UUIDs within group scope.

---

## Coordinate system & units

- **Coordinates stored in grid units** (not pixels).
- **Origin**: top‑left of world bounds.
- **Rotation direction**: clockwise (0 → 90 → 180 → 270).
- **Snap anchor**: node **top‑left** snaps to nearest grid point.
- **UI conversion**: UI converts grid → pixels with `GRID_SIZE_PX`.

Why: ticks are grid‑distance units (1 grid cell = 1 tick), so storing geometry in grid units keeps timing + geometry aligned.

---

## Mutation API (edit operations)

**Primary API:** `applyOps(ops[])` (command list).

Ops are **semantic** and should be **validated** before applying.  
Grouping is performed via **composed multi‑ops** (see Technical details).

### Atomic multi‑ops

- The model supports **atomic multi‑ops**: a list of ops applied as one transaction.
- Used for grouping, multi‑node drag, or batch delete.
- Prevents transient invalid states and reduces runtime churn.

---

## Derived vs stored data

**Stored in model:**

- Node positions, rotations, params
- Port IDs, directions, slotIds
- Edge endpoints + manual corners

**Derived (not stored in model):**

- Port world positions (derived from node + registry)
- Node size (derived from registry + port counts) using the fixed formula:
  - **Side length (grid units)** = `portsOnSide + 1`
  - **Port anchors** land on **grid intersections** (no fractional anchors)
- Routed edge geometry + edge lengths (Routing+Delay)

**Caching rule:** Derived geometry may be cached **only in Routing+Delay**, never in the model.

---

## Ordering & IDs

- **Insertion order** is the canonical ordering for nodes/edges.
- Arrays preserve order; maps are for lookup only.
- Ordering is **not** topology; edges define connectivity, ordering only affects deterministic processing of same‑time events.
- **Port ordering is derived from the registry/behavior table**, not insertion order. Ports use stable `slotId` values provided by the registry.

---

## Port storage (hybrid)

- Store **port IDs + slot/direction** in the model (derived from registry).
- **Positions are derived** from node + registry at render/routing time.
- Edges reference endpoints by **nodeId + portSlot** (port IDs are derived for indexes/lookup).

---

## Edge corners representation

- Store **manual corners in grid units** (ordered list).
- **Removal is allowed** after creation; **adding new corners is not** (recreate cable to add corners).
- Corners are snapped to grid intersections.

---

## Grouped node representation

- Grouped nodes reference a **separate subgraph library** by ID.
- Group instances store:
  - `groupRef` (points to library entry)
  - exposed input/output mappings
  - exposed control → param mappings
- Group definitions live **inside project JSON** (single‑file format).
- Internal graph keeps its **own UUID namespace**; display paths like `GroupName/SubNodeName` are for readability only.
- **Group node port counts/layout are derived from the group definition**, not stored in the node record. Ports remain derived from registry + group mappings.

---

## Validation scope

**Model enforces structural integrity:**

- No dangling edges (edge endpoints must exist).
- One cable per port.
- Valid port IDs and node IDs.

**Build/Validate enforces semantics:**

- Signal vs control role constraints.
- Node‑specific rules (from registry/behavior table).
- Delay constraints (base delay >= 0; runtime clamps to `minDelayTicks`).

---

## Change notifications / transactions

- Model implemented as a **GraphModel class** with:
  - `applyOps(ops[])`
  - `getSnapshot()`
  - `onChange(cb)`
- Undo/redo is handled by the UI via **snapshots per user action**.

---

## Serialisation contract

- JSON stores **only topology + geometry** (ports are **derived from registry**):
  - nodes (`id`, `type`, `pos` in grid units, `rot`, `params`, optional `name`, optional `groupRef`)
  - edges (`id`, `from` = `{nodeId, portSlot}`, `to` = `{nodeId, portSlot}`, `manualCorners` in grid units)
  - group library (definitions + mappings)
- **No UI state** (camera, selection) in JSON.
- JSON includes a **version** field; model expects the latest schema only.

---

## Live update policy (runtime patching)

**Hybrid, fully live updates** to keep in‑flight pulses and maximize responsiveness.

**Behavior**

- Node deleted → drop all pending events targeting that node.
- Edge deleted → drop all pending events scheduled along that edge.
- Param change → affects already‑scheduled events (params read at processing time).
- Geometry change → reschedule pending events on affected edges using new delay.

**Required event metadata for patching**

- `edgeId`
- `emitTime`

**Mitigations / guardrails**

- Preserve stable ordering when rescheduling.
- Avoid rescheduling events inside the current audio lookahead window.
- Throttle rescheduling during active drags.

---

## Performance / indexing

Maintain indexes for fast lookup:

- `nodeById`, `portById`, `edgeById`
- `edgesByNodeId`
- `edgeByPortId`

Indexes update inside atomic transactions.

---

## Edge cases / failure behavior

- Invalid op (unknown ID, invalid port) → reject op and report error.
- Removing a node deletes all connected edges.
- Removing a port is not allowed (ports are derived from registry).
- Group ref missing → report error on load or build.

---

## Invariants

- Port IDs are stable; slotIds do not change with rotation.
- Port ordering is registry‑defined (global ordering from the behavior table); the model does not invent port order.
- One cable per port.
- Edge endpoints are normalized out → in.
- Manual corners are ordered and stored in grid units.
- Grouped subgraphs preserve internal ordering and geometry.

---

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
- Open decisions (explicit list)

---

## Technical implementation details (locked)

- **Implementation style**: `GraphModel` is a **class** that owns state, indexes, and subscriptions (not a pure function API).
- **Op envelope**: ops use a **generic shape**: `{ type: string, payload: unknown }` with runtime validation per op type.
- **Atomic ops**: `applyOps()` is **transactional**. If any op fails validation, **no changes are applied**.
- **Snapshot shape**: graph snapshots include **nodes, edges, and group library only**. Ports are **derived** from registry + node type; they are not serialised or stored in snapshots.
- **Slot index base**: all `portSlot`/`slotId` values are **0‑based**.
- **Edge orientation**: model stores edges **out → in only**. `addEdge` rejects endpoints that do not map to output → input.
- **Indexes** are always‑on and updated incrementally inside transactions (no lazy rebuilds).
- **Group storage**: group instance nodes store only `groupRef`; mappings live in the group library. Grouping is performed via **composed multi‑ops** (UI builds the group definition + replaces nodes).
- **Defaults on load**: missing `rot` defaults to `0`; missing `params` defaults to `{}`. Required fields (`id`, `type`, `pos`) are **fatal** if missing. Registry defaults are applied later in Build/Validate.
- **Unknown node types**: `addNode` and load **reject** unknown types (`MODEL_UNKNOWN_NODE_TYPE`).
- **Quantization**: positions and manual corners are stored as **integer grid units**. `applyOps` rejects non‑integer values.
- **Param defaults on add**: model does **not** auto‑fill params on `addNode`; caller supplies `params` (Build/Validate merges registry defaults later).
- **Change events**: `onChange` emits **ops only**; consumers call `getSnapshot()` if needed.
- **Grouping ops**: no high‑level `groupNodes` op. UI emits composed ops (`addGroup`, `addNode`, `addEdge`, `removeNode`, `removeEdge`).
- **Docs vs implementation**: type snippets are **TS‑ish for documentation only**; implementation is plain **JavaScript** (optionally with JSDoc types).

### External contract (GraphModel API)

```ts
class GraphModel {
  constructor(opts: {
    getNodeDefinition: (type: string) => NodeDefinition | undefined;
    snapshot?: GraphSnapshot;
  });

  applyOps(ops: GraphOp[]): ApplyResult;
  getSnapshot(): GraphSnapshot;
  getIndexes(): GraphIndexes;
  onChange(cb: (evt: ChangeEvent) => void): () => void;
}

type ApplyResult = {
  ok: boolean;
  changed: boolean;
  errors?: GraphOpError[];
};

type ChangeEvent = {
  ops: GraphOp[];
};
```

### Testing strategy (locked)

- **Fixtures**: `test/fixtures/model/`
  - `valid-min.json` (1 node, no edges)
  - `invalid-unknown-type.json` → `MODEL_UNKNOWN_NODE_TYPE`
  - `invalid-non-integer-pos.json` → `MODEL_INVALID_POSITION`
  - `invalid-edge-direction.json` → `MODEL_EDGE_DIRECTION_INVALID`
  - `invalid-port-slot.json` → `MODEL_PORT_INVALID`
- **Core tests**:
  - `test/model-applyops.test.js` — valid ops apply, invalid ops reject transaction (no partial changes).
  - `test/model-indexes.test.js` — indexes are correct after each op (node/edge/port maps).
  - `test/model-ports-derived.test.js` — ports are derived from registry + slotId order; no ports in snapshot.
- `test/model-grouping.test.js` — composed ops for grouping create group library + replace nodes/edges correctly.
- `test/model-snapshot.test.js` — `getSnapshot()` returns insertion‑order arrays with integer positions/corners.
  **Passing criteria:** zero model validation errors on valid fixtures; invalid fixtures yield expected `MODEL_*` codes; no partial writes when any op fails.

---

## Implementation file layout (recommended)

- `packages/core/graph/model.js` — `GraphModel` class (state, applyOps, subscriptions).
- `packages/core/graph/ops.js` — op validators + normalization.
- `packages/core/graph/indexes.js` — index builders + incremental updates.
- `packages/core/graph/ports.js` — port ID derivation + slot helpers (registry‑aware).
- `packages/core/graph/errors.js` — `MODEL_*` error codes + helpers.
- `packages/core/graph/snapshot.js` — snapshot cloning/defaults/assertions.
- `packages/core/graph/grouping.js` — group library helpers + mapping validation.
- `packages/core/graph/constants.js` — shared constants (rotations, directions).

### Core data types (TS-ish)

```ts
type GraphSnapshot = {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  groups?: Record<string, GroupDefinition>;
};

type NodeRecord = {
  id: string;
  type: string;
  pos: { x: number; y: number }; // grid units
  rot: 0 | 90 | 180 | 270;
  params: Record<string, number>; // currently uses key "param"
  name?: string;
  groupRef?: string;
};

type EdgeRecord = {
  id: string;
  from: { nodeId: string; portSlot: number }; // output slot
  to: { nodeId: string; portSlot: number }; // input slot
  manualCorners: { x: number; y: number }[];
};

type PortRecord = {
  id: string; // `${nodeId}:${direction}:${slotId}`
  nodeId: string;
  direction: 'in' | 'out';
  slotId: number; // 0-based
  connectedEdgeId?: string;
};

type GraphIndexes = {
  nodeById: Map<string, NodeRecord>;
  edgeById: Map<string, EdgeRecord>;
  portById: Map<string, PortRecord>;
  edgesByNodeId: Map<string, Set<string>>;
  edgeByPortId: Map<string, string>;
};
```

### Port slot rules (locked)

- Output `portSlot` is **0‑based** in the node’s **output list order**.
- Input `portSlot` is **0‑based** in the node’s **input list order** (signal inputs first, then control inputs).
- Port ordering comes **only** from the registry (behavior table); the model never invents port order.

### Op payloads (validated)

```ts
type GraphOp = { type: string; payload: unknown };

// Supported ops (payload shapes)
type AddNode = {
  type: 'addNode';
  payload: { node: NodeRecord };
};
type RemoveNode = { type: 'removeNode'; payload: { id: string } };
type MoveNode = {
  type: 'moveNode';
  payload: { id: string; pos: { x: number; y: number } };
};
type RotateNode = {
  type: 'rotateNode';
  payload: { id: string; rot: 0 | 90 | 180 | 270 };
};
type SetParam = { type: 'setParam'; payload: { id: string; param: number } }; // sets params.param
type RenameNode = { type: 'renameNode'; payload: { id: string; name: string } };

type AddEdge = {
  type: 'addEdge';
  payload: { edge: EdgeRecord };
};
type RemoveEdge = { type: 'removeEdge'; payload: { id: string } };

type AddCorner = {
  type: 'addCorner';
  payload: { edgeId: string; index: number; point: { x: number; y: number } };
};
type MoveCorner = {
  type: 'moveCorner';
  payload: { edgeId: string; index: number; point: { x: number; y: number } };
};
type RemoveCorner = {
  type: 'removeCorner';
  payload: { edgeId: string; index: number };
};

type AddGroup = { type: 'addGroup'; payload: { group: GroupDefinition } };
type RemoveGroup = { type: 'removeGroup'; payload: { groupId: string } };
```

### Op validation error model (locked)

```ts
type GraphOpError = {
  code: string;
  message: string;
  opIndex: number;
  opType: string;
  entityId?: string;
};

// Error codes (prefix MODEL_)
// MODEL_UNKNOWN_NODE_TYPE, MODEL_DUPLICATE_ID, MODEL_NODE_NOT_FOUND,
// MODEL_EDGE_NOT_FOUND, MODEL_PORT_INVALID, MODEL_PORT_ALREADY_CONNECTED,
// MODEL_EDGE_DIRECTION_INVALID, MODEL_EDGE_DANGLING_ENDPOINT,
// MODEL_GROUP_NOT_FOUND, MODEL_GROUP_REF_INVALID, MODEL_INVALID_ROTATION
```
