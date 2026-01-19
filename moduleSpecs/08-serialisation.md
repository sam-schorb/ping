# Serialisation (JSON; DSL deferred)

## Purpose

Persist and restore graphs using **JSON as the canonical format**.  
Any **derived graph‑language/DSL view is deferred** to a later phase and is not part of the current implementation scope.

## Primary references

- `moduleSpecs/overview.md` (JSON is canonical; graph language is derived)

## Responsibilities

- Serialise the graph snapshot to JSON (project file).
- Parse JSON back into a graph snapshot with stable IDs.
- Handle versioning and migrations.

## Explicit non-responsibilities

- Runtime execution or scheduling.
- UI rendering.

## Inputs

- **Graph snapshot** (nodes, edges, manual corners, rotations, params). Ports are derived from registry.
- **Sample slot assignments** (8 sample references from the UI).

## Outputs

- **JSON project data** (canonical).
- **Parsed graph snapshot** (for load).

---

## External contract (locked)
Serialisation is a **pure function module** with explicit parse/serialise APIs.

```ts
serialiseProject(input: ProjectInput): ProjectJSON
parseProject(json: ProjectJSON | string): ParseResult
```

```ts
type ProjectInput = {
  graph: GraphSnapshot;
  samples?: Slot[];          // length 8
  settings?: ProjectSettings;
  project?: ProjectMeta;
};

type ParseResult = {
  ok: boolean;
  project?: ProjectInput;
  errors: SerialIssue[];
  warnings: SerialIssue[];
};
```

---

## Core requirements

- Preserve stable IDs for nodes/edges (ports are derived).
- Preserve geometry: positions, rotations, manual corners, grid units.
- Version field for forward/backward compatibility.
- Include grouped node internals (subgraph + mappings) in the JSON (stored on `graph.groups`).
- **Persist sample slots in project JSON** (slots 1–8) for portability.

---

## Canonical JSON schema (exact field names)

```ts
type ProjectJSON = {
  schemaVersion: number;
  graph: GraphSnapshot;
  samples?: Slot[];          // length 8
  settings?: ProjectSettings;
  project?: ProjectMeta;
};

type GraphSnapshot = {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  groups?: Record<string, GroupDefinition>;
};

type NodeRecord = {
  id: string;
  type: string;
  pos: { x: number; y: number };
  rot: 0 | 90 | 180 | 270;
  params: Record<string, number>; // currently uses key "param"
  name?: string;
  groupRef?: string;
};

type EdgeRecord = {
  id: string;
  from: { nodeId: string; portSlot: number };
  to: { nodeId: string; portSlot: number };
  manualCorners: { x: number; y: number }[];
};

type GroupDefinition = {
  id: string;
  name: string;
  graph: GraphSnapshot; // internal graph only (no nested group library)
  inputs: { label?: string; nodeId: string; portSlot: number }[];
  outputs: { label?: string; nodeId: string; portSlot: number }[];
  controls: { label?: string; nodeId: string; paramKey?: string }[];
};

type Slot = { id: string; path: string };

type ProjectSettings = {
  tempo: number; // BPM
};

type ProjectMeta = {
  name?: string;
  createdAt?: string;
  updatedAt?: string;
};
```

---

## Units + conventions

- Positions, sizes, corners: **grid units** (not pixels).
- Rotation: **degrees**, clockwise.
- Port ordering: **derived from registry** (not snapshot order).
- Arrays preserve **insertion order** (nodes/edges) for deterministic UI and build.

---

## Deterministic serialisation rules

- IDs never change on save/load.
- No re‑sorting of arrays on save (store in insertion order).
- Optional: stable JSON key ordering for diff‑friendly saves (if desired).

---

## Source vs derived data

- Must store: manual corners, node positions, rotations, params, group mappings.
- Must NOT store: routed points, runtime caches, selection, hover, drag state.
- Derived graph language is **read‑only** and **never** used as input.

---

## Persistence boundary

- **UI state boundary:** no UI state is persisted. Selection, camera position, open panels, hover state, and in‑flight interactions are not stored.
- **Global settings:** persist **tempo (BPM) only**. `ticksPerBeat` and `gridSize` are universal constants and are **not** stored in the project file.
- **Ports are derived:** ports are **not** stored in JSON. They are reconstructed from the registry using each node’s type and global port ordering.

---

## Node/edge record requirements

- **Node record requirements:** must include at least `id`, `type`, `pos` (grid units), `rot`, and `params`. Optional fields include `name` and `groupRef`. Missing required fields are filled by defaults only if explicitly allowed by schema defaults.
- **Edge record requirements:** edges store only endpoints + geometry: `id`, `from` = `{nodeId, portSlot}`, `to` = `{nodeId, portSlot}`, and `manualCorners`. Edge roles are derived from connected port roles at load/build time.

