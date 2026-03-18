export function createEmptySelection() {
  return { kind: "none" };
}

export function createEmptyHover() {
  return { kind: "none" };
}

export function createEmptyGroupSelection() {
  return { nodeIds: [] };
}

export function createEmptyDragState() {
  return { kind: "none" };
}

export function createDefaultCamera() {
  return { x: 0, y: 0, scale: 1 };
}

export function isTextInputTarget(target) {
  if (!target || typeof target.closest !== "function") {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function normalizeSelection(selection) {
  if (!selection || typeof selection !== "object") {
    return createEmptySelection();
  }

  if (selection.kind === "node" && typeof selection.nodeId === "string") {
    return selection;
  }

  if (selection.kind === "edge" && typeof selection.edgeId === "string") {
    return selection;
  }

  if (
    selection.kind === "corner" &&
    typeof selection.edgeId === "string" &&
    Number.isInteger(selection.cornerIndex)
  ) {
    return selection;
  }

  return createEmptySelection();
}

export function normalizeGroupSelection(groupSelection) {
  if (!groupSelection || !Array.isArray(groupSelection.nodeIds)) {
    return createEmptyGroupSelection();
  }

  return {
    nodeIds: groupSelection.nodeIds.filter((nodeId) => typeof nodeId === "string"),
  };
}

export function toggleGroupSelection(groupSelection, nodeId) {
  const normalized = normalizeGroupSelection(groupSelection);

  if (normalized.nodeIds.includes(nodeId)) {
    return {
      nodeIds: normalized.nodeIds.filter((entry) => entry !== nodeId),
    };
  }

  return {
    nodeIds: [...normalized.nodeIds, nodeId],
  };
}

export function clearDeletedSelection(selection, snapshot) {
  const normalized = normalizeSelection(selection);
  const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const edgeIds = new Set(snapshot.edges.map((edge) => edge.id));

  if (normalized.kind === "node" && !nodeIds.has(normalized.nodeId)) {
    return createEmptySelection();
  }

  if (normalized.kind === "edge" && !edgeIds.has(normalized.edgeId)) {
    return createEmptySelection();
  }

  if (
    normalized.kind === "corner" &&
    (!edgeIds.has(normalized.edgeId) ||
      !snapshot.edges.find((edge) => edge.id === normalized.edgeId)?.manualCorners?.[normalized.cornerIndex])
  ) {
    return createEmptySelection();
  }

  return normalized;
}
