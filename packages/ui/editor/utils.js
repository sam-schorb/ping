import { createDefaultSampleSlots, DEFAULT_TEMPO_BPM } from "@ping/core";

export const CLIPBOARD_MIME = "application/x-ping-subgraph+json";
export const CLIPBOARD_TEXT_MARKER = "Ping subgraph";
export const NODE_PULSE_DURATION_MS = 200;
export const EDGE_CREATE_PREVIEW_EDGE_ID = "__edge-create-preview__";
export const BUILT_IN_SIDEBAR_TABS = Object.freeze([
  { id: "docs", label: "docs" },
  { id: "console", label: "console" },
  { id: "groups", label: "groups" },
  { id: "samples", label: "samples" },
]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTempo(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEMPO_BPM;
  }

  return clamp(Math.round(value), 1, 100);
}

export function getNodePulseWindowTicks(tempo) {
  return (normalizeTempo(tempo) / 60) * (NODE_PULSE_DURATION_MS / 1000);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function normalizeHexColor(color, fallback = "#000000") {
  if (typeof color !== "string") {
    return fallback;
  }

  const value = color.trim();

  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return fallback;
}

export function invertHexColor(color, fallback = "#ffffff") {
  const normalized = normalizeHexColor(color, fallback);
  const red = 255 - Number.parseInt(normalized.slice(1, 3), 16);
  const green = 255 - Number.parseInt(normalized.slice(3, 5), 16);
  const blue = 255 - Number.parseInt(normalized.slice(5, 7), 16);

  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function syncRangeValue(input, value) {
  if (input && input.value !== String(value)) {
    input.value = String(value);
  }
}

export function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }

  return value;
}

export function cloneSlots(slots) {
  return slots.map((slot) => ({ ...slot }));
}

export function createEmptyRoutes() {
  return {
    edgeRoutes: new Map(),
    edgeDelays: new Map(),
    errors: [],
  };
}

export function createViewportFallback() {
  return {
    width: 960,
    height: 640,
  };
}

export function normalizeSlots(slots) {
  const fallback = createDefaultSampleSlots();

  if (!Array.isArray(slots) || slots.length !== fallback.length) {
    return fallback;
  }

  return fallback.map((entry, index) => {
    const slot = slots[index];

    if (!slot || typeof slot !== "object") {
      return entry;
    }

    return {
      id: typeof slot.id === "string" && slot.id.trim() !== "" ? slot.id : entry.id,
      path: typeof slot.path === "string" ? slot.path : entry.path,
    };
  });
}

export function isDataUrlPath(path) {
  return typeof path === "string" && path.startsWith("data:");
}

export function reconcileSampleFileLabels(sampleFileLabels, slots) {
  const nextLabels = new Map();

  if (!(sampleFileLabels instanceof Map)) {
    return nextLabels;
  }

  for (const slot of slots) {
    if (isDataUrlPath(slot.path) && sampleFileLabels.has(slot.id)) {
      nextLabels.set(slot.id, sampleFileLabels.get(slot.id));
    }
  }

  return nextLabels;
}

export function createEmptyNoticeList() {
  return [];
}

export function createLocalIssue(code, message, extra = {}) {
  return {
    code,
    message,
    severity: extra.severity ?? "warning",
    ...(extra.nodeId ? { nodeId: extra.nodeId } : {}),
    ...(extra.edgeId ? { edgeId: extra.edgeId } : {}),
  };
}

export function selectionEquals(left, right) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "none") {
    return true;
  }

  if (left.kind === "node") {
    return left.nodeId === right.nodeId;
  }

  if (left.kind === "edge") {
    return left.edgeId === right.edgeId;
  }

  return left.edgeId === right.edgeId && left.cornerIndex === right.cornerIndex;
}

export function hoverEquals(left, right) {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "none") {
    return true;
  }

  if (left.kind === "node") {
    return left.nodeId === right.nodeId;
  }

  if (left.kind === "edge") {
    return left.edgeId === right.edgeId;
  }

  if (left.kind === "corner") {
    return left.edgeId === right.edgeId && left.cornerIndex === right.cornerIndex;
  }

  return (
    left.nodeId === right.nodeId &&
    left.portSlot === right.portSlot &&
    left.direction === right.direction
  );
}

export function isInteractiveTarget(target) {
  return Boolean(
    target?.closest?.("[data-action], input, select, button, label, .ping-editor__menu, .ping-editor__group-dialog"),
  );
}

