# Graph DSL

## Status

This document is the canonical module spec for the current graph DSL surface.

- JSON remains the canonical persisted project format.
- The DSL is a canonical secondary textual representation over snapshot storage and the first-class text authoring surface for groups.
- The DSL does not replace `group.graph`, node ids, positions, rotations, or manual corners.
- This document supersedes the older deferred Hydra-style DSL exploration that previously occupied `09-DSL.md`.

## Grounding In The Current Internals

The current application already stores enough information to derive a readable textual view of a group.

Each group definition currently stores:

- `id`
- `name`
- `preserveInternalCableDelays`
- `graph.nodes`
- `graph.edges`
- `inputs`
- `outputs`
- `controls`

Each internal node currently stores:

- `id`
- `type`
- `pos`
- `rot`
- `params`
- optional `name`
- optional `groupRef`

Each internal edge currently stores:

- `id`
- `from.nodeId`
- `from.portSlot`
- `to.nodeId`
- `to.portSlot`
- `manualCorners`

Each group boundary mapping currently stores:

- `inputs[]`: `{ label?, nodeId, portSlot }`
- `outputs[]`: `{ label?, nodeId, portSlot }`
- `controls[]`: canonical target shape `{ label?, nodeId, controlSlot }`

Canonical meaning of `controlSlot`:

- for an ordinary internal node, `controlSlot` selects the node's real control input index
- for an internal child `group` node, `controlSlot` selects the child group's exposed control input index

Canonical long-term goal:

- importer/exporter should target `controlSlot` uniformly for all group control mappings
- `paramKey` should remain load-compatible only as a migration path from older snapshots

Legacy note:

- some current implementation paths still accept `{ paramKey }` as a direct-param mapping form
- that legacy shape should be treated as migration-only, not as the canonical long-term model

Important consequences of the current model:

- Ports are derived, not stored.
- Group node input ports are currently derived in this order:
  - all exposed signal inputs from `inputs[]`
  - then all exposed control inputs from `controls[]`
- Group node output ports are currently derived in `outputs[]` order.
- Group boundary mappings are not internal placeholder nodes.
- Group boundary mappings are not internal edges.
- Internal cable distance is not stored as a first-class field.
- Internal edge delay is derived from routing.
- `preserveInternalCableDelays` may collapse internal runtime delay even when physical cable length is nonzero.
- One cable per real port is enforced.
- Cycles are allowed.
- Nested groups are real internal `group` nodes that carry `groupRef`.

## Design Intent

The DSL should describe:

- the internal node graph
- the exposed interface of the current group
- optional derived cable distances

The DSL should not become responsible for:

- stable node ids
- exact node positions
- node rotations
- manual corner polylines
- the canonical stored group library structure

Those remain in the JSON snapshot.

## Canonical Surface Rules

### 1. Bindings

Bindings name real internal nodes or readable intermediate expressions.

```txt
a = pulse(3)
b = a.every(2)
```

Rules:

- A binding introduces one internal node chain or one named intermediate.
- Export should prefer `node.name` when it is usable.
- Otherwise export should synthesize deterministic locals such as `a`, `b`, `c`, ...
- Bindings are mutually visible within the group body so simple feedback cycles can be written without duplicating node declarations.

### 2. Comments Use `//`

The canonical DSL should allow simple line comments.

Example:

```txt
// $0 = trigger
// $1 = amount

$0.every($1).outlet(0) // expose the final signal
```

Canonical meaning:

- `//` starts a comment that runs to the end of the current line.
- Blank lines are allowed.
- Comments may appear on their own line or after a statement.
- Comments do not change graph meaning.

Canonical use:

- Comments may document stored interface labels for readability.
- Comments may document routing or intent.
- Comments do not create symbols in the DSL surface.

### 3. Boundary Inlets Use `$n`

The current group being viewed exposes its external inputs through `$0`, `$1`, `$2`, ...

Examples:

```txt
$0.every(2).outlet(0)
```

```txt
pulse(3).every{$0}.out()
```

Canonical meaning:

- `$n` denotes external inlet slot `n` on the current grouped node.
- Indexing is 0-based.
- `$n` is a boundary placeholder, not a real internal node.
- `$n` may only appear in source positions.

Link to current internals:

- The current model stores signal inputs in `inputs[]` and control inputs in `controls[]`.
- The current grouped-node port layout derives the actual outside input slots as:
  - `inputs[0..]`
  - then `controls[0..]`
- Therefore `$n` maps to the real outside port numbering that already exists today.
- If a group has no exposed signal inputs, then the first exposed control input is `$0`.
- If a group has two exposed signal inputs and one exposed control input, then:
  - `$0` = first signal input
  - `$1` = second signal input
  - `$2` = first control input

Stored mapping labels are not canonical DSL syntax.
They remain UI metadata only.

### 4. Boundary Outlets Use `.outlet(n)`

The current group exposes outputs explicitly through a terminal outlet mapping.

Examples:

```txt
$0.every(2).outlet(0)
```

```txt
merge.outlet(1)
```

Canonical meaning:

- `expr.outlet(n)` maps the signal output of `expr` to external output slot `n`.
- Indexing is 0-based.
- `.outlet(n)` is a boundary mapping form, not a real internal node.
- `.outlet(n)` is terminal syntax.

Link to current internals:

- `.outlet(n)` maps directly to `group.outputs[n]`.
- The current model stores outputs explicitly and in order.
- Because outputs are explicit mappings in the current JSON, loose-end inference is not canonical.

Canonical rule:

- The DSL must use explicit `.outlet(n)`.
- The DSL must not automatically expose every loose internal signal end.

### 5. Real Internal Sinks Still Use `.out()`

The application already has a real internal sink node type: `out`.

Example:

```txt
pulse(3).every{$0}.out()
```

Canonical meaning:

- `.out()` creates or references a real internal `out` node.

Link to current internals:

- `.out()` corresponds to a real node record with `type: "out"` inside `group.graph.nodes`.
- This is different from `.outlet(n)`, which maps to `group.outputs[n]`.

### 6. Distances Use Source-Postfix `<n>`

Distance annotations remain optional and derived.

Example:

```txt
pulse(3)<3>.every(2)<12>.out()
```

Canonical meaning:

- `<n>` annotates the real internal edge leaving the expression immediately to its left.
- `<n>` is edge metadata, not node metadata.
- Source-postfix is canonical.

Link to current internals:

- Real internal edge endpoints are stored in `graph.edges`.
- Physical cable length is not stored directly.
- The current routing layer derives edge length from the routed polyline.
- `preserveInternalCableDelays` may later collapse the runtime delay even when the physical length is nonzero.

Canonical restrictions:

- `<n>` is only valid for real internal edges.
- `<n>` is not valid on `$n`, because group boundary inputs are mappings, not internal edges.
- `<n>` is not valid before `.outlet(n)`, because group boundary outputs are mappings, not internal edges.

### 7. Chains Still Mean Main-Signal Flow

For ordinary single-stream nodes, the chain remains the preferred readable form.

Example:

```txt
$0.every{$1}.counter(4).outlet(0)
```

Canonical meaning:

- The chain expresses the main signal path.
- Stored node params are expressed by a `(n)` param clause.
- Braced control clauses are the canonical surface form for live non-main input edges on the current node call.
- In the current built-in visible node set, that means live control input expressions.
- The canonical surface does not use standalone control-target syntax.

Link to current internals:

- For built-in single-io-control nodes, the current port model already treats:
  - input slot `0` as the signal input
  - the following input slot as the control input
- The chain/argument split maps directly to that existing signal-vs-control distinction.

### 8. Explicit Wire Statements Use The Period

When a graph does not read cleanly as a single chain, the DSL may use standalone wire statements.

Examples:

```txt
a.merge[0]
```

```txt
a<4>.merge[0]
```

Canonical meaning:

- A standalone wire statement connects a signal `source` to a signal `target`.
- The period is the canonical explicit-edge spelling.
- If `<n>` is present, it annotates that edge.

Canonical target forms:

