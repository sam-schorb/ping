import test from "node:test";
import assert from "node:assert/strict";

import {
  parseProject,
  serialiseProject,
} from "../src/index.js";
import {
  loadSerialisationFixtureJSON,
  loadSerialisationFixtureText,
} from "./helpers/serialisation-fixtures.js";

test("malformed JSON strings fail with SERIAL_PARSE_ERROR", async () => {
  const fixture = await loadSerialisationFixtureText("invalid-json.txt");
  const parsed = parseProject(fixture);

  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.errors.map((issue) => issue.code), [
    "SERIAL_PARSE_ERROR",
  ]);
});

test("invalid fixtures fail with the expected SERIAL_* codes", async () => {
  const cases = [
    ["invalid-schema.json", "SERIAL_INVALID_SCHEMA"],
    ["invalid-unknown-type.json", "SERIAL_UNKNOWN_NODE_TYPE"],
    ["invalid-edge.json", "SERIAL_INVALID_EDGE"],
    ["invalid-slot.json", "SERIAL_INVALID_SLOT"],
    ["future-version.json", "SERIAL_VERSION_UNSUPPORTED"],
  ];

  for (const [fixtureName, expectedCode] of cases) {
    const fixture = await loadSerialisationFixtureJSON(fixtureName);
    const parsed = parseProject(fixture);

    assert.equal(parsed.ok, false, fixtureName);
    assert.equal(parsed.errors[0]?.code, expectedCode, fixtureName);
  }
});

test("serialiseProject throws when asked to persist invalid graph data", () => {
  assert.throws(
    () =>
      serialiseProject({
        graph: {
          nodes: [
            {
              id: "node-pulse",
              type: "pulse",
              pos: { x: 0, y: 0 },
              rot: 0,
              params: {},
            },
          ],
          edges: [
            {
              id: "edge-bad",
              from: { nodeId: "node-pulse", portSlot: 0 },
              to: { nodeId: "missing-node", portSlot: 0 },
              manualCorners: [],
            },
          ],
        },
      }),
    (error) => error?.name === "SerialisationError" && error?.code === "SERIAL_INVALID_EDGE",
  );
});
