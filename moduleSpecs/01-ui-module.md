# UI Module (Editor + Visual Thumbs)

## Purpose

Provide the interactive node‑and‑cable editor plus the visual pulse‑thumb layer. The UI renders the graph, collects user intent, and presents grouping/tempo controls. It does **not** perform runtime propagation or audio scheduling.

## Primary references

- `moduleSpecs/node-behavior-table.md` (node behavior semantics)
- `moduleSpecs/overview.md` (module boundaries)

## Responsibilities

- Render the grid workspace, nodes, ports, cables, selections, and thumbs.
- Manage pan/zoom camera and world→screen transforms.
- Node creation UI (`N` menu), drag, snap‑to‑grid, rotate.
- Cable creation with orth routing preview, manual corner placement, and cancellation.
- Selection (single + grouping multi‑select), highlight, deletion (Backspace), and node delete cascade for edges.
- Group creation UI (floating panel) and user group library integration.
- Tempo control UI (base rate input).
- Diagnostics console UI to surface build/validation errors and warnings.
- Sample slot panel to view/replace the 8 preloaded samples.
- Centralize editor styling (grid, ports, nodes, edges, thumbs, selection).

## Explicit non‑responsibilities

- No runtime pulse propagation (Runtime module does this).
- No audio scheduling (Audio Integration module does this).
- No graph validation beyond immediate UI constraints (Build/Validate handles rules).
- No graph‑language/DSL view in v1 (deferred to a later phase).

## Inputs

- **Graph snapshot**: nodes/edges with positions, rotations, manual corners, params (ports are derived).
- **Routed geometry** (from Routing+Delay): orth polyline + SVG path + total length per edge.
- **Node registry**: palette + port layout + icon/color/label/description metadata.
- **Runtime thumb state (optional)**: UI pulls via `runtime.getThumbState(nowTick)`; includes `edgeId` + `progress` + `speed`.
- **Sample slot assignments** (8 slots, loaded from project JSON or defaults).
- **UI config**: grid size, colors, corner smoothing, etc.

## Input data schemas (locked where known)

- **GraphSnapshot**: use the exact `GraphSnapshot` / `NodeRecord` / `EdgeRecord` shapes from `moduleSpecs/02-graph-model.md`.
- **RoutingResult**: use `RouteResult` + `RouteData` from `moduleSpecs/03-routing-delay.md`.
  - UI consumes `edgeRoutes: Map<edgeId, RouteData>` with `{ points, svgPathD, totalLength }`.
- **PaletteItem**: use the `PaletteItem` shape from `moduleSpecs/04-node-registry.md` (returned by `buildPalette()`).
- **Diagnostics**: use `ValidationIssue[]` from `moduleSpecs/05-graph-build-validation.md` (code, message, severity, nodeId/edgeId/field).
- **Runtime thumb state**: use `ThumbState` from `moduleSpecs/06-runtime.md`.
  - UI pulls via `runtime.getThumbState(nowTick)` and maps `progress` onto routed geometry.

## Outputs

- **User intents**: create/move/rotate/delete node, connect/disconnect cable, move/remove corner, group/ungroup.
- **Selection state** (if stored outside the graph model).
- **Tempo changes**: numeric base tempo value passed to Audio Integration / transport mapping.
- **Undo snapshots**: UI captures graph snapshots at the start/end of a user action.
- **Sample slot updates** (persisted to project JSON).
- **Runtime reset**: reset pulses without changing the graph.

## External contract (locked)

**Framework‑agnostic core** with a thin Next.js/React wrapper.

### Core factory (framework‑agnostic)
```ts
createEditor({
  registry,          // Node Registry API
  runtime,           // Runtime API (for getThumbState + reset)
  onOutput,          // (UIOutput) => void
  config?: UIConfig,
})
→ {
  mount(el: HTMLElement): void;
  unmount(): void;
  setSnapshot(snapshot: GraphSnapshot): void;
  setRoutes(routes: RouteResult): void;
  setDiagnostics(issues: ValidationIssue[]): void;
  setPalette(palette: PaletteItem[]): void;
  setSelection(selection: Selection): void;
}
```

