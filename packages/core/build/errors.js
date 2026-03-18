export const BUILD_ERROR_CODES = {
  UNKNOWN_NODE_TYPE: "BUILD_UNKNOWN_NODE_TYPE",
  PORT_COUNT_MISMATCH: "BUILD_PORT_COUNT_MISMATCH",
  PORT_SLOT_INVALID: "BUILD_PORT_SLOT_INVALID",
  ROLE_MISMATCH: "BUILD_ROLE_MISMATCH",
  SAME_DIRECTION: "BUILD_SAME_DIRECTION",
  PORT_ALREADY_CONNECTED: "BUILD_PORT_ALREADY_CONNECTED",
  DANGLING_PORT: "BUILD_DANGLING_PORT",
  MISSING_DELAY: "BUILD_MISSING_DELAY",
  GROUP_MAPPING_INVALID: "BUILD_GROUP_MAPPING_INVALID",
};

export function createBuildIssue(code, message, details = {}) {
  return {
    code,
    message,
    severity: details.severity ?? "error",
    ...(details.nodeId !== undefined ? { nodeId: details.nodeId } : {}),
    ...(details.edgeId !== undefined ? { edgeId: details.edgeId } : {}),
    ...(details.groupId !== undefined ? { groupId: details.groupId } : {}),
    ...(details.portSlot !== undefined ? { portSlot: details.portSlot } : {}),
  };
}

export function cloneBuildIssue(issue) {
  return {
    ...issue,
  };
}
