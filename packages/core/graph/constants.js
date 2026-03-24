export const ROTATIONS = [0, 90, 180, 270];
export const ROTATION_SET = new Set(ROTATIONS);
export const PORT_DIRECTIONS = {
  IN: "in",
  OUT: "out",
};
export const GROUP_NODE_TYPE = "group";
export const CODE_NODE_TYPE = "code";
export const CODE_NODE_GROUP_PREFIX = "__code__";
export const GROUP_BACKED_NODE_TYPES = new Set([
  GROUP_NODE_TYPE,
  CODE_NODE_TYPE,
]);
export const DEFAULT_PARAM_KEY = "param";

export function createCodeNodeGroupId(nodeId) {
  return `${CODE_NODE_GROUP_PREFIX}${nodeId}`;
}

export function isCodeNodeGroupId(groupId) {
  return typeof groupId === "string" && groupId.startsWith(CODE_NODE_GROUP_PREFIX);
}

export function isGroupBackedNodeType(type) {
  return GROUP_BACKED_NODE_TYPES.has(type);
}

export function isGroupBackedNode(node) {
  return isGroupBackedNodeType(node?.type);
}
