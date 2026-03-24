export const DSL_ERROR_CODES = {
  EXPORT_INVALID_GROUP: "DSL_EXPORT_INVALID_GROUP",
  EXPORT_UNSUPPORTED_GRAPH: "DSL_EXPORT_UNSUPPORTED_GRAPH",
  EXPORT_INTERNAL: "DSL_EXPORT_INTERNAL_ERROR",
  PARSE_INVALID_SOURCE: "DSL_PARSE_INVALID_SOURCE",
  PARSE_SYNTAX: "DSL_PARSE_SYNTAX",
  LOWER_INVALID_REGISTRY: "DSL_LOWER_INVALID_REGISTRY",
  LOWER_RESERVED_BINDING: "DSL_LOWER_RESERVED_BINDING",
  LOWER_DUPLICATE_BINDING: "DSL_LOWER_DUPLICATE_BINDING",
  LOWER_UNKNOWN_BINDING: "DSL_LOWER_UNKNOWN_BINDING",
  LOWER_UNKNOWN_NODE: "DSL_LOWER_UNKNOWN_NODE",
  LOWER_INVALID_PARAM_BLOCK: "DSL_LOWER_INVALID_PARAM_BLOCK",
  LOWER_INVALID_CONTROL_ARITY: "DSL_LOWER_INVALID_CONTROL_ARITY",
  LOWER_INVALID_DISTANCE: "DSL_LOWER_INVALID_DISTANCE",
  LOWER_INVALID_INLET_USAGE: "DSL_LOWER_INVALID_INLET_USAGE",
  LOWER_DUPLICATE_OUTLET: "DSL_LOWER_DUPLICATE_OUTLET",
  LOWER_GAPPED_OUTLET: "DSL_LOWER_GAPPED_OUTLET",
  LOWER_INVALID_PORT_INDEX: "DSL_LOWER_INVALID_PORT_INDEX",
  LOWER_DUPLICATE_SIGNAL_TARGET: "DSL_LOWER_DUPLICATE_SIGNAL_TARGET",
  LOWER_DUPLICATE_CONTROL_TARGET: "DSL_LOWER_DUPLICATE_CONTROL_TARGET",
  LOWER_DUPLICATE_OUTPUT_SOURCE: "DSL_LOWER_DUPLICATE_OUTPUT_SOURCE",
  LOWER_INVALID_BINDING: "DSL_LOWER_INVALID_BINDING",
  LOWER_INVALID_GROUP: "DSL_LOWER_INVALID_GROUP",
  LAYOUT_INVALID_REGISTRY: "DSL_LAYOUT_INVALID_REGISTRY",
  LAYOUT_ROUTE_FAIL: "DSL_LAYOUT_ROUTE_FAIL",
  LAYOUT_INFEASIBLE_DISTANCE: "DSL_LAYOUT_INFEASIBLE_DISTANCE",
  LAYOUT_INTERNAL: "DSL_LAYOUT_INTERNAL_ERROR",
  RECONCILE_INVALID_GROUP: "DSL_RECONCILE_INVALID_GROUP",
  RECONCILE_INVALID_REGISTRY: "DSL_RECONCILE_INVALID_REGISTRY",
  RECONCILE_ROUTE_FAIL: "DSL_RECONCILE_ROUTE_FAIL",
  RECONCILE_INTERNAL: "DSL_RECONCILE_INTERNAL_ERROR",
};

export function createDslIssue(code, message, details = {}) {
  return {
    code,
    message,
    severity: details.severity ?? "error",
    ...(details.groupId !== undefined ? { groupId: details.groupId } : {}),
    ...(details.nodeId !== undefined ? { nodeId: details.nodeId } : {}),
    ...(details.edgeId !== undefined ? { edgeId: details.edgeId } : {}),
    ...(details.line !== undefined ? { line: details.line } : {}),
    ...(details.column !== undefined ? { column: details.column } : {}),
    ...(details.bindingName !== undefined ? { bindingName: details.bindingName } : {}),
    ...(details.outletIndex !== undefined ? { outletIndex: details.outletIndex } : {}),
    ...(details.inletIndex !== undefined ? { inletIndex: details.inletIndex } : {}),
  };
}

export function wrapModelIssueAsDslExportError(issue, groupId) {
  return createDslIssue(
    DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
    issue?.message ?? "Invalid group definition.",
    {
      groupId: groupId ?? issue?.entityId,
      nodeId: issue?.entityId,
    },
  );
}
