const GLOBAL_MULTI_IO_ORDER = [
  { side: "top", slot: "top-left", sideSlot: 1 },
  { side: "top", slot: "top-right", sideSlot: 2 },
  { side: "right", slot: "right-top", sideSlot: 1 },
  { side: "right", slot: "right-bottom", sideSlot: 2 },
  { side: "bottom", slot: "bottom-right", sideSlot: 2 },
  { side: "bottom", slot: "bottom-left", sideSlot: 1 },
];

const MIRRORED_MULTI_IO_ORDER = [
  { side: "top", slot: "top-right", sideSlot: 2 },
  { side: "top", slot: "top-left", sideSlot: 1 },
  { side: "left", slot: "left-top", sideSlot: 1 },
  { side: "left", slot: "left-bottom", sideSlot: 2 },
  { side: "bottom", slot: "bottom-left", sideSlot: 1 },
  { side: "bottom", slot: "bottom-right", sideSlot: 2 },
];

function createSignalInputs(count, ports) {
  return ports.slice(0, count).map((port, index) => ({
    role: "signal",
    index,
    side: port.side,
    sideSlot: port.sideSlot,
  }));
}

function createSignalOutputs(count, ports) {
  return ports.slice(0, count).map((port, index) => ({
    role: "signal",
    index,
    side: port.side,
    sideSlot: port.sideSlot,
  }));
}

function createLeftInputs(signalInputs, controlPorts) {
  const ports = [];

  for (let index = 0; index < signalInputs; index += 1) {
    ports.push({
      role: "signal",
      index,
      side: "left",
      sideSlot: index + 1,
    });
  }

  for (let index = 0; index < controlPorts; index += 1) {
    ports.push({
      role: "control",
      index: signalInputs + index,
      side: "left",
      sideSlot: signalInputs + index + 1,
    });
  }

  return ports;
}

function createRightOutputs(signalOutputs) {
  return Array.from({ length: signalOutputs }, (_, index) => ({
    role: "signal",
    index,
    side: "right",
    sideSlot: index + 1,
  }));
}

const exactCounts = (expected) => ({ inputs, outputs, controlPorts }) =>
  inputs === expected.inputs &&
  outputs === expected.outputs &&
  controlPorts === expected.controlPorts;

export const ARCHETYPES = {
  "single-io": {
    acceptsControlPorts: false,
    validateCounts: exactCounts({ inputs: 1, outputs: 1, controlPorts: 0 }),
    createLayout() {
      return {
        inputs: [{ role: "signal", index: 0, side: "left", sideSlot: 1 }],
        outputs: [{ role: "signal", index: 0, side: "right", sideSlot: 1 }],
      };
    },
  },
  "single-io-control": {
    acceptsControlPorts: true,
    validateCounts: exactCounts({ inputs: 1, outputs: 1, controlPorts: 1 }),
    createLayout() {
      return {
        inputs: [
          { role: "signal", index: 0, side: "left", sideSlot: 1 },
          { role: "control", index: 1, side: "left", sideSlot: 2 },
        ],
        outputs: [{ role: "signal", index: 0, side: "right", sideSlot: 1 }],
      };
    },
  },
  "single-in": {
    acceptsControlPorts: false,
    validateCounts: exactCounts({ inputs: 1, outputs: 0, controlPorts: 0 }),
    createLayout() {
      return {
        inputs: [{ role: "signal", index: 0, side: "left", sideSlot: 1 }],
        outputs: [],
      };
    },
  },
  "multi-out-6": {
    acceptsControlPorts: false,
    validateCounts: exactCounts({ inputs: 1, outputs: 6, controlPorts: 0 }),
    createLayout() {
      return {
        inputs: [{ role: "signal", index: 0, side: "left", sideSlot: 1 }],
        outputs: createSignalOutputs(6, GLOBAL_MULTI_IO_ORDER),
      };
    },
  },
  "multi-out-6-control": {
    acceptsControlPorts: true,
    validateCounts: exactCounts({ inputs: 1, outputs: 6, controlPorts: 1 }),
    createLayout() {
      return {
        inputs: [
          { role: "signal", index: 0, side: "left", sideSlot: 1 },
          { role: "control", index: 1, side: "left", sideSlot: 2 },
        ],
        outputs: createSignalOutputs(6, GLOBAL_MULTI_IO_ORDER),
      };
    },
  },
  "multi-in-6": {
    acceptsControlPorts: false,
    validateCounts: exactCounts({ inputs: 6, outputs: 1, controlPorts: 0 }),
    createLayout() {
      return {
        inputs: createSignalInputs(6, GLOBAL_MULTI_IO_ORDER),
        outputs: [{ role: "signal", index: 0, side: "left", sideSlot: 1 }],
      };
    },
  },
  "multi-in-6-mirrored": {
    acceptsControlPorts: false,
    validateCounts: exactCounts({ inputs: 6, outputs: 1, controlPorts: 0 }),
    createLayout() {
      return {
        inputs: createSignalInputs(6, MIRRORED_MULTI_IO_ORDER),
        outputs: [{ role: "signal", index: 0, side: "right", sideSlot: 1 }],
      };
    },
  },
  custom: {
    acceptsControlPorts: true,
    validateCounts({ inputs, outputs, controlPorts }) {
      return (
        Number.isInteger(inputs) &&
        inputs >= 0 &&
        Number.isInteger(outputs) &&
        outputs >= 0 &&
        Number.isInteger(controlPorts) &&
        controlPorts >= 0
      );
    },
    createLayout({ inputs, outputs, controlPorts }) {
      return {
        inputs: createLeftInputs(inputs, controlPorts),
        outputs: createRightOutputs(outputs),
      };
    },
  },
};

export function getLayout(layout, inputs, outputs, controlPorts) {
  const archetype = ARCHETYPES[layout];

  if (!archetype) {
    throw new Error(`Unknown node layout "${layout}".`);
  }

  return archetype.createLayout({ inputs, outputs, controlPorts });
}

export function isValidLayoutCounts(layout, inputs, outputs, controlPorts) {
  const archetype = ARCHETYPES[layout];

  if (!archetype) {
    return false;
  }

  return archetype.validateCounts({ inputs, outputs, controlPorts });
}

export function isControlPortsAllowed(layout) {
  return ARCHETYPES[layout]?.acceptsControlPorts ?? false;
}

export function getPortSideSlot(port, ports) {
  if (Number.isInteger(port?.sideSlot) && port.sideSlot >= 1) {
    return port.sideSlot;
  }

  const sidePorts = ports.filter((entry) => entry.side === port.side);
  const index = sidePorts.findIndex((entry) => entry.index === port.index);

  return index >= 0 ? index + 1 : 1;
}

export { GLOBAL_MULTI_IO_ORDER };