### React/Next.js wrapper (client component)
```tsx
<Editor
  snapshot={GraphSnapshot}
  routes={RouteResult}
  diagnostics={ValidationIssue[]}
  palette={PaletteItem[]}
  selection={Selection}
  onOutput={(UIOutput) => void}
/>
```
Notes:
- Wrapper is **client‑only** (`"use client"` or `dynamic(..., { ssr:false })`).
- Wrapper calls the core factory in `useEffect`, mounts into a `div`.

## UIConfig schema + defaults (locked)

UI styling + interaction defaults live in one place and can be overridden at init.

```ts
type UIConfig = {
  grid: {
    GRID_PX: number;
    snap: boolean;
    subdivisions: number;
    worldBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  };
  node: {
    paddingPx: number;
    cornerRadiusPx: number;
    minSizePx: number;
    labelOffsetYPx: number;
    fill: string;
    stroke: string;
    text: string;
    iconSizePx: number;      // size of icon inside node face
    iconOffsetXPx: number;   // positive moves right
    iconOffsetYPx: number;   // positive moves down
  };
  port: {
    radiusPx: number;
    strokeWidthPx: number;
    hoverRadiusPx: number;
    signalIn: string;
    signalOut: string;
    control: string;
  };
  edge: {
    strokeWidthPx: number;
    hoverWidthPx: number;
    cornerRadiusPx: number;
    previewDash: string;
    mutedOpacity: number;
    stroke: string;
    previewStroke: string;
  };
  thumb: {
    radiusPx: number;
    strokeWidthPx: number;
    color: string;
    opacity: number;
  };
  selection: {
    strokeWidthPx: number;
    color: string;
    hoverColor: string;
    dash: string;
  };
  canvas: {
    background: string;
    gridLine: string;
    gridAccent: string;
    gridLineWidthPx: number;
    gridAccentEvery: number;
  };
  panel: {
    widthPx: number;
    bg: string;
    text: string;
    border: string;
    shadow: string;
  };
  text: {
    fontFamily: string;
    fontSizePx: number;
    fontWeight: number;
  };
  interaction: {
    dragThresholdPx: number;
    doubleClickMs: number;
    panSpeed: number;
    zoomStep: number;
    minZoom: number;
    maxZoom: number;
  };
  icons: {
    fallbackId: string; // used when icon id is missing
    library: Record<string, { viewBox: string; path: string }>;
  };
};
```

