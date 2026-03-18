export const MODEL_ERROR_CODES = {
  UNKNOWN_NODE_TYPE: "MODEL_UNKNOWN_NODE_TYPE",
  DUPLICATE_ID: "MODEL_DUPLICATE_ID",
  NODE_NOT_FOUND: "MODEL_NODE_NOT_FOUND",
  EDGE_NOT_FOUND: "MODEL_EDGE_NOT_FOUND",
  PORT_INVALID: "MODEL_PORT_INVALID",
  PORT_ALREADY_CONNECTED: "MODEL_PORT_ALREADY_CONNECTED",
  EDGE_DIRECTION_INVALID: "MODEL_EDGE_DIRECTION_INVALID",
  EDGE_DANGLING_ENDPOINT: "MODEL_EDGE_DANGLING_ENDPOINT",
  GROUP_NOT_FOUND: "MODEL_GROUP_NOT_FOUND",
  GROUP_REF_INVALID: "MODEL_GROUP_REF_INVALID",
  INVALID_ROTATION: "MODEL_INVALID_ROTATION",
  INVALID_POSITION: "MODEL_INVALID_POSITION",
  INVALID_OPERATION: "MODEL_INVALID_OPERATION",
};

export function createModelIssue(code, message, entityId) {
  return {
    code,
    message,
    entityId,
  };
}

export function createGraphOpError(issue, opIndex, opType) {
  return {
    code: issue.code,
    message: issue.message,
    opIndex,
    opType,
    entityId: issue.entityId,
  };
}

export function createGraphModelLoadError(issues) {
  const error = new Error(
    issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"),
  );

  error.name = "GraphModelLoadError";
  error.code = issues[0]?.code ?? MODEL_ERROR_CODES.INVALID_OPERATION;
  error.errors = issues;

  return error;
}
