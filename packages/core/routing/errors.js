export const ROUTING_ERROR_CODES = {
  MISSING_NODE: "ROUTE_MISSING_NODE",
  MISSING_EDGE: "ROUTE_MISSING_EDGE",
  INVALID_PORT: "ROUTE_INVALID_PORT",
  ANCHOR_FAIL: "ROUTE_ANCHOR_FAIL",
  NO_PATH: "ROUTE_NO_PATH",
  INTERNAL_ERROR: "ROUTE_INTERNAL_ERROR",
};

export function createRoutingIssue(code, edgeId, message) {
  return {
    code,
    edgeId,
    message,
  };
}

export function createRoutingError(code, edgeId, message) {
  const error = new Error(message);

  error.name = "RoutingError";
  error.code = code;
  error.edgeId = edgeId;
  error.issue = createRoutingIssue(code, edgeId, message);

  return error;
}

export function normalizeRoutingError(error, edgeId) {
  if (error?.issue) {
    return error.issue;
  }

  return createRoutingIssue(
    ROUTING_ERROR_CODES.INTERNAL_ERROR,
    edgeId,
    error instanceof Error ? error.message : "Routing failed unexpectedly.",
  );
}