**Defaults:**
```ts
const DEFAULT_UI_CONFIG: UIConfig = {
  grid: { GRID_PX: 24, snap: true, subdivisions: 4, worldBounds: null },
  node: {
    paddingPx: 6, cornerRadiusPx: 6, minSizePx: 32, labelOffsetYPx: 14,
    fill: "#ffffff", stroke: "#2c2823", text: "#2c2823",
    iconSizePx: 16, iconOffsetXPx: 0, iconOffsetYPx: 0,
  },
  port: {
    radiusPx: 4, strokeWidthPx: 1, hoverRadiusPx: 8,
    signalIn: "#e45d5d", signalOut: "#f2c14e", control: "#4c8fd9",
  },
  edge: {
    strokeWidthPx: 2, hoverWidthPx: 10, cornerRadiusPx: 8,
    previewDash: "4 3", mutedOpacity: 0.35,
    stroke: "#2c2823", previewStroke: "#7d766c",
  },
  thumb: { radiusPx: 4, strokeWidthPx: 1, color: "#2c2823", opacity: 0.9 },
  selection: { strokeWidthPx: 2, color: "#1f6a7a", hoverColor: "#2f8a96", dash: "4 2" },
  canvas: {
    background: "#f7f4ef", gridLine: "#e6e1d9", gridAccent: "#d7d1c7",
    gridLineWidthPx: 1, gridAccentEvery: 4,
  },
  panel: { widthPx: 280, bg: "#fbfaf8", text: "#2c2823", border: "#d7d1c7", shadow: "rgba(0,0,0,0.08)" },
  text: { fontFamily: "Space Grotesk, system-ui, sans-serif", fontSizePx: 12, fontWeight: 500 },
  interaction: { dragThresholdPx: 3, doubleClickMs: 250, panSpeed: 1, zoomStep: 0.1, minZoom: 0.5, maxZoom: 3 },
  icons: {
    fallbackId: "default",
    library: {
      default: { viewBox: "0 0 24 24", path: "M5 5h14v14H5z" },
      unknown: { viewBox: "0 0 24 24", path: "M12 5a5 5 0 0 1 5 5c0 3-3 3-3 6m-2 3h0" },
      pulse: { viewBox: "0 0 24 24", path: "M3 12h4l2-5 4 10 2-5h6" },
      output: { viewBox: "0 0 24 24", path: "M5 12h10m0 0-4-4m4 4-4 4" },
      group: { viewBox: "0 0 24 24", path: "M4 6h7v7H4zM13 11h7v7h-7z" },
      multiplexer: { viewBox: "0 0 24 24", path: "M5 6h4v4h6v4h4v4h-4v-4H9V6H5z" },
      demultiplexer: { viewBox: "0 0 24 24", path: "M19 6h-4v4H9v4H5v4h4v-4h6V6h4z" },
      add: { viewBox: "0 0 24 24", path: "M11 5h2v14h-2zM5 11h14v2H5z" },
      sub: { viewBox: "0 0 24 24", path: "M5 11h14v2H5z" },
      set: { viewBox: "0 0 24 24", path: "M5 5h14v14H5zM11 11h2v2h-2z" },
      const1: { viewBox: "0 0 24 24", path: "M11 11h2v2h-2z" },
      const2: { viewBox: "0 0 24 24", path: "M9 11h2v2H9zM13 11h2v2h-2z" },
      const3: { viewBox: "0 0 24 24", path: "M7 11h2v2H7zM11 11h2v2h-2zM15 11h2v2h-2z" },
      const4: { viewBox: "0 0 24 24", path: "M8 10h2v2H8zM14 10h2v2h-2zM8 14h2v2H8zM14 14h2v2h-2z" },
      const5: { viewBox: "0 0 24 24", path: "M7 10h2v2H7zM11 10h2v2h-2zM15 10h2v2h-2zM9 14h2v2H9zM13 14h2v2h-2z" },
      const6: { viewBox: "0 0 24 24", path: "M7 10h2v2H7zM11 10h2v2h-2zM15 10h2v2h-2zM7 14h2v2H7zM11 14h2v2h-2zM15 14h2v2h-2z" },
      const7: { viewBox: "0 0 24 24", path: "M6 9h2v2H6zM10 9h2v2h-2zM14 9h2v2h-2zM18 9h2v2h-2zM8 13h2v2H8zM12 13h2v2h-2zM16 13h2v2h-2z" },
      const8: { viewBox: "0 0 24 24", path: "M6 9h2v2H6zM10 9h2v2h-2zM14 9h2v2h-2zM18 9h2v2h-2zM6 13h2v2H6zM10 13h2v2h-2zM14 13h2v2h-2zM18 13h2v2h-2z" },
      speed: { viewBox: "0 0 24 24", path: "M6 6l6 6-6 6V6zm6 0l6 6-6 6V6z" },
      decay: { viewBox: "0 0 24 24", path: "M5 6h2v12h12v2H5z" },
      crush: { viewBox: "0 0 24 24", path: "M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z" },
      hpf: { viewBox: "0 0 24 24", path: "M4 14h6l2-4 2 4h6v2H4z" },
      lpf: { viewBox: "0 0 24 24", path: "M4 10h6l2 4 2-4h6v2H4z" },
      switch: { viewBox: "0 0 24 24", path: "M4 7h16v10H4zM10 7v10" },
      block: { viewBox: "0 0 24 24", path: "M5 5h14v14H5zM7 7l10 10M17 7L7 17" },
      every: { viewBox: "0 0 24 24", path: "M5 6h14v2H5zM5 11h14v2H5zM5 16h14v2H5z" },
      random: { viewBox: "0 0 24 24", path: "M6 6h12v12H6zM9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" },
      counter: { viewBox: "0 0 24 24", path: "M6 6h4v12H6zM14 6h4v12h-4z" },
      gtp: { viewBox: "0 0 24 24", path: "M8 6l8 6-8 6v-3l4-3-4-3V6z" },
      ltp: { viewBox: "0 0 24 24", path: "M16 6l-8 6 8 6v-3l-4-3 4-3V6z" },
      gtep: { viewBox: "0 0 24 24", path: "M7 6h2v12H7zM10 6l8 6-8 6v-3l4-3-4-3V6z" },
      ltep: { viewBox: "0 0 24 24", path: "M15 6h2v12h-2zM14 6l-8 6 8 6v-3l-4-3 4-3V6z" },
      match: { viewBox: "0 0 24 24", path: "M6 9h12v2H6zM6 13h12v2H6z" },
    },
  },
};
```

