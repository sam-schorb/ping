# Node Registry (Node System)

## Purpose

Define all node types in a single, scanned registry so UI, validation, and runtime use the same source of truth. This registry is **data‑first** but contains the behavior helpers it needs (in JS), and it is the authoritative source for:

- Node identity and UI metadata
- Port layouts and control ports
- Default parameters and parameter mapping metadata
- Node behavior functions (onControl/onSignal)

## moduleSpecsary references

- `moduleSpecs/node-registry.md` (registry concept)
- `moduleSpecs/node-behavior-table.md` (authoritative behavior list)
- `moduleSpecs/overview.md` (module boundaries)

## Responsibilities

- Provide a **single JS registry file** that defines all nodes.
- Expose maps used by:
  - UI palette (icon, color, label, description, category)
  - Build/Validation (port layout + control rules)
  - Runtime (behavior dispatch)
- Validate the registry at startup (dev/test) with a strict validator.

## Explicit non‑responsibilities

- Runtime scheduling or graph execution.
- Editor rendering or interactions.
- Audio parameter mapping (done by Audio Integration using registry metadata).

## Inputs

- **Node behavior table** (`moduleSpecs/node-behavior-table.md`) as the behavior source of truth.
- **Registry definitions** (the JS registry file itself).

## Outputs

- `type → definition` map (runtime dispatch)
- palette list (UI)
- port layout + role rules (build/validate)

---

## File layout (decided)

Single registry file plus helpers for archetypes and validation:

- `packages/core/nodes/registry.js` — single source of truth (param mappings + behavior helpers + archetypes + node definitions)
- `packages/core/nodes/archetypes.js` — port archetypes + helper functions
- `packages/core/nodes/validate-registry.js` — dev/test validator
- `packages/core/nodes/grouped-node.js` — grouped node helpers (optional)
- tests:
  - `test/registry.test.js`
  - `test/node-behaviors.test.js` (optional for stateful nodes)

---

## Implementation file layout (recommended)

- `packages/core/nodes/registry.js` — `NODE_REGISTRY` array + `buildRegistryIndex()` + `getNodeDefinition()`.
- `packages/core/nodes/behaviors/` — reusable behavior helpers (clamp, passthrough, gate, etc.).
- `packages/core/nodes/archetypes.js` — archetype definitions + `getLayout()`.
- `packages/core/nodes/validate-registry.js` — `validateRegistry()` + `REG_*` codes.
- `packages/core/nodes/palette.js` — `buildPalette()` (UI projection).
- `packages/core/nodes/grouped-node.js` — helpers for `group` node metadata (optional).

---

## Registry schema (JS)

**Registry is a JS module** exporting an array or map of node definitions. Behavior functions live in code and are referenced by the registry (avoid heavy inline logic).

### Required fields per node

- `type` (kebab‑case string, unique)
- `label` (human‑readable)
- `description` (short tooltip text)
- `category` (palette grouping)
- `icon` (icon key/name)
- `color` (UI color token)
- `layout` (archetype key, e.g. `single-io-control`)
- `inputs` / `outputs` (counts if archetype needs it)
- `controlPorts` (number; `0` if none)
- `hasParam` (boolean)
- `defaultParam` (number, clamp 1–8)
- `paramMap` (metadata for 1–8 → real domain)
- `onControl` (optional)
- `onSignal` (required)

### Optional fields

- `paletteOrder`
- `hidden` / `deprecated`

### Behavior mapping style (locked)

- **Option B**: `onControl` can update param/state; `onSignal` returns outputs and may update state.
- Runtime enforces **control‑first** ordering; node logic lives in registry behaviors.

### Param range and mapping (locked)

- **All params clamp to 1–8**; nodes cannot override the range.
- **Non‑integer values are allowed** in the registry for future flexibility, but current nodes use integers.
- **Param mapping metadata** lives in the registry (e.g. linear/log scale). **Runtime clamps** incoming values to 1–8 using registry definitions; audio/seq layer applies mapping.
- **Default params must be readable by Audio Integration** so it can fill omitted params before mapping to Dough.
- Audio Integration expects discrete **mapping tables** in `paramMap` for sample playback effects (sample select, decay/end, crush, hpf, lpf).

---

## Port layout representation (locked)

- Registry uses **rule‑based layouts** (archetypes + counts), not explicit per‑port lists.
- **Global multi‑I/O ordering** is implicit and fixed (from behavior table).
- **Explicit port lists** only for `layout: "custom"` nodes (e.g., grouped nodes).
- Control ports are **explicit**, not flags.
- Standard nodes have **≤1 control input**; `controlPorts: 0` means none.

### Archetype catalog + mapping rules (locked)

