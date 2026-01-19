# Graph DSL (Deferred / Future Option)

## Purpose
A **read‑only, Hydra‑style graph DSL** derived from the canonical JSON.  
**This DSL is deferred** and is not part of the initial implementation scope. It remains
an option for a later phase of development.

## Core conventions

### Signal vs control
- **Signal** = the chain (left‑to‑right).
- **Control** = the argument expression(s) of the node call.

This makes control explicit through structure, without special keywords.

### No literals
- Numeric literals are **not** used in the DSL.
- Fixed values are built using **const nodes**.

### Aliases
- `p()` is shorthand for `pulse()`.
- `kN()` is shorthand for `constN()` (e.g., `k6()` → `const6()`).

### Demux / fan‑in stream blocks
- Multiple streams can be declared as a **block** of lines.
- Lines are terminated with `;` **except the last line** in the block.
- A trailing `.demux().output()` applies to the **immediately preceding block**.

Example:
```js
pulse().const1().add( pulse().const2() ).crush( pulse().const4() );
pulse().const3().sub( pulse().const1() ).hpf( pulse().const5() )
.demux().output()

pulse().const2().set( pulse().const6() ).lpf( pulse().const3() ).decay( pulse().const4() ).output()
```

---

## Node reference (order matches node behavior table)

### pulse
`pulse()` emits periodically at the **global base rate**. Control input sets its output value.

```js
pulse()
  .set( pulse().const4() )
  .output()
```

### output
`output()` consumes pulses and triggers audio events. Pulse value selects sample slot **1–8**;
pulse params are applied as effects.

```js
pulse()
  .set( pulse().const3() )
  .crush( pulse().const4() )
  .output()
```

### multiplexer (mux)
Use a Hydra‑style `mux(...)` that accepts **branch chains**. Each branch implicitly receives
the parent signal.

```js
pulse().const2()
  .mux(
    add( pulse().const2() ).crush( pulse().const4() ).output(),
    sub( pulse().const1() ).hpf( pulse().const5() ).output(),
    set( pulse().const6() ).lpf( pulse().const3() ).decay( pulse().const4() ).output()
  )
```

**Outputs**
- `mux(...)` creates **parallel branches**.
- Branches may terminate at `output()` or continue and later merge.

### demultiplexer (demux)
Use `.demux().output()` on a stream block to merge multiple streams into one.

```js
pulse().const1().add( pulse().const2() ).crush( pulse().const4() );
pulse().const3().sub( pulse().const1() ).hpf( pulse().const5() )
.demux().output()
```

### add
`add(control)` adds the control value to the signal value.

```js
pulse()
  .add( pulse().const2() )
  .output()
```

### sub
`sub(control)` subtracts the control value from the signal value.

```js
pulse()
  .sub( pulse().const3() )
  .output()
```

### set
`set(control)` overwrites the signal value with the control value.

```js
pulse()
  .set( pulse().const5() )
  .output()
```

### const1–const8 (aliases: k1()..k8())
Fixed‑value constants. Ignore input value and output **N** (1–8).

```js
pulse()
  .const3()
  .output()
```

Alias:
```js
p().k3().output()
```

### speed
`speed(control)` passes the signal and sets `pulse.speed`.

```js
pulse()
  .speed( pulse().const3() )
  .output()
```

### decay
`decay(control)` passes the signal and sets `pulse.params.decay`.

```js
pulse()
  .decay( pulse().const5() )
  .output()
```

### crush
`crush(control)` passes the signal and sets `pulse.params.crush`.

```js
pulse()
  .crush( pulse().const4() )
  .output()
```

### hpf
`hpf(control)` passes the signal and sets `pulse.params.hpf`.

```js
pulse()
  .hpf( pulse().const6() )
  .output()
```

### lpf
`lpf(control)` passes the signal and sets `pulse.params.lpf`.

```js
pulse()
  .lpf( pulse().const2() )
  .output()
```

### switch
`switch(control, branch1, branch2, ...)` routes the pulse to **one** branch
based on the control value. If you need a single stream after routing, call `.demux()`.