**Icon resolution (locked):**
- UI resolves icon ids from `PaletteItem.icon` (Node Registry).
- If an id is missing in `icons.library`, use `icons.fallbackId`.
- `icons.library` should include **all node types** from `moduleSpecs/node-behavior-table.md` to avoid fallback spam.
- Icon size and placement are controlled by `node.iconSizePx` and `node.iconOffset*`. To make icons fill the entire face, set `iconSizePx` to the node’s rendered size and offsets to 0.

## Output intent schema (locked)

Graph edits **must** use the Graph Model op envelope (`{ type, payload }`) from `moduleSpecs/02-graph-model.md`. Non‑graph actions use explicit UI intents.

```ts
// Graph edits (from Graph Model)
type GraphOp = { type: string; payload: unknown };

// UI output envelope
type UIOutput =
  | { type: 'graph/ops'; payload: { ops: GraphOp[]; reason?: string } }
  | { type: 'audio/updateTempo'; payload: { bpm: number } }
  | { type: 'audio/updateSlots'; payload: { slots: Slot[] } }
  | { type: 'runtime/resetPulses' }
  | { type: 'ui/selectionChanged'; payload: SelectionState }
  | { type: 'ui/undoSnapshot'; payload: { snapshot: GraphSnapshot; reason: string } };
```

### Action → op mapping (locked)
- **Create node** → `graph/ops` with `addNode` (NodeRecord).
- **Move node** → `graph/ops` with `moveNode`.
- **Rotate node** → `graph/ops` with `rotateNode`.
- **Delete node** → `graph/ops` with **all connected** `removeEdge` ops first, then `removeNode`.
- **Rename node** → `graph/ops` with `renameNode`.
- **Set param** → `graph/ops` with `setParam` (sets `params.param`).
- **Create edge** → `graph/ops` with `addEdge` (EdgeRecord).
- **Delete edge** → `graph/ops` with `removeEdge`.
- **Add corner** → `graph/ops` with `addCorner`.
- **Move corner** → `graph/ops` with `moveCorner`.
- **Remove corner** → `graph/ops` with `removeCorner`.
- **Create group** → `graph/ops` with the composed op bundle defined below.
- **Remove group** → `graph/ops` with `removeGroup` **only if** no node instances reference that `groupRef` (UI blocks removal otherwise).
- **Tempo change** → `audio/updateTempo` with `{ bpm }` (Audio Integration transport).
- **Sample slot update** → `audio/updateSlots` with `{ slots }`.
- **Reset pulses** → `runtime/resetPulses` (no graph ops, no undo snapshot).

### Group creation op bundle (locked)

1. **Build `GroupDefinition`** (see `moduleSpecs/04-node-registry.md` / `moduleSpecs/08-serialisation.md`):
   - `graph` is the **selected subgraph only** (selected nodes + internal edges between them).
   - External edges are **excluded** from the group’s internal graph.
   - `inputs[]`, `outputs[]`, `controls[]` are ordered **exactly** as the user’s mapping list; this order defines group port slots.
2. **Create a group node instance** (NodeRecord):
   - `type: "group"`, `groupRef: groupId`, `pos` at selection bbox center (snap to grid), `rot: 0`, `params: {}`.
3. **Emit ops in this order**:
   - `addGroup({ group })`
   - `addNode({ node: groupNode })`
   - `removeEdge` for **all edges touching selected nodes** (internal + external)
   - `removeNode` for each selected node
   - `addEdge` for **rewired external connections**, using group port slots:
     - External → selected **signal input** ⇒ connect external to group **signal input** slot (index in `inputs[]`).
     - Selected **signal output** → external ⇒ connect group **signal output** slot (index in `outputs[]`) to external.
     - External → selected **control input** ⇒ connect external to group **control input** slot (index in `controls[]`, appended after signal inputs per registry rule).

Notes:
- This matches the **composed‑ops** requirement in `moduleSpecs/02-graph-model.md`.
- Group port ordering uses the **custom layout rules** from `moduleSpecs/04-node-registry.md`.