**Global multi‑I/O ordering (6‑way)** used for multi‑in/out nodes:
`top-left → top-right → right-top → right-bottom → bottom-right → bottom-left`

**Ordering rules:**

- Port ordering is defined in the **unrotated** layout and **does not change** when the node rotates (ports rotate visually, indices remain stable).
- Input port lists are ordered as: **signal inputs first (archetype order), then control inputs**.
- All control ports are **inputs** (no control outputs).

**Archetypes (required set):**

- `single-io`
  - inputs: `[signal @ left-top]`
  - outputs: `[signal @ right-top]`
- `single-io-control`
  - inputs: `[signal @ left-top, control @ left-bottom]`
  - outputs: `[signal @ right-top]`
- `single-in` (sink)
  - inputs: `[signal @ left-top]`
  - outputs: `[]`
- `multi-out-6`
  - inputs: `[signal @ left-top]`
  - outputs: `6` ports in **global multi‑I/O order**
- `multi-out-6-control`
  - inputs: `[signal @ left-top, control @ left-bottom]`
  - outputs: `6` ports in **global multi‑I/O order**
- `multi-in-6`
  - inputs: `6` ports in **global multi‑I/O order**
  - outputs: `[signal @ left-top]`
- `custom`
  - **Explicit per‑node PortLayout** provided by the owning definition (e.g., group instance mappings in project JSON). Registry only marks `layout: "custom"`.

---

## Behavior semantics (locked)

- **`onControl` fires only for control‑port pulses** (role = `control`). UI param changes update `node.param` directly and do **not** invoke `onControl`.
- **Control pulses are consumed** (no outputs). `onControl` may only return `{ param?, state? }`.
- **`onSignal` runs once per incoming signal pulse**. The `inPortIndex` corresponds to the input slot order defined by the registry (signal inputs first, then control inputs; `onSignal` only ever sees signal inputs).
- **Control‑first semantics**: if control + signal arrive in the same tick, `onControl` runs first and `onSignal` sees the updated `param`.
- **State initialization**: `initState()` runs once per node instance at build/compile time.
- **State update**: behaviors return a **new state object** in `{ state }`; runtime replaces the stored state (do not mutate in place).
- **Pulse inheritance**: outputs inherit the incoming pulse’s `speed` and `params` unless explicitly overridden on the `OutputEvent`.
- **Clamping**: behavior functions must output values/params/speed within **1–8**. Runtime clamps defensively as a last step.

---

## Custom layout schema (group nodes)

Group nodes are **dynamic** and live in the **project group library** (see Serialisation). The registry only defines the base `group` type with `layout: "custom"`.  
The **actual port layout and mappings** are derived from the group definition:

**GroupDefinition (project JSON)**

```ts
type GroupDefinition = {
  id: string;
  name: string;
  graph: GraphSnapshot; // internal nodes/edges (same schema as Graph Model; no nested group library)
  inputs: GroupPortMapping[]; // external signal inputs
  outputs: GroupPortMapping[]; // external signal outputs
  controls: GroupControlMapping[]; // external control inputs (param mappings)
};

type GroupPortMapping = {
  label?: string;
  nodeId: string; // internal node id
  portSlot: number; // internal port slot (signal in/out)
};

type GroupControlMapping = {
  label?: string;
  nodeId: string; // internal node id
  paramKey?: string; // default "param" (future-proof for multi-param nodes)
};
```

**Custom PortLayout derivation rules:**

- External **signal inputs** are ordered exactly as `inputs[]`.
- External **control inputs** are ordered exactly as `controls[]` and are appended **after** signal inputs in the node’s input list.
- External **signal outputs** are ordered exactly as `outputs[]`.
- Port placement for custom nodes uses the **default flow layout**:
  - All inputs (signal + control) are placed on the **left edge** (top → bottom).
  - All outputs are placed on the **right edge** (top → bottom).
  - Rotation changes visual placement, **not** port order.
  - Each derived `PortSpec` includes `side: "left"` for inputs and `side: "right"` for outputs.

**Validation rules (group mappings):**

- `inputs[]` must reference **unconnected internal signal inputs**.
- `outputs[]` must reference **unconnected internal signal outputs**.
- `controls[]` must reference **unique internal params** (no duplicates).
- Mappings that reference missing nodes/ports/params are **fatal build errors**.
- Unmapped internal params keep their registry defaults.

---

## Additional decisions (locked)

