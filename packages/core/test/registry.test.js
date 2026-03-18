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
    "output",
    "mux",
    "demux",
    "switch",
    "block",
    "add",
    "sub",
    "set",
    "const1",
    "const2",
    "const3",
    "const4",
    "const5",
    "const6",
    "const7",
    "const8",
    "speed",
    "pitch",
    "decay",
    "crush",
    "hpf",
    "lpf",
    "every",
    "random",
    "counter",
    "gtp",
    "ltp",
    "gtep",
    "ltep",
    "match",
    "group",
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

  assert.equal(index.size, NODE_REGISTRY.length);
  assert.equal(pulse?.label, "Pulse");
  assert.equal(group?.layout, "custom");
  assert.equal(group?.hidden, true);
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