- `name`
- `name[index]`

Here:

- bare `name` means the primary signal input of a node that has a single signal input
- `name[index]` is used when the target signal port must be chosen explicitly

Link to current internals:

- Each standalone wire statement corresponds to one real edge record in `group.graph.edges`.
- `from.portSlot` and `to.portSlot` stay 0-based.
- This surface form exists because the stored graph is edge-based even when the readable projection is chain-first.
- Explicit wire statements do not target control ports in the canonical DSL.

### 9. Indexed Ports Are 0-Based

Indexed signal ports use 0-based numbering everywhere.

Examples:

```txt
m[0]
merge[1]
sw[3]
```

Canonical meaning:

- In source position, `name[index]` selects signal output slot `index`.
- In target position, `name[index]` selects signal input slot `index`.

Link to current internals:

- This matches the current `portSlot` numbering in snapshots.
- This matches the current build/runtime behavior table conventions.
- No renumbering layer is needed.

### 10. Stored Params Use `(n)`

Stored node params use a param clause.

Examples:

```txt
$0.every(2).outlet(0)
```

```txt
$0.every(3){$1}.outlet(0)
```

```txt
sw = $0.switch(2){$1}
```

Canonical meaning:

- `(n)` stores the node's initial param value in the group snapshot.
- `(n)` is not a live control edge.
- If `(n)` is omitted, the importer/exporter should use the node type's default stored param value.
- Nodes with no stored param do not use a param clause.

Link to current internals:

- `(n)` lowers to `node.params.param = n` in the current node records.
- When `(n)` is omitted, the importer should use the node type's `defaultParam`.
- This preserves the distinction between an initial stored param and later live control events.

Canonical note:

- `(n)` exists because current nodes may have both a stored default param and a live control edge.
- `every(3){$0}` therefore means:
  - store initial `param = 3`
  - and also connect `$0` as the live control source

### 11. Control Inputs Use Arguments

Control connections are expressed as braced control clauses, not as standalone target syntax.

Examples:

```txt
$0.every(3){$1}.outlet(0)
```

```txt
a = every(3){b<6>}
$0.a
```

Canonical meaning:

- The braced control clause is the canonical place to express control edges.
- A control source may carry its own distance annotation before entering that control position.
- Standalone wire statements connect only main-signal ports.
- Bare numeric literals are not control edges in the canonical surface.
- The canonical DSL does not use `.control` or `.control[index]`.

Link to current internals:

- The current built-in visible node set exposes at most one control input per node.
- Canonical group control mappings target ordered `controlSlot` indices rather than special direct-param keys.
- For ordinary nodes, those `controlSlot` indices map to the node's real control inputs.
- For child groups, those `controlSlot` indices map to the child group's exposed control inputs.
- Nested child-group control forwarding remains an internal implementation detail in the canonical expanded view.

Canonical note:

- If a future visible node type exposes more than one control input, the DSL will need an ordered-brace rule for those additional control positions.

### 12. Recursive Bindings Are Canonical For Simple Cycles

Simple cycles should not require declaring the same node twice.

Example:

```txt
a = $0.every(3){b<6>}
b = a<4>.counter(4)
b.outlet(0)
```

Canonical meaning:

- The group body is resolved as a mutually visible binding set.
- A binding may refer to a later binding.
- This allows simple feedback loops while still declaring each node once.

Link to current internals:

- The current graph model already allows cycles.
- The runtime already supports cycles via minimum effective delay.
- The exporter/compiler can therefore resolve bindings first and emit cyclic edges afterward.

### 13. Explicit Wires Remain The Fallback For Hard Graphs

Some shapes still read better with named nodes and standalone wires.

Example:

```txt
m = mux()
d = demux()

$0.m
m[0]<4>.d[0]
m[1]<7>.d[1]
d.outlet(0)
```

Use this form for:

- awkward multi-port layouts
- larger strongly connected components
- cases where nested chain syntax becomes misleading

## Current Implemented Node Families

The current built-in node set already falls into a small number of DSL shape families.

| Family                    | Node types                                                                                                                                                   | Canonical DSL shape                                                                        | Notes                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Single-stream chain nodes | `pulse`, `add`, `sub`, `set`, `speed`, `pitch`, `decay`, `crush`, `hpf`, `lpf`, `block`, `every`, `random`, `counter`, `gtp`, `ltp`, `gtep`, `ltep`, `match` | `source.node(param){control}` or `name = node(param){control}` plus a separate signal wire | Param clause optional. Control clause optional. The current built-ins expose at most one live control clause. |
| Sink                      | `out`                                                                                                                                                        | `expr.out()`                                                                               | Real internal sink node. `output` remains an internal alias, not the canonical DSL spelling.                  |
| Multi-output routing      | `mux`, `switch`                                                                                                                                              | `name = source.mux()` or `name = source.switch(param){control}` then `name[index]`         | Indexed outputs are 0-based.                                                                                  |
| Multi-input routing       | `demux`                                                                                                                                                      | `name = demux()` then `source.name[index]`                                                 | Indexed inputs are 0-based.                                                                                   |
| Nested group body         | `group`                                                                                                                                                      | inline-expanded into ordinary visible nodes                                                | Raw `groupRef` is not surfaced canonically.                                                                   |

## Canonical Multi-Port Node Behavior

The following nodes require first-class indexed-port handling in the DSL:

- `mux`
- `demux`
- `switch`
- any future real node type that exposes multiple signal or control ports

### `mux`

Canonical core representation:

```txt
m = $0.mux()
a = m[0].every(2)
b = m[1].counter(4)
```

Link to current internals:

- `mux` is a real node with one signal input and six signal outputs.
- Output indexing maps directly to the stored output `portSlot`.

### `demux`

Canonical core representation:

```txt
merge = demux()
a<4>.merge[0]
b<7>.merge[1]
merge.outlet(0)
```

Link to current internals:

- `demux` is a real node with six signal inputs and one signal output.
- Target indexing maps directly to the stored input `portSlot`.

Canonical note:

- `demux(a, b)` is not part of the canonical surface.

### `switch`

Canonical core representation:

```txt
sw = $0.switch(2){$1}
sw[0].outlet(0)
sw[3].outlet(1)
```

Link to current internals:

- `switch` is a real node with:
  - one signal input
  - one control input
  - six signal outputs
- `$0` feeds the signal input when it is the first exposed inlet.
- `$1` feeds the control input when the current group also exposes one signal inlet before its first control inlet.
- `(2)` stores the initial selection param until later live control pulses arrive.

## Multi-Port Index Tables

The DSL index order for the current multi-port nodes is fixed and 0-based.

| Index | `mux` / `switch` signal output | `demux` signal input |
| ----- | ------------------------------ | -------------------- |
| `0`   | top-left                       | top-right            |
| `1`   | top-right                      | top-left             |
| `2`   | right-top                      | left-top             |
| `3`   | right-bottom                   | left-bottom          |
| `4`   | bottom-right                   | bottom-left          |
| `5`   | bottom-left                    | bottom-right         |

Link to current internals:

- `mux` and `switch` output order comes from the shared global multi-output ordering.
- `demux` input order comes from the mirrored six-input ordering.
- These index orders are implemented in the current node layouts, not inferred ad hoc.

## Nested Groups

Nested groups remain real internal `group` nodes in the stored graph, but the canonical user-facing DSL expands them inline.

Canonical meaning:

- The canonical DSL does not need to distinguish parent-group nodes from child-group nodes.
- The canonical DSL does not expose raw `groupRef` values.
- The canonical DSL does not expose raw child `controlSlot` mappings.
- Instead, nested group instances are expanded into the same visible node language as the rest of the current group body.

Inline expansion rules:

- expand the referenced child group body in place
- rename child locals as needed to avoid collisions
- substitute child `$n` boundary inlets with the actual sources connected to that child instance
- substitute child `.outlet(n)` boundary outlets with the actual downstream uses of that child instance

Link to current internals:

- The stored graph still uses real internal `group` nodes with `groupRef`.
- The current build layer already resolves child outputs and child controls through that nested group structure.
- The canonical DSL simply chooses not to surface those implementation details.

Canonical example:

Given a child group that is conceptually:

```txt
x = $0.every(3){$1}
x.outlet(0)
```

and a parent that feeds the child, then continues into `counter(4)`, the canonical expanded DSL becomes:

```txt
x = $0.every(3){$1}.counter(4)
x.outlet(0)
```

Canonical note:

- An optional future alternate view may keep nested group boundaries visible.
- That collapsed form is not canonical in the current plan.

## Mapping Summary

| DSL surface                            | Current internal linkage                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------- |
| `name = expr`                          | readable local bound to real internal node(s); ids still live in `graph.nodes[].id`    |
| `node(n)` / `source.node(n)`           | node call form with stored initial param `n`                                           |
| `node{arg}` / `source.node{arg}`       | node call form with live control input structure in the canonical surface              |
| `node(n){arg}` / `source.node(n){arg}` | node call form with both stored param and live control input structure                 |
| `$n`                                   | current group external input slot `n`, derived from `inputs[]` first then `controls[]` |
| `expr.outlet(n)`                       | `group.outputs[n]`                                                                     |
| `expr.out()`                           | real internal `out` node in `group.graph.nodes`                                        |
| `name[index]` in source position       | signal output `portSlot = index`                                                       |
| `name[index]` in target position       | signal input `portSlot = index`                                                        |
| `source.target`                        | one real internal edge in `group.graph.edges`                                          |
| `source<d>.target`                     | same real edge plus derived distance annotation                                        |
| recursive bindings                     | same cyclic graph currently allowed by model/runtime                                   |
| nested-group expansion                 | stored internal `groupRef` nodes are expanded inline for the canonical DSL view        |

## Formal Grammar And Canonical Formatting

This section locks the exact surface grammar and canonical pretty-print rules for the current DSL plan.

### No Sugar

The canonical DSL uses one strict surface form only.

Canonical consequences:

- no `demux(a, b)` sugar
- no `p()` alias for `pulse()`
- no `kN()` alias for `constN()`
- no alternate spellings for the same graph shape

The canonical exporter should always emit the strict core form only.

### Line-Oriented Grammar

The DSL is line-oriented.
Each non-blank line contains exactly one statement plus an optional trailing `//` comment.

```ebnf
file            := line*
line            := ws? (statement)? ws? comment? newline
comment         := "//" text
statement       := binding | wire | expr

binding         := identifier ws? "=" ws? expr
wire            := source_ref distance? "." target_ref
expr            := signal_expr terminal?
signal_expr     := call_head (distance? "." call_segment)*
call_head       := source_atom | node_call
call_segment    := node_call
terminal        := ".out()" | ".outlet(" index ")"

source_atom     := inlet_ref | source_ref | node_call
source_ref      := inlet_ref | ref
target_ref      := ref
ref             := identifier indexer?
inlet_ref       := "$" index
indexer         := "[" index "]"
distance        := "<" positive_int ">"
node_call       := node_name (empty_call | param_clause control_clause? | control_clause)
empty_call      := "(" ")"
param_clause    := "(" param_literal ")"
control_clause  := "{" arg_list? "}"
arg_list        := arg (ws? "," ws? arg)*
arg             := signal_expr

identifier      := /[A-Za-z_][A-Za-z0-9_]*/
node_name       := identifier
index           := /0|[1-9][0-9]*/
positive_int    := /[1-9][0-9]*/
param_literal   := /[1-8]/
```

### Parse Rules

These rules remove the main remaining ambiguities.

- Zero-argument, no-param node applications require parentheses, such as `mux()`, `demux()`, and `out()`.
- Parametrized node calls use parentheses for stored params, such as `every(3)`.
- `every(3){$0}` means stored param `3` plus a live control edge from `$0`.
- `every{$0}` means no explicit stored param clause, so the node keeps its type default param.
- `a<4>.b` parses as a standalone wire statement because `b` is a target reference, not a call.
- `a.mux()` parses as a chain segment because `mux` is followed by `()`.
- `a.every(3)` parses as a chain segment because `every(3)` is a node call, not a target reference.
- Parentheses are used for stored params and zero-argument node calls only.
- Braces are used for live control clauses.
- The current canonical plan does not use tuple syntax or general grouping delimiters.
- A line is terminated by newline, not by semicolon.

### Identifiers And Reserved Words

Identifiers use this form:

- `[A-Za-z_][A-Za-z0-9_]*`
- case-sensitive
- no spaces
- no hyphens
- `$` is reserved for boundary inlet references only

The canonical DSL reserves these words:

- `pulse`
- `out`
- `mux`
- `demux`
- `switch`
- `block`
- `add`
- `sub`
- `set`
- `speed`
- `pitch`
- `decay`
- `crush`
- `hpf`
- `lpf`
- `every`
- `random`
- `counter`
- `gtp`
- `ltp`
- `gtep`
- `ltep`
- `match`
- `group`
- `outlet`

User-authored bindings must not use a reserved word exactly.

### Numeric Rules

The current surface has three distinct numeric categories:

- stored param literals: `1` to `8` inside `( )`
- indices: `0` or greater
- distances: positive integers greater than `0`

Examples:

- `every(2)` is valid
- `every(0)` is invalid
- `m[0]` is valid
- `.outlet(0)` is valid
- `<12>` is valid
- `<0>` is invalid

### Whitespace And Newlines

Canonical formatting uses these rules:

- one statement per line
- newline terminates a statement
- blank lines are allowed
- `//` comments are allowed
- optional spaces around `=`
- optional spaces after commas
- no spaces around `.`
- no spaces inside `[]`
- no spaces inside `<>`
- no spaces between a node name and `(`
- no spaces between a node name and `{`
- no semicolons
- no block comments

Canonical style:

```txt
a = every(3){b<6>}
$0.a
a<4>.merge[0]
```

Non-canonical:

```txt
a = every(3){ b <6> }
$0 . a
```

### Control Surface Rule

Control edges are expressed only through braced control clauses.

Canonical:

```txt
a = every(3){b<6>}
$0.a
```

Not canonical:

```txt
b<6>.a.control
```

That older target-port style is intentionally not part of the canonical DSL.
Standalone wire statements must not target control ports.

### Pretty-Print Rules

The canonical exporter should keep the printed language simple and deterministic.

- no multiline statements
- no continuation syntax
- no semicolons
- the exporter does not wrap lines syntactically
- if a line becomes awkwardly long, the exporter may introduce bindings
- if a statement is still long after reasonable binding introduction, it remains a single line

Line width is therefore not part of the grammar.

## Canonical Export Rules

The exporter should produce one deterministic canonical DSL form for a given group and export mode.

### Export modes

- The default canonical export omits comments.
- The default canonical export omits `<n>` distance annotations.
- An optional annotated export mode may add:
  - generated `//` interface-label comments
  - generated `// preserveInternalCableDelays: ...` comments
  - `<n>` distance annotations on real internal edges

Comments are non-semantic and do not need to round-trip.

### Statement ordering

The exporter should emit statements in this order:

1. generated header comments, if the current export mode asks for them
2. outlet-anchored components in ascending `.outlet(n)` order
3. internal `out()` sink components in stable node order
4. any remaining disconnected components in stable node order

Stable node order should prefer existing readable names when present, then fall back to stored `graph.nodes[]` order.

### Chain compression

The exporter should prefer the chain form when all of these are true:

- the current node sits on one obvious main-signal path
- the target is a single-stream node with one main signal input
- the source output is not reused elsewhere
- the next step does not require indexed port selection
- the step is not clearer as a standalone wire statement

The exporter should introduce a binding when:

- a subexpression is reused
- a cycle needs a named reference
- a multi-port node output is referenced explicitly
- a control expression is better named than repeated inline
- inline expansion would become hard to read

The exporter should fall back to standalone wire statements when:

- a target port must be selected explicitly
- a graph segment is multi-input or multi-output in a way that does not read cleanly as one chain
- a larger strongly connected component does not project cleanly into recursive bindings
- preserving readability is more important than forcing a single expression

### Binding names

The exporter should choose names in this order:

1. use stored `node.name` if it is a valid non-reserved identifier and unique
2. otherwise normalize the stored name:
   - replace invalid characters with `_`
   - prefix `_` if the first character would otherwise be invalid
3. if the normalized form still collides or is reserved, add suffixes `_2`, `_3`, `_4`, ...
4. if there is no usable stored name, generate `a`, `b`, `c`, ... `z`, then `a_2`, `b_2`, ...

The exporter must avoid collisions with:

- other local bindings
- `$n`
- canonical node names
- reserved surface forms such as `outlet`

### Stored Params

The exporter should prefer param clauses when the stored meaning is a node's initial param value.

Example:

```txt
$0.every(2).counter(4).outlet(0)
```

Canonical note:

- Bare numeric literals are not standalone live control expressions in the current canonical surface.
- A live control input must still be expressed as a signal expression.

### Distances

Distance annotations are derived, not canonical source data.

The exporter should therefore:

- omit `<n>` in the default export mode
- include `<n>` only in an explicit annotated mode
- emit `<n>` only for real internal edges
- never emit `<n>` on `$n` or before `.outlet(n)`

## Canonical Import Rules

The importer should lower the user-facing DSL back into the current stored group shape:

- `graph.nodes`
- `graph.edges`
- `inputs[]`
- `outputs[]`
- `controls[]`

### Param clause lowering

`node(n)` lowers to the node's stored initial param value.

Examples:

```txt
$0.every(2).outlet(0)
```

- `every.params.param = 2`

```txt
$0.every(3){$1}.outlet(0)
```

- `every.params.param = 3`
- plus a live control mapping from `$1`

If a param clause is omitted:

- the importer should use the node type's `defaultParam`
- no live control edge is implied by omission

Nodes that do not expose a stored param must reject param clauses.

### `$n` inlet inference

`$n` is a unified surface syntax, but the current stored model still separates signal `inputs[]` from control `controls[]`.

The importer should therefore infer inlet kind from syntactic position:

- `$n` used as a signal source in a chain or standalone wire statement means a signal inlet
- `$n` used inside a node argument means a control inlet

Examples:

```txt
$0.every(2).outlet(0)
```

- `$0` lowers into `inputs[0]`

```txt
pulse(3).every{$0}.out()
```

- `$0` lowers into `controls[0]`

```txt
$0.every(3){$1}.outlet(0)
```

- `$0` lowers into `inputs[0]`
- `$1` lowers into `controls[0]`

### `$n` validity constraints

Because the current grouped-node outside port order is:

1. all `inputs[]`
2. then all `controls[]`

the importer must reject any DSL that violates that numbering model.

Valid `$n` usage must satisfy all of these rules:

- each distinct `$n` has exactly one inferred kind: signal or control
- one `$n` cannot be used both as a signal inlet and as a control inlet
- each `$n` represents exactly one external inlet mapping
- signal inlet indices must form a contiguous range starting at `0`
- control inlet indices must form a contiguous range immediately after the last signal inlet index
- there may be no gaps in the combined outside inlet numbering

Examples:

- valid: only `$0` used as control
- valid: `$0` as signal and `$1` as control
- invalid: `$0` as control and `$1` as signal
- invalid: `$0` used once as signal and elsewhere as control
- invalid: `$0` and `$2` used with no `$1`

### `.outlet(n)` inference

`.outlet(n)` lowers directly into `outputs[n]`.

Valid outlet usage must satisfy all of these rules:

- each `.outlet(n)` is terminal
- each outlet index is used at most once
- outlet indices form a contiguous range starting at `0`
- `.outlet(n)` only exposes signal outputs

### Comments

The importer should ignore `//` comments completely.
Comments do not create symbols and do not affect graph lowering.

### Control mapping lowering

Canonical `controls[]` entries should use:

```js
{ label?: string, nodeId: string, controlSlot: number }
```

Canonical lowering meaning:

- for an ordinary internal node, `controlSlot` addresses that node's real control input index
- for an internal child `group` node, `controlSlot` addresses that child group's exposed control input index

Concrete examples:

```js
{ label: "rate", nodeId: "every1", controlSlot: 0 }
```

- means the exposed group control targets the first real control input on internal node `every1`

```js
{ label: "rate", nodeId: "childGroup", controlSlot: 0 }
```

- means the exposed group control targets exposed control `0` on the child group node `childGroup`
- build-time flattening then follows that child mapping until it reaches a real internal control input

Legacy note:

- older snapshots may still use `{ paramKey }`
- canonical import/export should target `controlSlot` only

Migration intent:

- older direct mappings such as `{ nodeId, paramKey: "param" }` should load as `{ nodeId, controlSlot: 0 }` for current built-in nodes
- existing child-group `{ controlSlot }` mappings already match the canonical target shape
- future nodes with more than one live control input should extend naturally by using `controlSlot: 1`, `controlSlot: 2`, and so on

## Invalid Forms

The canonical DSL should reject these forms during parsing or lowering:

- duplicate `.outlet(n)` mappings
- duplicate use of one `$n` as more than one boundary mapping
- mixed signal/control use of the same `$n`
- `$n` numbering that breaks the current signal-first outside port ordering
- gaps in `$n` numbering
- gaps in `.outlet(n)` numbering
- explicit wire statements targeting non-signal ports
- explicit wire statements that connect to a signal input port already occupied
- indexed port references outside the valid range for the node
- param clauses on node types that do not store a param
- param literals outside `1..8`
- `<n>` attached to `$n`
- `<n>` attached immediately before `.outlet(n)`
- stored group shapes that drive one internal control slot from both a group-boundary control mapping and an internal control edge

Canonical note:

- If a graph shape cannot be expressed cleanly as recursive bindings, the exporter should fall back to standalone wire statements rather than failing.
- If a stored graph shape would require multiple sources on a single control slot, the exporter should fail rather than invent non-canonical DSL.
- A parser may still reject a malformed user-authored cycle if the referenced bindings or edges do not lower to a valid graph.

## Surface-Phase Acceptance Criteria

The DSL implementation work should be considered ready only when all of these are true:

- the exporter can produce deterministic output for the same stored group
- the exporter follows the node-family and multi-port rules in this document
- the importer can lower canonical DSL back into `graph.nodes`, `graph.edges`, `inputs[]`, `outputs[]`, and `controls[]`
- `$n` lowering respects the current signal-first outside port ordering
- comments are ignored semantically
- default export omits comments and distance annotations
- annotated export can include generated comments and `<n>` edge distances without changing graph meaning

Minimum fixture coverage should include:

- a simple single-stream chain
- a control-only exposed inlet
- mixed signal and control inlets
- stored param only via `(n)`
- stored param plus live control via `(n){...}`
- explicit `.outlet(n)` mapping
- `mux`
- `demux`
- `switch`
- a simple recursive feedback cycle
- an explicit-wire multi-port fallback
- invalid `$n` mixed-kind usage
- invalid `$n` numbering gaps
- invalid duplicate `.outlet(n)` usage
- nested-group inline expansion

## What The DSL Does Not Replace

The DSL does not replace these stored fields:

- node ids
- edge ids
- `pos`
- `rot`
- `manualCorners`
- `groupRef`
- `preserveInternalCableDelays`

Those remain in the snapshot and related derived systems.

Important consequences:

- The DSL is not the only source of truth for layout.
- `<n>` is derived from routing, not persisted as source text in the current model.
- Exact corner geometry still lives in `manualCorners`.
- If the DSL becomes editable later, layout will still need a sidecar strategy or regeneration strategy.

## Canonical Examples

### Control-Only Exposed Inlet

```txt
pulse(3).every{$0}.out()
```

Meaning:

- no exposed signal inputs
- one exposed control input at outside slot `0`
- one real internal `out` node

### Mixed Exposed Signal And Control Inlets