---

## Rendering architecture

**SVG renderer** for the editor viewport. HTML is used only for chrome/overlays (palette, toolbar, modals). This keeps hit‑testing, zoom/pan, and path animation consistent.

**Fixed layer stack (bottom → top)**:

1. Grid (pointer events disabled)
2. Edge hit paths (invisible; used only where explicit edge hit is desired)
3. Edge paths (rendered cables, including live preview)
4. Edge handles (manual corner handles + hover affordances)
5. Node bodies
6. Node labels/icons
7. Ports (circles)
8. Selection/hover overlays (style‑only)
9. Pulse thumbs (always visible above edges/nodes)
10. Transient affordances (drag ghost, lasso if added)

Selection/hover uses CSS classes, **not** DOM reordering.

## Node sizing + port placement (locked)
- UI derives **PortLayout** from registry `getLayout()`; each `PortSpec` includes `side` and `index`.
- **Node size** is square and derived from port density:
  - Let `counts = { left, right, top, bottom }` from PortLayout.
  - `portsOnSide = max(counts)`; **side length (grid units) = portsOnSide + 1**.
- **Port placement** uses grid‑intersection anchors:
  - Left side ports: `(x=0, y=1..N)` top→bottom.
  - Right side ports: `(x=L, y=1..N)` top→bottom.
  - Top side ports: `(x=1..N, y=0)` left→right.
  - Bottom side ports: `(x=1..N, y=L)` left→right.
  - `N` is the number of ports on that side; `L` is the node side length.
- **Rotation** rotates anchors visually in 90° steps; **slot order is unchanged**.

## Coordinate transforms

- **Camera model**: `{x, y, scale}` (translate + scale only).
- **World space**: grid units (1 unit = 1 grid square).
- **Screen space**: pixels.
- **Transform**: `screen = (world * scale * GRID_PX) + translate`.
- **Pan/zoom**: cursor‑centered zoom; pan is bounded to world limits.

## Interaction state machine

States and transitions:

- **Idle**: default.
- **Drag node**: click‑drag a node; snap to grid on drag end.
- **Create edge**: click‑drag from a port; live preview; right‑click cancels.
- **Drag corner**: click‑drag a manual corner handle.
- **Rotate node**: `R` key or two‑finger click on a node.
- **Group selection**: shift‑click or box‑drag to build selection for grouping.
- **Group config open**: floating panel open; editor remains interactive.

Focus rules:

- If an input field is focused, editor shortcuts are suppressed.

## Hit testing & targeting

Priority is **ports > edges > nodes**. This makes cable creation reliable.

- **Edges** are selectable only on direct stroke hit (no expanded hit buffer).
- **Corners** are distinct hit targets and take priority over the edge path.

## Selection model

- **Single‑select** for normal editing.
- **Multi‑select** is allowed for grouping only (shift‑click + box‑drag).
- Clicking empty space clears selection.
- **No multi‑drag** and **no multi‑delete** in v1. If multiple items are selected, delete is ignored until a single item is selected.

## Selection + interaction state (locked)
**Selection (single‑select):**
```ts
type Selection =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'corner'; edgeId: string; cornerIndex: number };
```

**Group selection (multi‑select for grouping only):**
```ts
type GroupSelection = {
  nodeIds: string[]; // ordered by selection time
};
```

**Hover:**
```ts
type Hover =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string }
  | { kind: 'port'; nodeId: string; portSlot: number; direction: 'in' | 'out' }
  | { kind: 'edge'; edgeId: string }
  | { kind: 'corner'; edgeId: string; cornerIndex: number };
```

**Drag state:**
```ts
type DragState =
  | { kind: 'none' }
  | { kind: 'node'; nodeId: string; startPos: {x:number;y:number}; currentPos: {x:number;y:number} }
  | { kind: 'edge-create'; from: { nodeId: string; portSlot: number; direction: 'out' }; cursor: {x:number;y:number}; tempCorners: {x:number;y:number}[] }
  | { kind: 'corner'; edgeId: string; cornerIndex: number; startPoint: {x:number;y:number}; currentPoint: {x:number;y:number} };
```

## Node creation + palette

