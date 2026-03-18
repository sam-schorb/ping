export const RUNTIME_WARNING_CODES = {
  MISSING_NODE: "RUNTIME_MISSING_NODE",
  MISSING_EDGE: "RUNTIME_MISSING_EDGE",
  MISSING_TYPE: "RUNTIME_MISSING_TYPE",
  INVALID_VALUE: "RUNTIME_INVALID_VALUE",
  QUEUE_OVERFLOW: "RUNTIME_QUEUE_OVERFLOW",
  LATE_EVENT: "RUNTIME_LATE_EVENT",
};

export function createRuntimeWarning(code, message, details = {}) {
  return {
    code,
    message,
    ...(details.nodeId !== undefined ? { nodeId: details.nodeId } : {}),
    ...(details.edgeId !== undefined ? { edgeId: details.edgeId } : {}),
  };
}
