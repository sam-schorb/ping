import test from "node:test";
import assert from "node:assert/strict";

import {
  NODE_REGISTRY,
  buildRegistryIndex,
  getNodeDefinition,
  validateRegistry,
} from "../src/index.js";

test("NODE_REGISTRY includes the complete built-in node set and validates cleanly", () => {
  const types = NODE_REGISTRY.map((definition) => definition.type);

  assert.deepEqual(types, [
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
    "gtp",
    "ltp",
    "gtep",
    "ltep",
    "match",
    "group",
    "code",
  ]);

  const result = validateRegistry(NODE_REGISTRY);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test("buildRegistryIndex and getNodeDefinition expose registry lookup helpers", () => {
  const index = buildRegistryIndex();
  const pulse = getNodeDefinition("pulse", index);
  const group = getNodeDefinition("group", index);
  const code = getNodeDefinition("code", index);
  const out = getNodeDefinition("out", index);
  const gtep = getNodeDefinition("gtep", index);
  const ltep = getNodeDefinition("ltep", index);

  assert.equal(index.size, NODE_REGISTRY.length);
  assert.equal(pulse?.label, "Pulse");
  assert.equal(out?.label, "Out");
  assert.equal(code?.label, "Code");
  assert.equal(gtep?.label, "Greater Than Equal");
  assert.equal(gtep?.canvasLabel, "GTE");
  assert.equal(ltep?.label, "Less Than Equal");
  assert.equal(ltep?.canvasLabel, "LTE");
  assert.equal(group?.layout, "custom");
  assert.equal(group?.hidden, true);
  assert.equal(code?.layout, "custom");
  assert.equal(code?.hidden, false);
  assert.equal(getNodeDefinition("output", index)?.type, "out");
  assert.equal(getNodeDefinition("multiplexer", index)?.type, "mux");
  assert.equal(getNodeDefinition("demultiplexer", index)?.type, "demux");
  assert.equal(getNodeDefinition("does-not-exist", index), undefined);
});

test("registry metadata keeps effect param maps aligned with audio-facing metadata expectations", () => {
  const pitch = getNodeDefinition("pitch");
  const decay = getNodeDefinition("decay");
  const crush = getNodeDefinition("crush");
  const hpf = getNodeDefinition("hpf");
  const lpf = getNodeDefinition("lpf");

  assert.deepEqual(pitch?.paramMap, {
    param: {
      target: "speed",
      mapping: "pitchTable",
      unit: "ratio",
    },
  });
  assert.deepEqual(decay?.paramMap, {
    param: {
      target: "end",
      mapping: "endTable",
      unit: "ratio",
    },
  });
  assert.deepEqual(crush?.paramMap, {
    param: {
      target: "crush",
      mapping: "crushTable",
      unit: "bits",
    },
  });
  assert.deepEqual(hpf?.paramMap, {
    param: {
      target: "hpf",
      mapping: "hpfTable",
      unit: "hz",
    },
  });
  assert.deepEqual(lpf?.paramMap, {
    param: {
      target: "lpf",
      mapping: "lpfTable",
      unit: "hz",
    },
  });
});