- Primary flow: press **`N`** → popup menu at cursor.
- Optional **right‑side collapsible panel** with tabs:
  - **Palette** (built‑in nodes)
  - **Console** (validation errors/warnings)
  - **Groups** (user‑defined group nodes)
  - **Samples** (8 sample slots, replaceable by the user)
- The `N` menu includes both built‑in nodes and user groups for fast access.

## Node dragging

- Smooth drag; **snap to grid on drag end**.
- Edges reroute in preview mode during drag (see Performance).
- Multi‑drag is not required for v1.

## Rotation UI

- **`R`** rotates the selected node (90° per press).
- **Two‑finger click / trackpad right‑click** on a node also rotates it.

## Cable creation + corner editing

- **Click‑drag from a port**; release on a valid target port to connect.
- Live orth routing preview while dragging.
- **Manual corners can be added during creation** (click to add a corner before final release).
- **Right‑click cancels** edge creation.
- After creation:
  - Corners can be **dragged**.
  - Corners can be **removed** (select corner → Backspace).
  - **No adding corners after creation** (recreate edge if needed).

## Grouped node UI

**Create**: multi‑select nodes and press **G**.

**Config panel (floating, non‑modal)**:

- Shows **selected nodes list**.
- Shows a **connection view** (tree‑style/nested list) of the selected subgraph.
- **Signal inputs**: add one‑by‑one via dropdown from **unconnected internal inputs**.
- **Signal outputs**: add one‑by‑one via dropdown from **unconnected internal outputs**.
- **Control inputs**: add one‑by‑one via dropdown from **unconnected internal control params**.

**Rules**:

- All internal edges between selected nodes are automatically included.
- Selected nodes with no internal connections are **ignored** (not grouped).
- A single internal param **cannot** map to multiple group controls (use a multiplexer if needed).
- Unmapped internal params keep their default values.
- Group node **size scales** with the number of exposed ports.
- **Port colors**: control inputs = blue, signal inputs = red, signal outputs = yellow.
- On **OK**, save the group immediately to the user library.

## Undo snapshot policy

Capture **one undo step per user action**:

- Drag start/end
- Edge create (begin/end)
- Corner move
- Group creation
- Delete (single item)

## Pulse thumbs (visualization)

- Thumbs are **runtime‑driven**; UI does not decide routing.
- Render thumbs on edges using routed geometry + runtime pulse state (`edgeId`, `progress`, `speed`).
- **Animation loop**: `requestAnimationFrame` with elapsed time (`deltaMs`) for smooth, frame‑rate‑independent motion.

## Tempo control

- **Float input only**.
- Default value **10**, min **0**, max **100**.
- Placed in minimal editor chrome (e.g., a small top bar).
- **Tempo value is BPM**; changes emit a tempo update to Audio Integration / transport mapping.

## Reset pulses control
- Add a **Reset Pulses** button next to the tempo control.
- On click, emit a **runtime reset intent** (not a graph edit).
- No changes to graph topology, params, or geometry; only in‑flight pulses are cleared and re‑seeded.
- **Integration:** call `runtime.resetPulses()` directly; do **not** emit graph ops or create an undo snapshot.

## Keyboard/mouse shortcuts

- `N`: create node (popup menu).
- `G`: group selected nodes.
- `R`: rotate selected node.
- `Backspace`: delete selected item (only if a single item is selected).
- Right‑click: cancel edge creation.
- Shift‑click + box‑drag: multi‑select for grouping.

## Cursor feedback

Contextual cursors:

- Port hover: `crosshair`
- Node hover: `grab`, dragging: `grabbing`
- Edge hover: `pointer`
- Corner hover: `move`
- Canvas default: `default`, panning: `grabbing`

## Performance considerations

**Hybrid routing strategy** during drag:

- Use cheap preview route (stubs + simple L‑shape) while dragging.
- Full routing recompute on drag end.
- Implement routing preview via a small strategy interface so it can be swapped later.

## Performance constraints (locked)
- **Target FPS:** aim for 60fps; degrade gracefully if frame time exceeds 16ms.
- **No hard caps** on node/edge counts; use adaptive throttling instead.
- **Adaptive throttling during drag:**
  - If frame time > 16ms, throttle preview routing to ~30fps.
  - If frame time > 33ms, throttle preview routing to ~15fps.
- **Responsiveness priority:** keep interactions responsive even if routing falls behind; complete full routing on drag end.