```txt
$0.every($1).outlet(0)
```

Meaning:

- `$0` is the first exposed signal inlet
- `$1` is the first exposed control inlet because controls come after signals in the current outside port order
- `.outlet(0)` exposes the final signal as group output `0`

### `mux` Into `demux`

```txt
m = $0.mux()
a = m[0].every(2)
b = m[1].counter(4)

d = demux()
a<4>.d[0]
b<7>.d[1]
d.outlet(0)
```

### `switch`

```txt
sw = $0.switch(2){$1}
sw[0].outlet(0)
sw[3].outlet(1)
```

### Simple Feedback Cycle

```txt
a = $0.every(3){b<6>}
b = a<4>.counter(4)
b.outlet(0)
```

### Explicit Multi-Port Fallback

```txt
m = mux()
d = demux()

$0.m
m[0]<4>.d[0]
m[1]<7>.d[1]
d.outlet(0)
```

## Working Conclusions

The canonical working plan is now:

- JSON remains canonical project storage.
- The DSL is a secondary textual representation over the stored group graph and the planned first-class text authoring surface for groups.
- `//` comments are allowed for readability.
- Boundary inlets use `$0`, `$1`, `$2`, ...
- Boundary outlets use explicit `.outlet(n)`.
- Real internal sinks still use `.out()`.
- Indexing is 0-based everywhere.
- Explicit wire statements keep the period.
- Stored node params use `(n)`.
- Control edges are expressed by braced control clauses, not by `.control` targets.
- Canonical group control mappings use `controlSlot`.
- Distances are optional source-postfix edge annotations.
- Distances apply only to real internal edges, not boundary mappings.
- `mux`, `demux`, and `switch` are first-class indexed nodes.
- Simple cycles should use recursive bindings.
- Hard graphs may fall back to standalone wire statements.
- Nested groups are expanded inline in the canonical DSL view.
- Raw `groupRef` and child `controlSlot` remain internal implementation details.

## Implementation Appendix

The following sections extend the working syntax into an implementation-ready
migration plan.

These sections are intended to be detailed enough that another agent can
implement first-class DSL authoring from them without needing to rediscover the
architecture from code.

### Authority And Scope

This document now governs all of the following for group DSL work:

- canonical user-facing DSL surface syntax
- canonical `snapshot -> DSL` export behavior
- canonical `DSL -> snapshot` lowering behavior
- source preservation for authored DSL text and comments
- layout generation for DSL-authored groups
- reconciliation when DSL edits update existing groups
- migration away from legacy grouped direct-param control handling
- UI expectations for grouped-node DSL editing and code-authored nodes

This document is intentionally self-contained. It is the single source of truth
for DSL behavior, migration rules, validation rules, UI expectations, and
acceptance criteria.

This document does not replace the JSON snapshot as canonical persisted project
storage.

Instead:

- JSON remains the executable and editor-facing stored format
- DSL becomes a first-class authoring surface that lowers into the same stored
  group definition model

### Current State Vs Target State

The current implementation and the canonical target are not the same yet.

| Area                      | Current implementation                                                                        | Canonical target                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Group control mappings    | ordinary internal nodes still commonly use `{ paramKey }`; child groups use `{ controlSlot }` | all canonical group control mappings use `{ controlSlot }`                                                      |
| Grouped control execution | direct grouped controls may be compiled to a virtual direct-param target                      | grouped controls should target real control inputs on ordinary nodes and exposed control inputs on child groups |
| DSL role                  | readable secondary representation with planning work already specified                        | first-class authoring path for groups that still lowers into canonical snapshot storage                         |
| Nested group surface      | snapshot preserves `groupRef` nodes                                                           | canonical DSL view expands nested groups inline                                                                 |
| Source preservation       | snapshot cannot preserve comments, formatting, or exact authored text                         | exact authored DSL text and comments must be preserved separately from snapshot semantics                       |
| Layout data               | snapshot requires concrete `pos`, `rot`, and `manualCorners`                                  | DSL authoring must generate or reconcile that concrete geometry before snapshot storage                         |
| Export source             | runtime build can flatten groups, but introduces build-only details                           | exporter must start from stored group definitions and group library data, not the compiled runtime graph        |

### Recommended Insertion Point

DSL should become a first-class authoring path above the Graph Model and in
parallel with canvas editing.

Canonical architectural position:

```txt
Canvas editor intents ─┐
                       ├─> authoring layer ─> Graph Model / GroupDefinition snapshot
DSL authoring intents ─┘
```

That means:

- the Graph Model remains the owner of canonical in-memory snapshot state
- DSL parsing and lowering happen before data reaches `addGroup` or `updateGroup`
- Routing, Build/Validate, Runtime, and Audio Integration stay downstream of the
  snapshot and remain DSL-agnostic
- Serialisation persists snapshot data and preserved DSL metadata but should not
  become the place where live DSL authoring logic runs

### Required Module Boundaries

First-class DSL support should be implemented as a new core authoring module,
not by leaking DSL concerns into runtime or routing.

Recommended ownership:

- `packages/core/dsl/parse.*`
  - lexical parsing
  - syntax errors
  - CST/AST as needed for exact source preservation
- `packages/core/dsl/ir.*`
  - semantic group IR types and helpers
- `packages/core/dsl/export.*`
  - `GroupDefinition -> expanded semantic IR -> DSL`
- `packages/core/dsl/lower.*`
  - `DSL/IR -> GroupDefinition`
- `packages/core/dsl/reconcile.*`
  - merge lowered groups against an existing group while preserving stable ids
    and geometry where possible
- `packages/core/dsl/layout.*`
  - deterministic initial layout and route synthesis for DSL-authored groups
- `packages/core/dsl/errors.*`
  - parse, lowering, layout, reconciliation, and migration diagnostics

The following modules should remain consumers of canonical snapshot data only:

- `packages/core/graph/*`
- `packages/core/routing/*`
- `packages/core/build/*`
- `packages/core/runtime/*`

### Canonical Pipelines

The migration plan uses three canonical pipelines.

#### 1. Export pipeline

```txt
GroupDefinition -> expanded semantic IR -> canonical DSL
```

This pipeline is responsible for:

- nested-group expansion
- conversion of boundary mappings into `$n` and `.outlet(n)`
- conversion of stored params into `(n)`
- optional derivation of `<n>` distances from routed geometry
- deterministic statement ordering and naming

#### 2. Import pipeline

```txt
DSL source -> semantic IR -> GroupDefinition
```

This pipeline is responsible for:

- parsing
- `$n` kind inference
- control/signal edge lowering
- stored param lowering
- boundary mapping construction
- concrete snapshot generation

#### 3. Edit-existing pipeline

```txt
DSL source -> semantic IR -> reconciled GroupDefinition
```

This pipeline is responsible for:

- preserving stable node ids where logical nodes still match
- preserving stable edge ids where logical edges still match
- preserving readable names where possible
- preserving or selectively regenerating layout data
- updating preserved DSL source metadata

Canonical exporter rule:

- export must start from the stored `GroupDefinition` and the stored group
  library
- export must not start from the compiled runtime graph, because build/runtime
  flattening currently introduces implementation details that are not canonical
  DSL semantics

### Semantic Group IR

All first-class DSL work should pass through a normalized semantic IR before
rendering or snapshot lowering.

The semantic IR is not persisted directly.
It exists to separate:

- the authored DSL surface
- the canonical stored `GroupDefinition`
- the build/runtime flattening layer

Canonical normalized shape:

```js
type SemanticGroupIR = {
  preserveInternalCableDelays: boolean;
  nodes: SemanticNode[];
  signalEdges: SemanticSignalEdge[];
  controlEdges: SemanticControlEdge[];
  boundaryInputs: SemanticBoundaryInput[];
  boundaryOutputs: SemanticBoundaryOutput[];
  bindingNames: Record<string, string | undefined>;
  comments: SemanticComment[];
};

type SemanticNode = {
  irNodeId: string;
  type: string;
  storedParam?: number;
  bindingName?: string;
  origin?: {
    kind: "local" | "expanded-group";
    groupPath: string[];
    sourceNodeId: string;
  };
};

type SemanticSignalEdge = {
  from: SemanticSourceRef;
  to: { irNodeId: string; signalSlot: number };
  distance?: number;
  originEdgeId?: string;
};

type SemanticControlEdge = {
  from: SemanticSourceRef;
  to: { irNodeId: string; controlSlot: number };
  distance?: number;
  originEdgeId?: string;
};

type SemanticBoundaryInput = {
  inletIndex: number;
  kind: "signal" | "control";
  label?: string;
  target:
    | { irNodeId: string; signalSlot: number }
    | { irNodeId: string; controlSlot: number };
};

type SemanticBoundaryOutput = {
  outletIndex: number;
  label?: string;
  source: SemanticSourceRef;
};

type SemanticSourceRef =
  | { kind: "node-output"; irNodeId: string; outputSlot: number }
  | { kind: "boundary-inlet"; inletIndex: number };

type SemanticComment = {
  text: string;
  line: number;
  origin?: "authored" | "generated";
};
```

The IR must include:

- every real internal node in the canonical expanded group body
- the stored param value, when explicitly authored or present in the snapshot
- all real signal edges between internal nodes
- all real control edges between internal nodes
- every exposed inlet mapping with explicit inferred kind
- every exposed outlet mapping
- deterministic binding names where available
- nested-group expansion provenance so exporter and reconciliation logic can
  reason about expanded nodes without exposing raw `groupRef`

The IR must not include:

- persisted node ids
- persisted edge ids
- positions
- rotations
- manual corners
- raw `groupRef` syntax as a canonical surfaced construct
- build-only virtual ports or runtime-only artifacts

### Export Algorithm

Export should happen in two deterministic phases:

```txt
GroupDefinition -> expanded semantic IR -> canonical DSL text
```

#### Phase 1: `GroupDefinition -> expanded semantic IR`

Exporter must apply these steps in order:

1. Start from the stored target `GroupDefinition`.
2. Copy `preserveInternalCableDelays` into the IR.
3. Recursively expand any nested internal `group` nodes into ordinary visible
   semantic nodes and semantic edges.
4. Carry provenance for each expanded node using `origin.groupPath` and
   `origin.sourceNodeId`.
5. Convert stored node params from `node.params.param` into `storedParam`.
6. Convert stored `inputs[]` mappings into `boundaryInputs` with `kind:
"signal"`.
7. Convert stored `controls[]` mappings into `boundaryInputs` with `kind:
"control"`.
8. Convert stored `outputs[]` mappings into `boundaryOutputs`.
9. Convert internal graph edges into `signalEdges` or `controlEdges` using the
   registry-derived input roles, not textual heuristics.
10. If the input snapshot still contains legacy direct control mappings using
    `{ paramKey }`, normalize them to the canonical `controlSlot` shape before
    IR construction.
11. If annotated export mode is enabled, derive optional `distance` values from
    routing output for real internal edges only.

Canonical export-preparation rule:

- by the time the IR is complete, there must be no `paramKey`-based control
  targets and no build-only virtual direct-param target slots left in the
  semantic data

#### Phase 2: `expanded semantic IR -> canonical DSL text`

Once IR is built, DSL rendering must apply these rules in order:

1. Choose deterministic binding names.
2. Order connected components deterministically.
3. Prefer chain rendering for linear single-stream signal flow.
4. Introduce bindings when:
   - a value is reused
   - a cycle requires a name
   - a multi-port node needs indexed references
   - explicit wire fallback is clearer than a forced chain
5. Emit standalone wire statements only for signal edges that are not cleanly
   represented by chain form.
6. Render control edges only as braced control clauses on the target node call.
7. Render stored params only as `(n)` clauses.
8. Render `$n` and `.outlet(n)` from `boundaryInputs` and `boundaryOutputs`.
9. Render `<n>` only when annotated export mode is enabled.
10. Render generated `//` comments only when annotated export mode is enabled.

Canonical statement ordering:

1. preserved or generated header comments
2. bound components with no outlet mapping, in deterministic binding order
3. outlet-anchored components in ascending `.outlet(n)` order
4. remaining standalone signal wire statements in deterministic source/target
   order

### Import And Lowering Algorithm

Import should happen in three deterministic phases:

```txt
DSL source -> parsed syntax -> semantic IR -> GroupDefinition
```

#### Phase 1: parse syntax

The parser must:

- preserve exact source text and comments separately from semantic lowering
- construct enough syntax structure to distinguish bindings, chains, stored
  params, control clauses, explicit wire statements, inlet refs, outlet refs,
  and distances
- reject malformed syntax before semantic lowering begins

#### Phase 2: syntax -> semantic IR

The parser/lowerer must then normalize syntax into the canonical semantic IR:

1. Create semantic nodes for each node call.
2. Assign temporary `irNodeId` values for all semantic nodes.
3. Convert chain segments into signal edges.
4. Convert explicit wire statements into signal edges.
5. Convert braced control clauses into control edges.
6. Convert `(n)` clauses into `storedParam`.
7. Convert `.outlet(n)` terminals into `boundaryOutputs`.
8. Record every `$n` occurrence and infer its boundary kind from position.
9. Build `boundaryInputs` from those inferred uses.
10. Reject mixed-kind or duplicate `$n` usage that would imply more than one
    boundary mapping per inlet index.
11. Reject `.outlet(n)` duplication or numbering gaps.

#### Phase 3: semantic IR -> `GroupDefinition`

Once the IR is normalized, lowering to snapshot storage must:

1. Create `graph.nodes` entries for every semantic node.
2. Lower every `storedParam` into `node.params.param`.
3. Lower every `signalEdge` into a real internal `graph.edges` entry.
4. Lower every `controlEdge` into either:
   - a `controls[]` boundary mapping when sourced from `$n`
   - or a real internal signal edge targeting a real control input when sourced
     from another internal node
5. Lower `boundaryInputs` into ordered `inputs[]` and `controls[]`.
6. Lower `boundaryOutputs` into ordered `outputs[]`.
7. Preserve `preserveInternalCableDelays`.
8. Pass the resulting group definition through layout generation or
   reconciliation before final snapshot storage.

Canonical lowering notes:

- imported canonical DSL always lowers to the canonical expanded group body;
  canonical DSL does not recreate nested `groupRef` structure
- imported canonical DSL must not create build-only virtual direct-param targets
- imported canonical DSL must not rely on compiled runtime graph structures

### Source Preservation

Exact authored DSL text and comments must be preserved separately from the
snapshot semantics.

The snapshot alone cannot preserve:

- comment placement
- exact whitespace and blank-line structure
- whether a graph was authored as a chain or with extra bindings
- exact chosen local names when those names are semantically optional

Canonical stored metadata shape on `GroupDefinition`:

```js
dsl: {
  source: string,
  formatVersion: 2,
  mode: "authored" | "generated",
  syncStatus: "in-sync" | "stale",
  lastAppliedSemanticHash: string
}
```

Field meanings:

- `source`
  - exact byte-preserved authored or generated DSL text
- `formatVersion`
  - DSL source-format version, independent of project JSON schema version
- `mode`
  - `"authored"` when the source came from direct user editing
  - `"generated"` when the source was exported from snapshot state
- `syncStatus`
  - `"in-sync"` when `source` still describes the current stored group
    semantics
  - `"stale"` when the current snapshot has diverged from preserved `source`
- `lastAppliedSemanticHash`
  - hash of the lowered semantic IR used to determine whether preserved source
    still matches current group semantics

Canonical preservation rules:

- DSL edits must preserve the exact submitted source text byte-for-byte.
- Canvas edits must not silently rewrite preserved authored source.
- Generated exports may be stored, but generated source must remain
  distinguishable from authored source through `mode`.
- A stale authored source must remain viewable and recoverable until the user
  explicitly replaces it.
- Pre-migration preserved source from older DSL syntax versions must not force
  continued parser support for those older syntaxes.
