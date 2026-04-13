import {
  assert,
  createEditorHarness,
  dispatchKeydown,
  getNodeScreenBox,
  getPortScreenPoint,
  setupDom,
  test,
} from "./helpers/create-editor-test-helpers.js";

test("touch empty-canvas drag pans instead of marquee-selecting while mouse drag still boxes", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 2 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const beforeTouchPan = getNodeScreenBox(harness.query("node-node-a"));

    harness.pointerDown(viewport, {
      clientX: 420,
      clientY: 320,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.pointerMove(viewport, {
      clientX: 480,
      clientY: 356,
      pointerType: "touch",
      pointerId: 1,
    });
    await harness.flush();

    const afterTouchPan = getNodeScreenBox(harness.query("node-node-a"));
    assert.equal(harness.container.querySelector(".ping-editor__selection-box"), null);
    assert(afterTouchPan.x > beforeTouchPan.x);
    assert(afterTouchPan.y > beforeTouchPan.y);

    harness.pointerUp(viewport, {
      clientX: 480,
      clientY: 356,
      pointerType: "touch",
      pointerId: 1,
    });
    await harness.flush();

    harness.pointerDown(viewport, { clientX: 160, clientY: 160 });
    harness.pointerMove(viewport, { clientX: 260, clientY: 260 });
    await harness.flush();

    assert.ok(harness.container.querySelector(".ping-editor__selection-box"));

    harness.pointerUp({ clientX: 260, clientY: 260 });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("touch pinch zoom scales node chrome", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 2 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const viewport = harness.query("editor-viewport");
    const beforePinch = getNodeScreenBox(harness.query("node-node-a"));

    harness.pointerDown(viewport, {
      clientX: 180,
      clientY: 180,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.pointerDown(viewport, {
      clientX: 280,
      clientY: 180,
      pointerType: "touch",
      pointerId: 2,
      isPrimary: false,
    });
    harness.pointerMove(viewport, {
      clientX: 340,
      clientY: 180,
      pointerType: "touch",
      pointerId: 2,
      isPrimary: false,
    });
    await harness.flush();

    const afterPinch = getNodeScreenBox(harness.query("node-node-a"));
    assert(afterPinch.width > beforePinch.width);
    assert(afterPinch.height > beforePinch.height);

    harness.pointerUp(viewport, {
      clientX: 340,
      clientY: 180,
      pointerType: "touch",
      pointerId: 2,
      isPrimary: false,
    });
    harness.pointerUp(viewport, {
      clientX: 180,
      clientY: 180,
      pointerType: "touch",
      pointerId: 1,
    });
    await harness.flush();

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("touch tap selects a node and touch drag moves it", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 2 } }],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const node = harness.query("node-node-a");
    const box = getNodeScreenBox(node);
    const startPoint = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };

    harness.pointerDown(node, {
      clientX: startPoint.x,
      clientY: startPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.pointerUp(node, {
      clientX: startPoint.x,
      clientY: startPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    await harness.flush();

    assert.deepEqual(harness.selection, { kind: "node", nodeId: "node-a" });

    const refreshedNode = harness.query("node-node-a");
    harness.pointerDown(refreshedNode, {
      clientX: startPoint.x,
      clientY: startPoint.y,
      pointerType: "touch",
      pointerId: 2,
    });
    harness.pointerMove(harness.query("editor-viewport"), {
      clientX: startPoint.x + 48,
      clientY: startPoint.y + 24,
      pointerType: "touch",
      pointerId: 2,
    });
    harness.pointerUp({
      clientX: startPoint.x + 48,
      clientY: startPoint.y + 24,
      pointerType: "touch",
      pointerId: 2,
    });
    await harness.flush();

    assert.deepEqual(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.pos,
      { x: 4, y: 3 },
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("touch port tap starts cable creation and touch taps can add corners and commit the edge", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);

    harness.pointerDown(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.pointerUp(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.click(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
    });
    await harness.flush();

    assert.ok(harness.query("cancel-cable-button"));
    assert.ok(harness.query("edge-preview"));

    const viewport = harness.query("editor-viewport");
    harness.pointerDown(viewport, {
      clientX: 180,
      clientY: 120,
      pointerType: "touch",
      pointerId: 2,
    });
    harness.pointerUp(viewport, {
      clientX: 180,
      clientY: 120,
      pointerType: "touch",
      pointerId: 2,
    });
    harness.click(viewport, { clientX: 180, clientY: 120 });
    await harness.flush();

    const inputPort = harness.query("port-node-b-in-0");
    const inputPoint = getPortScreenPoint(inputPort);
    harness.pointerDown(inputPort, {
      clientX: inputPoint.x,
      clientY: inputPoint.y,
      pointerType: "touch",
      pointerId: 3,
    });
    harness.pointerUp(inputPort, {
      clientX: inputPoint.x,
      clientY: inputPoint.y,
      pointerType: "touch",
      pointerId: 3,
    });
    harness.click(inputPort, {
      clientX: inputPoint.x,
      clientY: inputPoint.y,
    });
    await harness.flush();

    assert.equal(harness.snapshot.edges.length, 1);
    assert.equal(harness.snapshot.edges[0].manualCorners.length, 1);
    assert.equal(harness.query("cancel-cable-button"), null);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("touch cable creation can be cancelled from the toolbar control", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [
          { id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } },
          { id: "node-b", type: "out", pos: { x: 8, y: 2 }, rot: 0, params: {} },
        ],
        edges: [],
        groups: {},
      },
    });
    await harness.flush();

    const outputPort = harness.query("port-node-a-out-0");
    const outputPoint = getPortScreenPoint(outputPort);
    harness.pointerDown(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.pointerUp(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
      pointerType: "touch",
      pointerId: 1,
    });
    harness.click(outputPort, {
      clientX: outputPoint.x,
      clientY: outputPoint.y,
    });
    await harness.flush();

    assert.ok(harness.query("cancel-cable-button"));
    assert.ok(harness.query("edge-preview"));

    harness.click(harness.query("cancel-cable-button"));
    await harness.flush();

    assert.equal(harness.query("cancel-cable-button"), null);
    assert.equal(harness.query("edge-preview"), null);
    assert.equal(harness.snapshot.edges.length, 0);

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("touch-sized rotate toolbar button rotates the selected node", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "pulse", pos: { x: 2, y: 2 }, rot: 0, params: { param: 1 } }],
        edges: [],
        groups: {},
      },
      selection: { kind: "node", nodeId: "node-a" },
    });
    harness.container.dataset.rectWidth = "900";
    harness.container.dataset.rectHeight = "640";
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    await harness.flush();

    harness.click(harness.query("rotate-toolbar-button"));
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.rot,
      90,
    );

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});

test("invalid inline param blur reverts to the committed value instead of clamping to 1", async () => {
  const dom = setupDom();

  try {
    const harness = createEditorHarness({
      snapshot: {
        nodes: [{ id: "node-a", type: "add", pos: { x: 2, y: 2 }, rot: 0, params: { param: 5 } }],
        edges: [],
        groups: {},
      },
      selection: { kind: "node", nodeId: "node-a" },
    });
    await harness.flush();

    const inlineParamInput = harness.query("inline-param-node-a");
    inlineParamInput.focus();
    inlineParamInput.value = "";
    inlineParamInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    harness.query("editor-viewport").focus();
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.params.param,
      5,
    );
    assert.equal(harness.query("inline-param-node-a").value, "5");

    const restoredInput = harness.query("inline-param-node-a");
    restoredInput.focus();
    restoredInput.value = "hello";
    restoredInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    dispatchKeydown(dom.window, restoredInput, "Enter");
    await harness.flush();

    assert.equal(
      harness.snapshot.nodes.find((entry) => entry.id === "node-a")?.params.param,
      5,
    );
    assert.equal(harness.query("inline-param-node-a").value, "5");

    harness.unmount();
  } finally {
    dom.cleanup();
  }
});