- **Port index base**: `inPortIndex`/`outPortIndex` are **0‑based** in code. The behavior table’s human‑readable ordering (1–6) is a UI/doc convention only.
- **Behavior purity**: `onControl`/`onSignal` must be **synchronous and side‑effect‑free** (no IO, no mutation outside returned state). All node behavior is deterministic.
- **Param clamping before behavior**: runtime clamps incoming `param`, `pulse.value`, and `pulse.speed` to **1–8** **before** calling node behavior. Runtime also clamps outputs defensively.
- **`paramMap` naming + requirement**: keep the field name `paramMap` for compatibility, but it is **metadata only**. It is **optional**; if present, it must conform to `ParamMeta`. Audio Integration decides what to do when mapping metadata is missing.
- **Built‑in `group` node definition**: registry includes a `type: "group"` entry with `layout: "custom"`. For custom layouts, **port counts are derived from the group definition**, not the registry placeholder values.

---

## Grouped node (dynamic)

- Registry defines a **built‑in `group` node type**.
- User‑defined group nodes are **dynamic instances**, stored as definitions containing:
  - internal subgraph
  - exposed input/output mappings
  - exposed control‑to‑param mappings
- Internal connections are preserved.
- Unexposed params stay at defaults.
- Group definitions live in **project JSON** and optionally a **user library** (localStorage/IndexedDB).
- Export/import group definitions as JSON.

---

## Validation (locked)

**JavaScript‑only** validation:

- Runtime validator in dev/test (fail hard).
- Required checks:
  - unique `type`
  - required fields present
  - `defaultParam` in 1–8 when `hasParam`
  - `onSignal` present
  - layout/archetype consistency
  - control port constraints
  - multi‑I/O ordering adherence

**Testing strategy (locked):**

- **Fixtures**: `test/fixtures/registry/`
  - `valid-min.json` (small valid registry slice)
  - `invalid-duplicate-type.json`
  - `invalid-missing-field.json`
  - `invalid-layout-mismatch.json`
  - `invalid-parammeta.json`
- **Core tests**:
  - `test/registry.test.js` — loads `NODE_REGISTRY`, runs `validateRegistry()`, asserts `ok=true`.
  - `test/registry-validator.test.js` — runs validator against each invalid fixture and asserts the expected `REG_*` code.
  - `test/registry-palette.test.js` — `buildPalette()` returns stable order (respecting `paletteOrder`), omits hidden nodes, and includes required UI fields.
  - `test/registry-archetypes.test.js` — `getLayout()` matches archetype constraints for each node in registry.
  - Optional: `test/node-behaviors.test.js` — stateful nodes (`counter`, `every`) have deterministic state progression with fixed RNG seed.
    **Passing criteria:** zero registry validation errors; all fixtures produce the expected error codes; palette order is stable; archetype constraints hold for every node definition.

---

## Invariants

- Registry is the single source of truth for node behavior and UI metadata.
- Node `type` keys are **kebab‑case** and unique.
- Params are always clamped 1–8.
- Control ports are explicit; no implicit control channels.
- Grouped nodes must preserve internal topology and mappings.

---

## Edge cases / failure behavior

- Missing `onSignal` → fail registry validation.
- Duplicate `type` keys → fail registry validation.
- Invalid layout (ports don’t match archetype) → fail registry validation.
- Grouped node references invalid internal ports/params → fail build/validation (not registry).

---

## Open decisions (remaining)

- None in this module. (Archetype keys inferred from behavior table; param mapping lives in Audio Integration.)

---

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
- Validation / testing hooks
- Open decisions (explicit list)

---

## Technical implementation details

- **Registry export shape**: `NODE_REGISTRY` is an **array** of node definitions (canonical source of truth). Build a `type → definition` `Map` at load time; validation runs against the array to catch duplicate `type` keys.
- **UI metadata is required** for every node: `label`, `description`, `category`, `icon`, `color`, and `layout`. (Renderer depends on these to build the palette and node visuals.)
- **Node size is derived** from port counts and layout rules, not stored as an explicit size field. The UI computes size from `inputs`, `outputs`, `controlPorts`, and `layout`.
- **Archetype key names** are **inferred from the behavior table** (`moduleSpecs/node-behavior-table.md`) and must match its naming. Registry does not invent new archetype keys.
- **Param mapping lives in Audio Integration**. Registry only provides **param metadata** (e.g., target param name + mapping key), not concrete mapping tables.
- **Behavior function signature** uses a **context object** (not positional args) so new runtime fields can be added without breaking all nodes.
- **External contract (exports)**:
  - `NODE_REGISTRY: NodeDefinition[]` (canonical array, palette order).
  - `buildRegistryIndex(registry = NODE_REGISTRY): Map<string, NodeDefinition>` — **runs `validateRegistry()` internally** and throws on errors.
  - `getNodeDefinition(type: string, index = buildRegistryIndex()): NodeDefinition | undefined` — convenience helper (default index).
  - `buildPalette(registry = NODE_REGISTRY): PaletteItem[]` — derives UI‑only metadata in palette order.
  - `validateRegistry(registry: NodeDefinition[]): ValidationResult` — pure validation (no side effects), used by tests.
  - `ARCHETYPES` + `getLayout(layout: string, inputs: number, outputs: number, controlPorts: number): PortLayout`.
