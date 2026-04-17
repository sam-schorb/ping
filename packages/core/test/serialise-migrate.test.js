import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_SCHEMA_VERSION,
  parseProject,
  serialiseProject,
} from "../src/index.js";
import { loadSerialisationFixtureJSON } from "./helpers/serialisation-fixtures.js";

test("legacy top-level groups migrate into graph.groups with a migration warning", async () => {
  const fixture = await loadSerialisationFixtureJSON("legacy-groups-top-level.json");
  const parsed = parseProject(fixture);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].code, "SERIAL_VERSION_MIGRATED");
  assert.deepEqual(Object.keys(parsed.project.graph.groups), ["group-a"]);
  assert.deepEqual(parsed.project.graph.groups["group-a"].controls, [
    { nodeId: "inner-pulse", controlSlot: 0 },
  ]);

  const canonical = serialiseProject(parsed.project);

  assert.equal(canonical.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal("groups" in canonical, false);
  assert.ok(canonical.graph.groups["group-a"]);
  assert.deepEqual(canonical.graph.groups["group-a"].controls, [
    { nodeId: "inner-pulse", controlSlot: 0 },
  ]);
});

test("missing schemaVersion without top-level groups still migrates to the current schema", () => {
  const parsed = parseProject({
    graph: {
      nodes: [],
      edges: [],
    },
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.warnings.length, 1);
  assert.equal(parsed.warnings[0].code, "SERIAL_VERSION_MIGRATED");
  assert.equal(serialiseProject(parsed.project).schemaVersion, CURRENT_SCHEMA_VERSION);
});

test("blank sample paths fall back to canonical defaults with a warning", () => {
  const parsed = parseProject({
    schemaVersion: 1,
    graph: {
      nodes: [],
      edges: [],
    },
    samples: [
      { id: "1", path: "/kits/default/kick.wav" },
      { id: "2", path: "/kits/default/snare.wav" },
      { id: "3", path: "/kits/default/hat-closed.wav" },
      { id: "4", path: "/kits/default/hat-open.wav" },
      { id: "5", path: "/kits/default/clap.wav" },
      { id: "6", path: "" },
      { id: "7", path: "/kits/default/tom-mid.wav" },
      { id: "8", path: "/kits/default/tom-high.wav" }
    ]
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.warnings.map((warning) => warning.code),
    ["SERIAL_INVALID_SLOT"],
  );
  assert.equal(parsed.project.samples[5].path, "/samples/chirp1.mp3");
});

test("legacy multiplexer and demultiplexer node types canonicalize to mux and demux", () => {
  const parsed = parseProject({
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: "node-mux",
          type: "multiplexer",
          pos: { x: 0, y: 0 },
          rot: 0,
          params: {},
        },
        {
          id: "node-demux",
          type: "demultiplexer",
          pos: { x: 6, y: 0 },
          rot: 0,
          params: {},
        },
      ],
      edges: [],
    },
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.project.graph.nodes.map((node) => node.type),
    ["mux", "demux"],
  );

  const canonical = serialiseProject(parsed.project);

  assert.deepEqual(
    canonical.graph.nodes.map((node) => node.type),
    ["mux", "demux"],
  );
});