## Accessibility

- Canvas is focusable (`tabindex=0`).
- Core shortcuts only in v1.
- Basic ARIA labels for nodes/ports/palette.
- Full keyboard navigation deferred.

## Invariants (locked)

- UI never emits `graph/ops` with invalid `portSlot` or direction; all port references are validated against the current snapshot + registry layout.
- UI never emits ops that create more than one edge per port (enforces single‑cable rule before emission).
- Selection state never references missing IDs; if a selected item is deleted, selection is cleared.
- Group removal is blocked if any node instance still references the `groupRef`.

## Edge cases / failure behavior (locked)

- **Missing route for an edge**: render a straight fallback line between the two port anchors (dashed + muted). Do not block editing.
- **Missing palette entry**: render a neutral fallback node (gray box, label = node type, icon “?”).
- **Stale diagnostics**: keep the entry but mark it “stale”; clicking has no effect if target is missing.
- **Thumb state references missing edge**: ignore/drop that thumb entry.

---

## Spec checklist

- External contract (inputs/outputs, data types)
- Invariants (must always be true)
- Edge cases / failure behavior
  -- Validation / testing hooks

## Testing strategy (locked)

Goal: verify **all UI functionality** with a mix of unit, component, and end‑to‑end tests.

**1) Unit tests (logic, no DOM)**
- Selection/drag state transitions.
- Action → op mapping (including group bundle ordering + rewiring).
- Port hit‑testing math and snap‑to‑grid rules.
- Thumb positioning along polyline (progress → point).
**Fixtures:** small GraphSnapshot + RouteResult JSON.

**2) Component tests (DOM + interaction)**
- Render editor shell with a minimal snapshot + palette.
- Simulate: node drag, edge creation, corner move, rotate, delete.
- Verify `onOutput` payloads (graph/ops, tempo updates, reset pulses).
- Validate fallback rendering (missing palette entry, missing route).
**Approach:** lightweight DOM harness + synthetic events; assert emitted intents.

**3) End‑to‑end tests (full UI)**
- Run the Next.js wrapper in a test app.
- Use **Playwright** for browser automation and parallel E2E runs:
  - Create node, connect, move corner, group, delete, undo snapshot capture.
  - Verify diagnostics console behavior (stale entries).
  - Validate sample slot changes emit `audio/updateSlots`.
  - Verify reset pulses calls runtime (mocked API).
**Assertions:** emitted UIOutput events + rendered DOM state.

**Test hooks / IDs**
- Add `data-testid` for nodes, ports, edges, corners, palette items, tempo input, reset button.
- Expose deterministic IDs for created nodes/edges in test mode.

## Implementation file layout (recommended)

- `packages/ui/editor/createEditor.js` — core factory, wiring, public API.
- `packages/ui/editor/state.js` — selection/drag/hover state reducers.
- `packages/ui/editor/ops.js` — action → GraphOp mapping, group bundle builder.
- `packages/ui/editor/hittest.js` — port/edge/corner hit‑testing.
- `packages/ui/editor/geometry.js` — grid snap, anchor math, thumb position along polyline.
- `packages/ui/render/svg-layer.js` — SVG rendering of nodes/edges/ports/thumbs.
- `packages/ui/render/panzoom.js` — camera transforms + input handling.
- `packages/ui/panels/palette.js` — palette UI.
- `packages/ui/panels/diagnostics.js` — diagnostics console.
- `packages/ui/panels/samples.js` — sample slots panel.
- `packages/ui/config/defaults.js` — `DEFAULT_UI_CONFIG`.
- `packages/ui/icons/library.js` — SVG icon map.
- `packages/ui/react/Editor.jsx` — Next.js client wrapper.
## Diagnostics console

- Non‑modal console tab in the right‑side panel.
- Lists **build/validation errors and warnings** with affected node/edge IDs.
- Clicking an entry selects the referenced item and pans the camera to it (if possible).
- Errors do not stop rendering; runtime continues using last valid compiled graph.

## Sample slots (UI panel)

- Right‑side **Samples** tab shows 8 slots (1–8).
- Users can replace each slot with a local sample file.
- Slot assignments are persisted in project JSON and restored on load.
- Future‑proof: schema should allow remote URLs later (not implemented now).
