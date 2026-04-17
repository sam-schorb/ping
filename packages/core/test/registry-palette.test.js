import test from "node:test";
import assert from "node:assert/strict";

import { buildPalette } from "../src/index.js";

test("buildPalette returns a stable visible palette order with required UI fields", () => {
  const palette = buildPalette();
  const paletteTypes = palette.map((item) => item.type);

  assert.deepEqual(paletteTypes, [
    "pulse",
    "out",
    "mux",
    "demux",
    "switch",
    "block",
    "add",
    "sub",
    "set",
    "speed",
    "pitch",
    "decay",
    "crush",
    "hpf",
    "lpf",
    "every",
    "drop",
    "random",
    "count",
    "step",
    "gtp",
    "ltp",
    "gtep",
    "ltep",
    "match",
    "code",
  ]);

  assert.equal(palette.some((item) => item.type === "group"), false);
  assert.equal(palette.some((item) => item.type === "code"), true);

  for (const item of palette) {
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.description, "string");
    assert.equal(typeof item.category, "string");
    assert.equal(typeof item.icon, "string");
    assert.equal(typeof item.color, "string");
    assert.equal(typeof item.layout, "string");
    assert.equal(typeof item.inputs, "number");
    assert.equal(typeof item.outputs, "number");
    assert.equal(typeof item.controlPorts, "number");
    assert.equal(typeof item.hasParam, "boolean");
  }
});
