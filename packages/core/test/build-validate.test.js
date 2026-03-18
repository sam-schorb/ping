import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGraph,
  getLayout,
  getNodeDefinition,
  validateGraph,
} from "../src/index.js";
import { loadBuildFixture } from "./helpers/build-fixtures.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createDelays(entries) {
  return new Map(entries);
}

function createPortMismatchRegistry() {
  return {
    getNodeDefinition,
    getLayout(layout, inputs, outputs, controlPorts) {
      if (layout === "single-io-control" && inputs === 1 && outputs === 1 && controlPorts === 1) {
        return {
          inputs: [{ role: "signal", index: 0 }],
          outputs: [{ role: "signal", index: 0 }],
        };
      }

      return getLayout(layout, inputs, outputs, controlPorts);
    },
  };
}

function createRoleMismatchRegistry() {
  return {
    getNodeDefinition,
    getLayout(layout, inputs, outputs, controlPorts) {
      const resolved = getLayout(layout, inputs, outputs, controlPorts);

      if (layout === "multi-out-6-control") {
        return {
          inputs: [
            { ...resolved.inputs[0] },
            { ...resolved.inputs[1], role: "signal" },
          ],
          outputs: resolved.outputs.map((port) => ({ ...port })),
        };
      }

      return resolved;
    },
  };
}

test("validateGraph and buildGraph surface the expected BUILD_* diagnostics", async () => {
  const cases = [
    {
      fixture: "invalid-unknown-type.json",
      code: "BUILD_UNKNOWN_NODE_TYPE",
      registry,
      delays: createDelays([["edge-a", 1]]),
    },
    {
      fixture: "invalid-port-mismatch.json",
      code: "BUILD_PORT_COUNT_MISMATCH",
      registry: createPortMismatchRegistry(),
      delays: createDelays([["edge-a", 1]]),
    },
    {
      fixture: "invalid-role-compat.json",
      code: "BUILD_ROLE_MISMATCH",
      registry: createRoleMismatchRegistry(),
      delays: createDelays([
        ["edge-control", 1],
        ["edge-out", 1],
      ]),
    },
    {
      fixture: "invalid-same-direction.json",
      code: "BUILD_SAME_DIRECTION",
      registry,
      delays: createDelays([["edge-a", 1]]),
    },
    {
      fixture: "invalid-one-cable-per-port.json",
      code: "BUILD_PORT_ALREADY_CONNECTED",
      registry,
      delays: createDelays([
        ["edge-a", 1],
        ["edge-b", 1],
      ]),
    },
    {
      fixture: "invalid-missing-delay.json",
      code: "BUILD_MISSING_DELAY",
      registry,
      delays: createDelays([]),
    },
    {
      fixture: "invalid-dangling-port.json",
      code: "BUILD_DANGLING_PORT",
      registry,
      delays: createDelays([["edge-dangling", 1]]),
    },
    {
      fixture: "invalid-group-mapping.json",
      code: "BUILD_GROUP_MAPPING_INVALID",
      registry,
      delays: createDelays([["inner-edge", 1]]),
    },
  ];

  for (const testCase of cases) {
    const fixture = await loadBuildFixture(testCase.fixture);
    const validation = validateGraph(fixture, testCase.registry, testCase.delays);
    const build = buildGraph(fixture, testCase.registry, testCase.delays);

    assert.equal(validation.ok, false, testCase.fixture);
    assert.equal(build.ok, false, testCase.fixture);
    assert.equal(build.graph, undefined, testCase.fixture);
    assert.ok(
      validation.errors.some((issue) => issue.code === testCase.code),
      testCase.fixture,
    );
    assert.ok(
      build.errors.some((issue) => issue.code === testCase.code),
      testCase.fixture,
    );
  }
});