- **Type definitions (TS-ish, definitive)**:

```ts
type NodeDefinition = {
  // Identity + UI metadata (required)
  type: string; // kebab-case, unique
  label: string; // display name
  description: string; // tooltip text
  category: string; // palette grouping
  icon: string; // icon key/name
  color: string; // UI color token

  // Port/layout
  layout: string; // archetype key or "custom"
  inputs: number;
  outputs: number;
  controlPorts: number; // 0 if none

  // Params
  hasParam: boolean;
  defaultParam: number; // 1..8 (ignored if hasParam=false)
  paramMap?: Record<string, ParamMeta>; // metadata only (Audio Integration applies tables)

  // Behavior
  initState?: () => NodeState;
  onControl?: (ctx: BehaviorContext) => ControlResult | void;
  onSignal: (ctx: BehaviorContext) => SignalResult;

  // UI flags
  paletteOrder?: number;
  hidden?: boolean;
  deprecated?: boolean;
};

type ParamMeta = {
  target: string; // target param name in Audio Integration (e.g., "lpf")
  mapping: string; // mapping key (e.g., "lpfTable")
  unit?: string; // optional display unit
};

type BehaviorContext = {
  tick: number; // current tick
  inPortIndex: number; // which input fired (0-based)
  param: number; // current param (1..8)
  state: NodeState; // per-node state
  nodeId: string; // runtime node id
  rng: () => number; // deterministic per-node RNG (0..1)
  pulse: {
    value: number; // incoming value (1..8)
    speed: number; // incoming speed (1..8)
    params?: PulseParams; // optional effect params carried on the pulse
  };
};

type NodeState = Record<string, unknown>;

type ControlResult = {
  param?: number; // updated param (1..8, clamped by runtime)
  state?: NodeState; // updated state
};

type SignalResult = {
  outputs: OutputEvent[]; // emitted outputs
  state?: NodeState; // updated state
};

type OutputEvent = {
  value: number; // 1..8
  outPortIndex?: number; // required for multi-output nodes
  speed?: number; // if omitted, inherits input pulse speed
  params?: PulseParams; // if omitted, inherits input pulse params
};

type PulseParams = Record<string, number>; // e.g., { crush: 4, lpf: 6 }

type PaletteItem = {
  type: string;
  label: string;
  description: string;
  category: string;
  icon: string;
  color: string;
  layout: string;
  inputs: number;
  outputs: number;
  controlPorts: number;
  hasParam: boolean;
  hidden?: boolean;
  deprecated?: boolean;
  paletteOrder?: number;
};

type PortLayout = {
  inputs: PortSpec[]; // includes signal + control (role flagged per port)
  outputs: PortSpec[]; // signal outputs only
};

type PortSpec = {
  role: 'signal' | 'control';
  index: number; // 0-based slot order within its direction
  side: 'left' | 'right' | 'top' | 'bottom'; // placement edge for anchor derivation
};

type ValidationResult = {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

type ValidationIssue = {
  code: string; // stable error code
  message: string; // human-readable
  nodeType?: string; // registry node type (if applicable)
  field?: string; // field name (if applicable)
  severity: 'error' | 'warning';
};
```

**Registry validation error codes (locked, prefix `REG_`):**

- `REG_DUPLICATE_TYPE` — duplicate `type` keys in registry.
- `REG_INVALID_TYPE_FORMAT` — `type` not kebab‑case.
- `REG_MISSING_FIELD` — required field missing (`label`, `description`, `category`, `icon`, `color`, `layout`, etc.).
- `REG_INVALID_LAYOUT` — `layout` not found in `ARCHETYPES` and not `"custom"`.
- `REG_LAYOUT_PORT_MISMATCH` — `inputs/outputs/controlPorts` do not match archetype constraints.
- `REG_INVALID_PORT_COUNTS` — `inputs/outputs/controlPorts` are negative or non‑integers.
- `REG_CONTROL_PORTS_DISALLOWED` — `controlPorts > 0` on a layout that forbids control inputs.
- `REG_HAS_PARAM_DEFAULT_MISSING` — `hasParam=true` but `defaultParam` missing.
- `REG_DEFAULT_PARAM_OUT_OF_RANGE` — `defaultParam` not in 1..8.
- `REG_ONSIGNAL_MISSING` — missing `onSignal` behavior.
- `REG_PARAM_META_INVALID` — `paramMap` has malformed entries (missing `target`/`mapping`).

**Notes:**

- Build/Validate uses a separate prefix (e.g., `BUILD_`) for graph‑level errors; registry validation only reports **schema/definition** issues.