---

## Group library

- Group definitions and mappings are stored **inside the project JSON**.
- Group nodes reference their definitions by `groupId`/`groupRef`.
- Group definitions are the source of truth for grouped behavior.

---

## Sample slots

- **Slot schema:** `{ id, path }` today, with room to support URLs later.
- If a referenced asset is missing, the loader falls back to default samples and logs a warning.
- Slot entries may be **simple identifiers** (e.g., local filenames/labels) and can extend to remote URLs without breaking compatibility.

---

## Top‑level structure

- The top‑level file must include **`schemaVersion` + `graph`**.
- Additional sections (e.g., `samples`, `settings`, `project`) are **optional and extensible**. Group library lives under `graph.groups`.

---

## Error handling + validation

- **Error policy (parse/load):** if JSON is malformed or required sections are invalid, **fail load** and keep the last valid graph if available. Do not partially load corrupted graphs.
- **Unknown types/invalid edges:** unknown node types or invalid edges/ports are treated as **load errors** (fail load + keep last valid graph). This matches build validation strictness.

### Error/warning model (locked)
```ts
type SerialIssue = {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  path?: string; // JSON pointer-ish path
};
```

// Error codes (prefix SERIAL_)
// SERIAL_PARSE_ERROR, SERIAL_MISSING_FIELD, SERIAL_INVALID_SCHEMA,
// SERIAL_UNKNOWN_NODE_TYPE, SERIAL_INVALID_EDGE, SERIAL_INVALID_GROUP,
// SERIAL_INVALID_SLOT, SERIAL_VERSION_MIGRATED, SERIAL_VERSION_UNSUPPORTED

---

## Versioning + migration

**Versioning policy (locked):**
- `schemaVersion` is a single integer. **Current version = 1**.
- Missing `schemaVersion` is treated as `0` and **migrated to latest**, with a warning.
- If `schemaVersion` ≤ current, **migrate step‑by‑step** to latest and emit `SERIAL_VERSION_MIGRATED` warnings.
- If `schemaVersion` > current, **fail load** with `SERIAL_VERSION_UNSUPPORTED` and keep the last valid graph.

**Migration rule (v0 → v1, locked):**
- If JSON contains **top‑level** `groups`, move it to `graph.groups` and delete the top‑level field.
- Emit `SERIAL_VERSION_MIGRATED` with a message noting `groups → graph.groups`.

The model and runtime expect the **latest schema only** after load.  
Defaulting is applied on load (e.g., missing `rot` → 0, missing `params` → {} or registry defaults) to keep backward compatibility while still enforcing required keys.

---

## Derived graph‑language view (future)

- Provide a **custom, read‑only DSL view** derived from JSON.
- It is **not** round‑trippable and never used as input.
- Group views support both **collapsed** (top‑level) and **expanded** (inside group) representations.

---

## Testing / validation hooks

- Schema validation tests.
- Golden‑file load/save round‑trip tests.
- Migration tests for version bumps.

---

## Testing strategy (locked)
- **Fixtures**: `test/fixtures/serialisation/`
  - `valid-min.json` (small valid graph)
  - `valid-groups.json` (group library + mappings)
  - `valid-slots.json` (8 sample slots)
  - `invalid-json.txt` → `SERIAL_PARSE_ERROR`
  - `invalid-schema.json` → `SERIAL_INVALID_SCHEMA`
  - `invalid-unknown-type.json` → `SERIAL_UNKNOWN_NODE_TYPE`
  - `invalid-edge.json` → `SERIAL_INVALID_EDGE`
  - `invalid-slot.json` → `SERIAL_INVALID_SLOT`
  - `future-version.json` → `SERIAL_VERSION_UNSUPPORTED`
  - `legacy-groups-top-level.json` → migrates `groups` into `graph.groups`
- **Core tests**:
  - `test/serialise-roundtrip.test.js` — serialize → parse → same graph structure.
  - `test/serialise-migrate.test.js` — version 0/1 migration paths.
  - `test/serialise-errors.test.js` — expected `SERIAL_*` codes for invalid fixtures.
**Passing criteria:** valid fixtures parse with no errors; invalid fixtures produce expected `SERIAL_*` codes; round‑trip preserves IDs + ordering.

---

## Implementation file layout (recommended)
- `packages/core/serialisation/serialize.js` — `serialiseProject()` implementation.
- `packages/core/serialisation/parse.js` — `parseProject()` implementation.
- `packages/core/serialisation/migrate.js` — schema migration helpers.
- `packages/core/serialisation/validate.js` — schema validation.
- `packages/core/serialisation/errors.js` — `SERIAL_*` codes + helpers.

---

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
- Open decisions (explicit list)