export function normalizeSidebarExtensions(extensions) {
  const tabs = Array.isArray(extensions?.tabs)
    ? extensions.tabs
        .filter(
          (tab) =>
            tab &&
            typeof tab.id === "string" &&
            tab.id.trim() !== "" &&
            typeof tab.label === "string" &&
            tab.label.trim() !== "",
        )
        .map((tab) => ({
          id: tab.id,
          label: tab.label,
          markup: typeof tab.markup === "string" ? tab.markup : "",
          ...(typeof tab.testId === "string" && tab.testId.trim() !== ""
            ? { testId: tab.testId }
            : {}),
        }))
    : [];

  const actions = Array.isArray(extensions?.actions)
    ? extensions.actions
        .filter(
          (action) =>
            action &&
            typeof action.id === "string" &&
            action.id.trim() !== "" &&
            typeof action.label === "string" &&
            action.label.trim() !== "",
        )
        .map((action) => ({
          id: action.id,
          label: action.label,
          ...(typeof action.testId === "string" && action.testId.trim() !== ""
            ? { testId: action.testId }
            : {}),
        }))
    : [];

  return { tabs, actions };
}

export function sidebarTabStructureEquals(left, right) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    (left.testId ?? "") === (right.testId ?? "")
  );
}

export function sidebarActionEquals(left, right) {
  return (
    left.id === right.id &&
    left.label === right.label &&
    (left.testId ?? "") === (right.testId ?? "")
  );
}

export function sidebarExtensionsRequireRender(current, next, activeTab) {
  if (current.tabs.length !== next.tabs.length || current.actions.length !== next.actions.length) {
    return true;
  }

  for (let index = 0; index < current.actions.length; index += 1) {
    if (!sidebarActionEquals(current.actions[index], next.actions[index])) {
      return true;
    }
  }

  for (let index = 0; index < current.tabs.length; index += 1) {
    const currentTab = current.tabs[index];
    const nextTab = next.tabs[index];

    if (!sidebarTabStructureEquals(currentTab, nextTab)) {
      return true;
    }

    if (currentTab.id === activeTab && currentTab.markup !== nextTab.markup) {
      return true;
    }
  }

  return false;
}

export function getSidebarTabIds(sidebarExtensions) {
  return new Set([
    ...BUILT_IN_SIDEBAR_TABS.map((tab) => tab.id),
    ...sidebarExtensions.tabs.map((tab) => tab.id),
  ]);
}

export function createIdFactory() {
  return {
    node: 1,
    edge: 1,
    group: 1,
    groupNode: 1,
  };
}

export function collectIds(snapshot) {
  const ids = new Set();

  for (const node of snapshot.nodes) {
    ids.add(node.id);
  }

  for (const edge of snapshot.edges) {
    ids.add(edge.id);
  }

  for (const groupId of Object.keys(snapshot.groups ?? {})) {
    ids.add(groupId);
  }

  return ids;
}

export function createDeterministicId(prefix, state) {
  const usedIds = collectIds(state.snapshot);
  let counter = state.idCounters[prefix] ?? 1;
  let candidate = `${prefix}-${counter}`;

  while (usedIds.has(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }

  state.idCounters[prefix] = counter + 1;
  return candidate;
}

export function getSelectionTarget(snapshot, selection) {
  if (selection.kind === "node") {
    return snapshot.nodes.find((node) => node.id === selection.nodeId) ?? null;
  }

  if (selection.kind === "edge") {
    return snapshot.edges.find((edge) => edge.id === selection.edgeId) ?? null;
  }

  if (selection.kind === "corner") {
    const edge = snapshot.edges.find((entry) => entry.id === selection.edgeId);

    if (!edge) {
      return null;
    }

    return {
      edge,
      corner: edge.manualCorners?.[selection.cornerIndex] ?? null,
    };
  }

  return null;
}

export function formatInspectDslStatus(mode, syncStatus, dirty) {
  const modeLabel = mode === "generated" ? "Generated source" : "Authored source";
  const syncLabel = syncStatus === "stale" ? "stale" : "in sync";

  return `${modeLabel} · ${syncLabel}${dirty ? " · unsaved changes" : ""}`;
}

export function moveArrayEntry(list, index, nextIndex) {
  if (index < 0 || index >= list.length || nextIndex < 0 || nextIndex >= list.length) {
    return list;
  }

  const copy = [...list];
  const [entry] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, entry);
  return copy;
}

export async function readFileAsDataUrl(file) {
  if (typeof FileReader === "undefined") {
    return file.name;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}
