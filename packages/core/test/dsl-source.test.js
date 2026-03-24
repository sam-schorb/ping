import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  CURRENT_GROUP_DSL_FORMAT_VERSION,
  computeGroupDslSemanticHash,
  GraphModel,
  getLayout,
  getNodeDefinition,
  lowerGroupDsl,
} from "../src/index.js";

const registry = {
  getNodeDefinition,
  getLayout,
};

function createModel(snapshot) {
  return new GraphModel({ getNodeDefinition, snapshot });
}

test("lowerGroupDsl preserves exact authored source bytes and comments in group.dsl", () => {
  const source = "// $0 = trigger\r\n\r\n$0.every(2).outlet(0)\r\n";
  const result = lowerGroupDsl(source, registry, {
    groupId: "group-authored-source",
  });

  assert.equal(result.ok, true);
  assert.equal(result.group.dsl.source, source);
  assert.equal(result.group.dsl.formatVersion, CURRENT_GROUP_DSL_FORMAT_VERSION);
  assert.equal(result.group.dsl.mode, "authored");
  assert.equal(result.group.dsl.syncStatus, "in-sync");
  assert.match(result.group.dsl.lastAppliedSemanticHash, /^[0-9a-f]{40}$/u);
});

test("lowerGroupDsl supports generated source mode while preserving exact text", () => {
  const source = "// generated\n$0.every(2).outlet(0)";
  const result = lowerGroupDsl(source, registry, {
    groupId: "group-generated-source",
    dslMode: "generated",
  });

  assert.equal(result.ok, true);
  assert.equal(result.group.dsl.source, source);
  assert.equal(result.group.dsl.mode, "generated");
  assert.equal(result.group.dsl.syncStatus, "in-sync");
});

test("computeGroupDslSemanticHash matches the canonical SHA-1 payload", () => {
  const source = "$0.every(2).outlet(0)";
  const lowered = lowerGroupDsl(source, registry, {
    groupId: "group-semantic-hash",
  });

  assert.equal(lowered.ok, true);

  const result = computeGroupDslSemanticHash(lowered.group, registry);

  assert.equal(result.ok, true);
  assert.equal(
    result.hash,
    createHash("sha1")
      .update(
        JSON.stringify({
          preserveInternalCableDelays: false,
          dsl: source,
        }),
      )
      .digest("hex"),
  );
});

test("updateGroup preserves authored DSL source and marks it stale after non-DSL mutation", () => {
  const source = "// $0 = trigger\n$0.every(2).outlet(0)";
  const lowered = lowerGroupDsl(source, registry, {
    groupId: "group-stale-transition",
    groupName: "Stale Transition Group",
  });

  assert.equal(lowered.ok, true);

  const model = createModel({
    nodes: [],
    edges: [],
    groups: {
      [lowered.group.id]: lowered.group,
    },
  });
  const previousDsl = model.getSnapshot().groups[lowered.group.id].dsl;
  const { dsl, ...groupWithoutDsl } = lowered.group;
  const result = model.applyOps([
    {
      type: "updateGroup",
      payload: {
        group: {
          ...groupWithoutDsl,
          graph: {
            ...groupWithoutDsl.graph,
            nodes: groupWithoutDsl.graph.nodes.map((node) =>
              node.id === "node-1"
                ? {
                    ...node,
                    params: {
                      ...node.params,
                      param: 4,
                    },
                  }
                : node,
            ),
          },
        },
      },
    },
  ]);

  assert.deepEqual(result, { ok: true, changed: true });

  const updatedGroup = model.getSnapshot().groups[lowered.group.id];

  assert.equal(updatedGroup.dsl.source, source);
  assert.equal(updatedGroup.dsl.mode, "authored");
  assert.equal(updatedGroup.dsl.syncStatus, "stale");
  assert.equal(
    updatedGroup.dsl.lastAppliedSemanticHash,
    previousDsl.lastAppliedSemanticHash,
  );
});

test("updateGroup keeps preserved DSL in-sync when semantics stay unchanged", () => {
  const source = "$0.every(2).outlet(0)";
  const lowered = lowerGroupDsl(source, registry, {
    groupId: "group-in-sync-transition",
  });

  assert.equal(lowered.ok, true);

  const model = createModel({
    nodes: [],
    edges: [],
    groups: {
      [lowered.group.id]: lowered.group,
    },
  });
  const { dsl, ...groupWithoutDsl } = lowered.group;
  const result = model.applyOps([
    {
      type: "updateGroup",
      payload: {
        group: {
          ...groupWithoutDsl,
        },
      },
    },
  ]);

  assert.deepEqual(result, { ok: true, changed: true });

  const updatedGroup = model.getSnapshot().groups[lowered.group.id];

  assert.equal(updatedGroup.dsl.source, source);
  assert.equal(updatedGroup.dsl.syncStatus, "in-sync");
});
