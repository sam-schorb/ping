# ping

Ping is a browser-based node sequencer. You build patches out of boxes and cables; pulses travel along the cables, and cable distance is part of the timing.

When a pulse reaches an `out` node it triggers one of eight sample slots. The fun of it is that the patch is also the score: move a cable, change a route, group a few nodes, and the rhythm changes with it.

This is the working repo for the app. It is usable, but it is not a packaged library or a stable public API yet.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The web app syncs Dough's browser assets before dev and build. Dough uses `SharedArrayBuffer`, so the Next app serves the COOP/COEP headers needed for cross-origin isolation.

## Tests

```bash
npm test
```

That runs the package test scripts across the workspace.

## What is in the repo

- `apps/web` is the Next.js app.
- `packages/core` has the graph model, node registry, routing, runtime, serialisation, DSL, and Dough audio bridge.
- `packages/ui` has the canvas editor, panels, controls, and React wrapper.

## How the patch works

Add nodes from the sidebar, connect ports, and start the transport. Pulses move between nodes as small travelling thumbs.

The graph is tick-based. Routing and delay are tied together: the length of a cable route becomes the delay for pulses travelling along it. Tempo only changes how ticks map to seconds at the audio boundary.

Pulse values are `1..8`. Nodes can split, merge, filter, count, randomise, compare, change speed, write sample parameters, or send a pulse to an output. The `out` node consumes a pulse and uses its value to choose a sample slot.

## Code nodes

Code nodes use a small DSL for describing the inside of a group-like node. The app has an in-panel guide, but the basic shape is:

```txt
$0.every(2).count(4).outlet(0)
```

Read it left to right: take boundary input `$0`, pass every second pulse, count up to four, then expose the result as output `0`.

## License

AGPL-3.0. See [LICENSE](LICENSE).
