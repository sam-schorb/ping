export const ROUTING_BEND_PREFERENCES = {
  HORIZONTAL_FIRST: "horizontal-first",
  VERTICAL_FIRST: "vertical-first",
};

export const DEFAULT_ROUTING_CONFIG = {
  ticksPerGrid: 1,
  stubLength: 1,
  bendPreference: ROUTING_BEND_PREFERENCES.HORIZONTAL_FIRST,
};

export const ROTATION_VECTORS = {
  0: (vector) => ({ ...vector }),
  90: (vector) => ({ x: vector.y, y: -vector.x }),
  180: (vector) => ({ x: -vector.x, y: -vector.y }),
  270: (vector) => ({ x: -vector.y, y: vector.x }),
};

export const SIDE_NORMALS = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