- When preserved `dsl.source` is older than the current canonical
  `formatVersion`, the application may show a regenerated current-format export
  instead of the stale preserved source until the group is reapplied in the new
  syntax.

#### Source ownership table

| Situation                                                      | Stored snapshot             | Stored `dsl.source`                                           | `mode`                | `syncStatus` |
| -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- | --------------------- | ------------ |
| Group loaded with authored DSL already in sync                 | keep as loaded              | keep as loaded                                                | `authored`            | `in-sync`    |
| Group loaded with no stored DSL source                         | keep as loaded              | optional generated export only on demand                      | `generated` if stored | `in-sync`    |
| User edits DSL and apply succeeds                              | replace with lowered result | preserve exact submitted text                                 | `authored`            | `in-sync`    |
| User edits canvas after authored DSL exists                    | update snapshot only        | keep preserved source unchanged                               | unchanged             | `stale`      |
| User requests regenerated DSL from current snapshot            | keep snapshot               | replace with canonical export only after explicit user action | `generated`           | `in-sync`    |
| User replaces stale authored DSL by editing and applying again | replace with lowered result | preserve newly submitted text                                 | `authored`            | `in-sync`    |

### Layout Strategy For DSL-Authored Groups

Lowering from DSL must end with a concrete `GroupDefinition` that includes
usable editor geometry.

The canonical strategy is:

- deterministic structure-aware auto-layout for brand-new DSL-authored groups
- reconciliation-first layout preservation for edits to existing groups

#### Brand-new group layout

When no prior group layout exists, the layout engine must:

1. Build a condensed signal-flow graph using strongly connected components for
   cycles.
2. Assign primary left-to-right columns by signal-flow depth in that condensed
   graph.
3. Assign rows by top-level connected component, preserving outlet-anchored
   components in ascending `.outlet(n)` order where possible.
4. Place ordinary chain nodes on the same horizontal lane when they belong to
   the same linear path.
5. Place fan-out nodes (`mux`, `switch`) so indexed outputs remain visually
   ordered top-to-bottom.
6. Place fan-in nodes (`demux`) so indexed inputs remain visually ordered
   top-to-bottom.
7. Use rotation `0` by default unless a future explicit rotation policy is
   added.
8. Generate orthogonal routes and synthesize `manualCorners` after node
   placement.

Canonical placement goals:

- maximize left-to-right readability of main signal flow
- keep control sources visually close to the nodes they modulate where possible
- preserve stable multi-port visual ordering
- avoid using edge length requirements as the primary driver of node spacing

#### Distance constraints during generated layout

When DSL includes explicit `<n>` distances:

- treat `<n>` as a constraint on the final routed edge length
- do not primarily satisfy `<n>` by pushing nodes arbitrarily far apart
- first choose readable node placement
- then add route slack and extra orthogonal jogs to hit the requested length
  when feasible

Canonical failure rule:

- if the minimum feasible orthogonal route between the chosen endpoints already
  exceeds the requested `<n>`, lowering must fail with a layout error

Canonical omission rule:

- if DSL omits `<n>`, layout is free to choose readable routes and the exported
  distance remains derived, not authored

### Reconciliation For Existing Groups

Editing an existing group from DSL must reconcile the lowered semantic result
against the current stored group before replacing it.

The goal is to preserve:

- stable node ids
- stable edge ids
- existing node positions where still sensible
- existing rotations where still sensible
- existing manual corners where the same connection still exists

#### Node reconciliation order

Node matching must use this priority order:

1. exact preserved authored binding name match, when unique and same node type
2. exact existing stored `node.name` match, when unique and same node type
3. exact provenance match from a previously lowered authored source, when
   available
4. structural signature match:
   - same node type
   - same stored param presence/value
   - same control-argument structure where available
   - same boundary role or adjacent matched neighbors where available
5. otherwise create a new node id

#### Edge reconciliation order

Edge matching must use this priority order:

1. same matched source node, same source port
2. same matched target node, same target signal/control slot
3. same edge role (`signal` or `control`)
4. same authored or derived distance when explicitly present
5. otherwise create a new edge id

#### Geometry preservation rules

When a node is matched:

- preserve its `id`
- preserve its `pos` unless surrounding structure changed enough that the local
  region must be relaid out
- preserve its `rot` unless the new node type/layout family makes that invalid

When an edge is matched:

- preserve its `id`
- preserve its `manualCorners` if both endpoints and their relative local
  ordering remain compatible
- regenerate corners if either endpoint moved significantly or port indices
  changed

#### Partial relayout rule

Reconciliation should not force a full relayout when only part of the group has
changed.

Canonical strategy:

- preserve unchanged matched regions
- auto-layout newly added nodes and unmatched local regions
- expand local spacing if a preserved region and a new region would overlap
- only fall back to full-group relayout when the structural change is large
  enough that local placement cannot produce a readable result

### Group Control Migration

The current codebase still contains a legacy grouped-control model that does not
match the canonical DSL plan.

#### Current implementation behavior

Current implementation still permits this split:

- direct ordinary-node group controls commonly use `{ paramKey: "param" }`
- child-group forwarding uses `{ controlSlot }`

The current grouped build/runtime path then special-cases ordinary direct group
controls by compiling them to a virtual direct-param target rather than the
node's real control input.

This behavior exists today in the implementation paths described by:

- `packages/core/graph/snapshot.js`
- `packages/core/build/groups.js`
- `packages/core/build/roles.js`
- `packages/core/build/compile.js`
- `packages/core/runtime/runtime.js`

#### Canonical target behavior

The canonical target is:

- all group control mappings use `{ nodeId, controlSlot }`
- for ordinary nodes, `controlSlot` means the node's real control input index
- for child groups, `controlSlot` means the child group's exposed control input
  index
- grouped controls compile to ordinary control edges targeting real control
  inputs
- runtime processes grouped controls using the same `onControl` path as any
  other control edge targeting that input

#### Required migration steps

Implementation should apply this migration in order:

1. Normalize legacy `{ paramKey: "param" }` mappings into canonical
   `{ controlSlot: 0 }` mappings during load/parse.
2. Update snapshot normalization so canonical in-memory group definitions store
   `controlSlot` only.
3. Update group template building so ordinary-node group controls resolve to the
   real control input slot derived from `shape.inputs + controlSlot`.
4. Remove build-only virtual direct-param targets from the canonical grouped
   control path.
5. Update runtime so grouped external controls no longer bypass `onControl`
   through a special direct-param branch.
6. Keep child-group forwarding semantics, but express them with the same
   canonical `controlSlot` model.

Canonical migration rule:

- ordinary grouped controls must target real control inputs, not virtual
  direct-param slots

### Legacy Compatibility

The migration must preserve load-compatibility for older project files while
moving all canonical storage and export forward to the `controlSlot` model.

#### Legacy load rules

When loading an older snapshot:

- if a group control mapping uses `{ paramKey: "param" }` and no `controlSlot`,
  normalize it to `{ controlSlot: 0 }`
- if a mapping already uses `controlSlot`, keep it unchanged
- if a legacy `{ paramKey }` mapping targets a node that does not expose a real
  control input at slot `0`, load must fail with a group-mapping error

Canonical note:

- `paramKey` is load-compatible only as a migration path
- `paramKey` is not a canonical in-memory or serialized target shape going
  forward

#### Serializer expectations

Serializer and any canonical save/export path must:

- emit `controlSlot` only
- never emit `paramKey` for newly saved canonical snapshots
- preserve exact authored DSL source metadata when present

#### Fixture and test migration requirements

Existing fixtures and tests that still encode direct grouped param mappings must
be updated to the canonical model.

Minimum required migrations:

- grouped snapshot fixtures that currently use `{ paramKey: "param" }`
- build-grouping tests
- model-grouping tests
- model-ports-derived tests
- serialisation round-trip and migration fixtures
- runtime tests that currently assert grouped direct-param bypass behavior

### UI Integration

First-class DSL authoring must surface in the existing inspect flow, not in a
separate standalone editor only.