```js
pulse().const2()
  .switch(
    pulse().const6(),
    add( pulse().const2() ).crush( pulse().const4() ),
    sub( pulse().const1() ).hpf( pulse().const5() ),
    set( pulse().const6() ).lpf( pulse().const3() )
  )
  .demux().output()
```

### block
`block(control)` passes the pulse if control is **even**; blocks if **odd**.

```js
pulse()
  .block( pulse().const2() )
  .output()
```

### every
`every(control)` passes every Nth pulse; drops others.

```js
pulse()
  .every( pulse().const2().add( pulse().const1() ) )
  .output()
```

### random
`random(control)` outputs a random integer in **1..N** per pulse.

```js
pulse()
  .random( pulse().const8() )
  .output()
```

### counter
`counter(control)` increments count on each pulse and outputs current count.
Control sets reset value.

```js
pulse()
  .counter( pulse().const8() )
  .output()
```

### gtp
`gtp(control)` passes if `in.value > control`.

```js
pulse()
  .gtp( pulse().const4() )
  .output()
```

### ltp
`ltp(control)` passes if `in.value < control`.

```js
pulse()
  .ltp( pulse().const4() )
  .output()
```

### gtep
`gtep(control)` passes if `in.value >= control`.

```js
pulse()
  .gtep( pulse().const4() )
  .output()
```

### ltep
`ltep(control)` passes if `in.value <= control`.

```js
pulse()
  .ltep( pulse().const4() )
  .output()
```

### match
`match(control)` passes if `in.value == control`.

```js
pulse()
  .match( pulse().const2().add( pulse().const1() ) )
  .output()
```

---

## Open items
- Full DSL syntax (comments, whitespace rules, grouping edge cases).
- Formatting/ordering rules for deterministic output.

## Open design issue: selective merge after mux

### The problem
With a purely chained, Hydra‑style syntax, it’s easy to **split** a stream with `mux(...)`,
but harder to **select and re‑merge only some branches** without introducing references.
The current DSL does not have a clean way to say “merge branches 0, 2, and 4, but leave the others separate.”

### Proposed solution: bundle / tuple mode
Allow mux to return a **bundle** that can be **indexed** and passed to `demux(...)` directly.

This requires three additions to the DSL:
1) **Bindings**: `b = expr` to name a bundle (or stream).
2) **Indexing**: `b[0]`, `b[1]` to select branches.
3) **Fan‑in demux function**: `demux(a, b, c)` merges the selected streams.

### Example
```js
b = pulse().const2().mux(
  add( pulse().const1() ).crush( pulse().const4() ),
  sub( pulse().const1() ).hpf( pulse().const5() ),
  set( pulse().const6() ).lpf( pulse().const3() ),
  add( pulse().const2() ).decay( pulse().const4() ),
  sub( pulse().const2() ).crush( pulse().const3() ),
  set( pulse().const5() ).hpf( pulse().const4() )
)

demux( b[0], b[1], b[2] ).output()
demux( b[3], b[4] ).output()

b[5].mux(
  add( pulse().const1() ).output(),
  sub( pulse().const1() ).output(),
  set( pulse().const6() ).output()
)
```

### Status
This is a **candidate extension** to solve selective merge. It is not yet locked in.

## Alternative candidate: tuple bundles inside mux

Borrowing from bundle/tuple patterns (Faust/Arrows/juxt), allow a **tuple bundle**
inside a `mux(...)` branch, then immediately `.demux()` it into a single stream.
This enables “merge some branches, not others” **without variables**.

### Example
```js
pulse().const2()
  .mux(
    ( // merge 3 branches into one
      add( pulse().const1() ).crush( pulse().const4() ),
      sub( pulse().const1() ).hpf( pulse().const5() ),
      set( pulse().const6() ).lpf( pulse().const3() )
    ).demux().output(),

    ( // merge 2 branches into one
      add( pulse().const2() ).decay( pulse().const4() ),
      sub( pulse().const2() ).crush( pulse().const3() )
    ).demux().output(),

    // remaining branch splits again
    set( pulse().const5() )
      .hpf( pulse().const4() )
      .mux(
        add( pulse().const1() ).output(),
        sub( pulse().const1() ).output(),
        set( pulse().const6() ).output()
      )
  )
```

**Status:** candidate only (not locked in).
