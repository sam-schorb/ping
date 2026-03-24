import test from "node:test";
import assert from "node:assert/strict";

import { lowerGroupDsl } from "@ping/core";

import { createEditorHarness, setupDom, TEST_REGISTRY } from "./helpers/harness.js";

function createGroupedNodeSnapshot(group) {
  return {
    nodes: [
      {
        id: "node-group",
        type: "group",
        groupRef: group.id,
        pos: { x: 4, y: 4 },
        rot: 0,
        params: {},
      },
    ],
    edges: [],
    groups: {
      [group.id]: group,
    },
  };
}

async function openGroupedNodeInspect(harness) {
  harness.click(harness.query("node-node-group"));
  await harness.flush();
  harness.click(harness.container.querySelector('[data-tab="inspect"]'));
  await harness.flush();
}

test("phase 8 grouped-node inspect shows authored DSL source and apply controls", async () => {
  const dom = setupDom();

  try {
    const source = "// authored\n$0.every(2).outlet(0)";
    const lowered = lowerGroupDsl(source, TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot(lowered.group),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    assert.equal(harness.query("inspect-name")?.value, "");
    assert.equal(harness.query("inspect-param"), null);
    assert.equal(harness.query("inspect-dsl-source")?.value, source);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /Authored source/i);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /in sync/i);
    assert.ok(harness.query("inspect-dsl-apply"));
    assert.ok(harness.query("inspect-dsl-reload"));

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 8 grouped-node inspect shows generated DSL when no preserved source exists", async () => {
  const dom = setupDom();

  try {
    const source = "$0.every(2).outlet(0)";
    const lowered = lowerGroupDsl(source, TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const { dsl, ...groupWithoutDsl } = lowered.group;
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot(groupWithoutDsl),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    assert.equal(harness.query("inspect-dsl-source")?.value, source);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /Generated source/i);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /in sync/i);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 8 grouped-node inspect shows stale preserved DSL after canvas-side group mutation", async () => {
  const dom = setupDom();

  try {
    const source = "$0.every(2).outlet(0)";
    const lowered = lowerGroupDsl(source, TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot(lowered.group),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    const currentGroup = harness.snapshot.groups["group-a"];
    harness.applyOps([
      {
        type: "updateGroup",
        payload: {
          group: {
            ...currentGroup,
            graph: {
              ...currentGroup.graph,
              nodes: currentGroup.graph.nodes.map((node) =>
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
    await harness.flush();

    assert.equal(harness.query("inspect-dsl-source")?.value, source);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /stale/i);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 8 grouped-node inspect regenerates pre-migration DSL source into the current canonical syntax", async () => {
  const dom = setupDom();

  try {
    const lowered = lowerGroupDsl("$0.every(2).outlet(0)", TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot({
        ...lowered.group,
        dsl: {
          ...lowered.group.dsl,
          source: "$0.every{2}.outlet(0)",
          formatVersion: 1,
          mode: "authored",
          syncStatus: "in-sync",
        },
      }),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    assert.equal(harness.query("inspect-dsl-source")?.value, "$0.every(2).outlet(0)");
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /Generated source/i);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 8 grouped-node inspect applies valid DSL edits and refreshes visible ports", async () => {
  const dom = setupDom();

  try {
    const initial = lowerGroupDsl("$0.every(2).outlet(0)", TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot(initial.group),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    const textarea = harness.query("inspect-dsl-source");
    const nextSource = ["m = $0.mux()", "m[0].outlet(0)", "m[1].outlet(1)"].join("\n");
    textarea.value = nextSource;
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("inspect-dsl-apply"));
    await harness.flush();

    assert.equal(harness.snapshot.groups["group-a"].outputs.length, 2);
    assert.equal(harness.snapshot.groups["group-a"].dsl?.source, nextSource);
    assert.equal(
      harness.container.querySelectorAll('[data-port-node-id="node-group"][data-port-direction="out"]').length,
      2,
    );
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /Authored source/i);
    assert.match(harness.query("inspect-dsl-status")?.textContent ?? "", /in sync/i);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("phase 8 grouped-node inspect keeps user text and snapshot state on failed DSL apply and shows diagnostics", async () => {
  const dom = setupDom();

  try {
    const initial = lowerGroupDsl("$0.every(2).outlet(0)", TEST_REGISTRY, {
      groupId: "group-a",
      groupName: "Group A",
    });
    const harness = createEditorHarness({
      snapshot: createGroupedNodeSnapshot(initial.group),
    });
    await harness.flush();

    await openGroupedNodeInspect(harness);

    const textarea = harness.query("inspect-dsl-source");
    const invalidSource = "$0.every(0).outlet(0)";
    const beforeGraphOpCount = harness.outputs.filter((output) => output.type === "graph/ops").length;

    textarea.value = invalidSource;
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    await harness.flush();

    harness.click(harness.query("inspect-dsl-apply"));
    await harness.flush();

    assert.equal(harness.query("inspect-dsl-source")?.value, invalidSource);
    assert.equal(harness.snapshot.groups["group-a"].dsl?.source, "$0.every(2).outlet(0)");
    assert.equal(
      harness.outputs.filter((output) => output.type === "graph/ops").length,
      beforeGraphOpCount,
    );
    assert.match(
      harness.query("inspect-dsl-diagnostic-0")?.textContent ?? "",
      /DSL_LOWER_INVALID_PARAM_BLOCK/i,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
