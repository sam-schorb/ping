import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_TEMPO_BPM,
  createDefaultSampleSlots,
  parseProject,
  serialiseProject,
} from "../src/index.js";
import { loadSerialisationFixtureJSON } from "./helpers/serialisation-fixtures.js";

test("valid fixtures parse and serialise into stable canonical project JSON", async () => {
  const fixtureNames = ["valid-min.json", "valid-groups.json", "valid-slots.json"];

  for (const fixtureName of fixtureNames) {
    const fixture = await loadSerialisationFixtureJSON(fixtureName);
    const parsed = parseProject(fixture);

    assert.equal(parsed.ok, true, fixtureName);
    assert.deepEqual(parsed.errors, [], fixtureName);

    const canonical = serialiseProject(parsed.project);
    const reparsed = parseProject(canonical);
    const canonicalAgain = serialiseProject(reparsed.project);

    assert.equal(canonical.schemaVersion, CURRENT_SCHEMA_VERSION, fixtureName);
    assert.deepEqual(reparsed.errors, [], fixtureName);
    assert.deepEqual(canonicalAgain, canonical, fixtureName);
  }
});

test("serialiseProject preserves graph ordering while filling canonical defaults", async () => {
  const fixture = await loadSerialisationFixtureJSON("valid-min.json");
  const parsed = parseProject(fixture);
  const canonical = serialiseProject(parsed.project);

  assert.deepEqual(
    canonical.graph.nodes.map((node) => node.id),
    ["node-pulse", "node-output"],
  );
  assert.deepEqual(
    canonical.graph.edges.map((edge) => edge.id),
    ["edge-a"],
  );
  assert.deepEqual(canonical.samples, createDefaultSampleSlots());
  assert.deepEqual(canonical.settings, { tempo: DEFAULT_TEMPO_BPM });
});

test("default sample slots follow the bundled public kit order", () => {
  assert.deepEqual(
    createDefaultSampleSlots().map((slot) => slot.path),
    [
      "/samples/kick1.mp3",
      "/samples/snare1.mp3",
      "/samples/tom1.mp3",
      "/samples/clap1.mp3",
      "/samples/rim1.mp3",
      "/samples/chirp1.mp3",
      "/samples/c-hat1.mp3",
      "/samples/o-hat1.mp3",
    ],
  );
});

test("serialiseProject strips derived and UI-only state instead of persisting it", () => {
  const serialised = serialiseProject({
    graph: {
      nodes: [
        {
          id: "node-pulse",
          type: "pulse",
          pos: { x: 0, y: 0 },
          rot: 0,
          params: {},
          ports: [{ id: "derived" }],
          selected: true,
        },
      ],
      edges: [
        {
          id: "edge-a",
          from: { nodeId: "node-pulse", portSlot: 0 },
          to: { nodeId: "node-pulse", portSlot: 0 },
          manualCorners: [],
          routedPoints: [{ x: 1, y: 1 }],
        },
      ],
      camera: { x: 10, y: 20 },
    },
    samples: createDefaultSampleSlots(),
    settings: { tempo: 128 },
  });

  assert.deepEqual(Object.keys(serialised), [
    "schemaVersion",
    "graph",
    "samples",
    "settings",
  ]);
  assert.equal("ports" in serialised.graph.nodes[0], false);
  assert.equal("selected" in serialised.graph.nodes[0], false);
  assert.equal("routedPoints" in serialised.graph.edges[0], false);
  assert.equal("camera" in serialised.graph, false);
});