#### Grouped-node inspect DSL section

When the selected node is a grouped node, the inspect window must include a new
DSL section.

That section should show:

- preserved authored DSL when the backing group has `dsl.mode = "authored"` and
  `syncStatus = "in-sync"`
- preserved authored DSL plus a visible stale warning when the backing group has
  `syncStatus = "stale"`
- generated canonical DSL when no authored source is stored

The grouped-node DSL section must expose:

- the current text content
- whether the content is authored or generated
- whether the content is in-sync or stale
- inline parser/lowering/layout errors from the most recent apply attempt

#### Grouped-node commit behavior

Applying grouped-node DSL edits must:

1. preserve the exact submitted source text
2. parse and lower the DSL through the canonical pipeline
3. reconcile the result against the existing referenced group definition
4. emit a model update through `updateGroup`
5. refresh the selected node's derived ports if the referenced group interface
   changed

If apply fails:

- the stored snapshot must remain unchanged
- the DSL section must keep the user's submitted text intact
- errors must surface inline in the inspect section and through diagnostics

#### Collapsed group-backed activity projection

When a `group` node or `code` node is shown in its collapsed editor form, the
UI must project runtime activity from the expanded compiled graph back onto the
visible collapsed representation.

Canonical behavior:

- travelling cable thumbs on visible top-level editor cables must remain
  truthful to the visible editor graph
- internal runtime activity inside a collapsed group-backed node must not
  disappear visually just because it occurs on compiled internal nodes or
  compiled internal edges
- collapsed `group` and `code` nodes must visibly show internal pulse activity
  even when that activity is filtered or transformed before reaching an exposed
  outlet

Canonical non-goal:

- the UI must not fake ordinary top-level cable thumbs for pulses that travel
  only on hidden internal compiled edges

Recommended presentation model:

- runtime keeps tracking activity on the compiled graph
- a projection step maps compiled activity onto visible editor entities
- visible top-level edges receive only the activity that truly maps onto those
  edges
- collapsed group-backed nodes receive aggregated internal activity for node
  pulse visuals and any future collapsed transit visuals

This projection model must work generically for:

- ordinary grouped nodes
- `code` nodes
- nested groups
- future collapsed abstraction node types

Recommended implementation direction:

- phase 1 projects internal compiled node pulse activity back onto the owning
  collapsed visible node
- phase 2 introduces a broader compiled-activity to visible-activity
  presentation mapping for thumbs, node pulses, and any future port or transit
  indicators

The canonical visual expectation for a collapsed group-backed node is:

- if pulses are still reaching a visible top-level output cable, that cable
  still shows travelling thumbs
- if pulses continue to move internally but do not currently reach a visible
  top-level cable, the collapsed node still shows internal activity rather than
  appearing dead
  - this may be via node pulse animation and later may include projected port or
    collapsed transit indicators

### Code Node Plan

A first-class DSL system should also support a dedicated authored patch node
surface through a new user-visible node type: `code`.

#### User-facing behavior

The `code` node should:

- appear as a distinct node type in the palette
- expose an editable source field in the inspect window
- commit on `Enter`
- allow `Shift+Enter` to insert a newline in the source field
- update its visible ports immediately after a successful parse/lower/apply

Canonical inspect behavior for `code` nodes:

- the inspect section is the primary authoring surface
- it shows the preserved exact DSL source for that code-authored node
- apply errors remain attached to that node's inspect section until resolved

#### Recommended implementation model

The recommended implementation model is:

- `code` is a first-class node type in the registry and UI
- each `code` node owns a private generated backing group definition
- that backing group definition lives in the same `graph.groups` library as
  ordinary user-defined groups
- the private backing group id should be deterministic from the owning node id,
  for example `__code__${nodeId}`
- the persisted node record should carry `type: "code"` and `groupRef` pointing
  at that private backing group id
- the `code` node's ports are derived from that private backing group
- build/routing/runtime should treat `code` as a dynamic custom-layout node that
  expands through its backing group definition, just like a group-derived node
- the exact authored DSL source for the node should be stored on the private
  backing `GroupDefinition.dsl`, not duplicated as a second source-of-truth on
  the node record itself

Recommended ownership rule:

- one `code` node owns one private backing group definition
- that private backing group is not shared across multiple `code` nodes unless a
  future explicit clone/share feature is added

This keeps the execution path unified:

- authored source -> semantic IR -> generated backing group definition
- dynamic node ports derive from the backing group interface
- downstream build/runtime continue to operate on canonical snapshot/group data

#### Relationship to standard grouped-node DSL flow

`code` node authoring should use the same canonical pipeline as grouped-node DSL
editing:

- exact source preservation
- parse/lower through semantic IR
- deterministic layout generation for brand-new authored content
- reconciliation for subsequent edits
- canonical `controlSlot` group control mappings

The main difference is ownership:

- grouped-node DSL edits target an existing shared `GroupDefinition`
- `code` node DSL edits target a private backing group owned by one node

### Error Categories

Implementation should use distinct DSL-facing error families so failures are
debuggable without mixing them into unrelated build/runtime errors.

Recommended categories:

- `DSL_PARSE_*`
  - lexical and grammar failures
- `DSL_LOWER_*`
  - semantic lowering failures such as invalid `$n`, duplicate outlets, invalid
    control targets, or impossible interface shapes
- `DSL_LAYOUT_*`
  - failures while generating positions, routes, or satisfying explicit
    distances
- `DSL_RECONCILE_*`
  - failures while matching authored edits onto an existing group
- `DSL_MIGRATE_*`
  - warnings or errors while normalizing legacy `paramKey` data into
    `controlSlot`

Grouped-node and code-node inspect UI should surface these diagnostics directly,
while the diagnostics console may also mirror them.

### Fixture And Test Matrix

The migration is not implementation-ready until the following fixture coverage
exists.

#### Export and import fixtures

- simple single-stream chain
- stored param only
- stored param plus live control
- mux split
- demux merge
- switch routing
- simple recursive cycle
- explicit-wire fallback
- nested-group expansion

#### Migration fixtures

- legacy `paramKey` group control mapping normalizes to `controlSlot`
- child-group `controlSlot` forwarding remains valid
- canonical serializer emits `controlSlot` only
- grouped direct-param bypass behavior is removed from canonical execution tests

#### Layout and reconciliation fixtures

- brand-new DSL-authored group receives deterministic positions
- brand-new DSL-authored group receives deterministic manual corners
- explicit `<n>` distances are satisfied when feasible
- infeasible `<n>` raises a layout error
- editing an existing group preserves matched node ids
- editing an existing group preserves matched edge ids where possible
- partial relayout affects only changed regions when feasible

#### UI fixtures

- grouped-node inspect tab shows authored in-sync DSL
- grouped-node inspect tab shows generated DSL when no authored source exists
- grouped-node inspect tab shows stale warning without overwriting authored
  source
- grouped-node DSL apply updates the referenced group through model ops
- `code` node inspect editing commits on `Enter`
- `code` node supports newline insertion via `Shift+Enter`
- `code` node ports update after successful apply
- `code` node apply errors stay local to the node and do not mutate snapshot

### Acceptance Criteria

The migration plan is complete only when another agent can implement all of the
following from this document:

- deterministic exporter from stored group definitions to canonical DSL
- deterministic importer/lowerer from canonical DSL to `GroupDefinition`
- exact authored DSL source preservation with `mode` and `syncStatus`
- deterministic initial layout generation for DSL-authored groups
- reconciliation for edits to existing groups
- canonical `controlSlot` group control storage and lowering
- grouped-node inspect DSL UI behavior
- first-class `code` node authoring behavior
- fixture coverage for export, import, migration, layout, reconciliation, and
  UI integration

Canonical done condition:

- no remaining canonical path depends on grouped direct-param virtual targets
- canonical save/export emits `controlSlot` mappings only
- authored DSL comments and formatting are preserved exactly when source is
  stored
- grouped-node and code-node DSL editing can fail safely without mutating stored
  snapshot state
