import {
  createDefaultSampleSlots,
  createEmptyGraphSnapshot,
  DEFAULT_TEMPO_BPM,
} from "@ping/core";

import { mergeUIConfig } from "../config/defaults.js";
import { renderDiagnosticsPanel } from "../panels/diagnostics.js";
import { renderGroupsPanel } from "../panels/groups.js";
import {
  DEFAULT_PALETTE_MENU_CATEGORY_ID,
  renderPaletteMenu,
} from "../panels/palette.js";
import { renderSamplesPanel } from "../panels/samples.js";
import { applyWheelPan, applyWheelZoom, getViewportSize, getWorldCursorFromPointer } from "../render/panzoom.js";
import {
  createHiddenThumbEdgeIds,
  renderSvgMarkup,
  renderThumbLayerMarkup,
} from "../render/svg-layer.js";
import { hitPort } from "./hittest.js";
import {
  clearDeletedSelection,
  createDefaultCamera,
  createEmptyDragState,
  createEmptyGroupSelection,
  createEmptyHover,
  createEmptySelection,
  isTextInputTarget,
  normalizeGroupSelection,
  normalizeSelection,
  toggleGroupSelection,
} from "./state.js";
import {
  buildPreviewRoute,
  clampCamera,
  clampParamInput,
  getNodeWorldBounds,
  getPortWorldPoint,
  snapWorldPoint,
} from "./geometry.js";
import {
  buildGroupCandidates,
  buildCreateGroupOps,
  buildUpdateGroupOps,
  canCreateEdge,
  canRemoveGroup,
  createClipboardSubgraph,
  createDeleteNodeSetOps,
  normalizeEdgeEndpoints,
  createAddNodeOp,
  createDeleteSelectionOps,
  createEdgeRecord,
  createGraphOpsOutput,
  createMoveNodeSetOps,
  createNodeRecord,
  createRenameNodeOp,
  createRotateNodeOp,
  createSetParamOp,
  createUndoOutput,
  instantiateClipboardSubgraph,
} from "./ops.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTempo(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TEMPO_BPM;
  }

  return clamp(Math.round(value), 1, 100);
}

const CLIPBOARD_MIME = "application/x-ping-subgraph+json";
const CLIPBOARD_TEXT_MARKER = "Ping subgraph";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function syncRangeValue(input, value) {
  if (input && input.value !== String(value)) {
    input.value = String(value);
  }
}

function cloneValue(value) {
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

function cloneSlots(slots) {
  return slots.map((slot) => ({ ...slot }));
}

function createEmptyRoutes() {
  return {
    edgeRoutes: new Map(),
    edgeDelays: new Map(),
    errors: [],
  };
}

function createViewportFallback() {
  return {
    width: 960,
    height: 640,
  };
}

function normalizeSlots(slots) {
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

function isDataUrlPath(path) {
  return typeof path === "string" && path.startsWith("data:");
}

function reconcileSampleFileLabels(sampleFileLabels, slots) {
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

function createEmptyNoticeList() {
  return [];
}

const BUILT_IN_SIDEBAR_TABS = Object.freeze([
  { id: "inspect", label: "inspect" },
  { id: "console", label: "console" },
  { id: "groups", label: "groups" },
  { id: "samples", label: "samples" },
]);

function createLocalIssue(code, message, extra = {}) {
  return {
    code,
    message,
    severity: extra.severity ?? "warning",
    ...(extra.nodeId ? { nodeId: extra.nodeId } : {}),
    ...(extra.edgeId ? { edgeId: extra.edgeId } : {}),
  };
}

function selectionEquals(left, right) {
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

function hoverEquals(left, right) {
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

function isInteractiveTarget(target) {
  return Boolean(target?.closest?.("[data-action], input, select, button, label"));
}

function normalizeSidebarExtensions(extensions) {
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

function getSidebarTabIds(sidebarExtensions) {
  return new Set([
    ...BUILT_IN_SIDEBAR_TABS.map((tab) => tab.id),
    ...sidebarExtensions.tabs.map((tab) => tab.id),
  ]);
}

function createIdFactory() {
  return {
    node: 1,
    edge: 1,
    group: 1,
    groupNode: 1,
  };
}

function collectIds(snapshot) {
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

function createDeterministicId(prefix, state) {
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

function getSelectionTarget(snapshot, selection) {
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

function buildSelectionInspectPanel(snapshot, registry, selection) {
  const target = getSelectionTarget(snapshot, selection);

  if (!target) {
    return `
      <section class="ping-editor__panel-section">
        <h2 class="ping-editor__panel-title">Inspect</h2>
        <p class="ping-editor__empty">Select a node, cable, or corner.</p>
      </section>
    `;
  }

  if (selection.kind === "node") {
    const node = target;
    const definition = registry.getNodeDefinition(node.type);
    const hasParam = Boolean(definition?.hasParam);

    return `
      <section class="ping-editor__panel-section">
        <h2 class="ping-editor__panel-title">Inspect</h2>
        <label class="ping-editor__field">
          <span>Name</span>
          <input
            class="ping-editor__input"
            type="text"
            name="node-name"
            value="${escapeHtml(node.name ?? "")}"
            data-action="rename-node"
            data-node-id="${escapeHtml(node.id)}"
            data-testid="inspect-name"
          />
        </label>
        ${
          hasParam
            ? `
              <label class="ping-editor__field">
                <span>${node.type === "pulse" ? "Rate" : "Param"}</span>
                <input
                  class="ping-editor__input"
                  type="number"
                  name="node-param"
                  min="1"
                  max="8"
                  step="1"
                  value="${escapeHtml(node.params?.param ?? definition?.defaultParam ?? 1)}"
                  data-action="set-param"
                  data-node-id="${escapeHtml(node.id)}"
                  data-testid="inspect-param"
                />
              </label>
            `
            : ""
        }
        <div class="ping-editor__action-row">
          <button class="ping-editor__panel-button" type="button" data-action="rotate-selection">
            Rotate
          </button>
          <button class="ping-editor__panel-button is-danger" type="button" data-action="delete-selection">
            Delete
          </button>
        </div>
      </section>
    `;
  }

  if (selection.kind === "edge") {
    return `
      <section class="ping-editor__panel-section">
        <h2 class="ping-editor__panel-title">Inspect</h2>
        <p class="ping-editor__inspect-copy">Selected edge: ${escapeHtml(selection.edgeId)}</p>
        <div class="ping-editor__action-row">
          <button class="ping-editor__panel-button is-danger" type="button" data-action="delete-selection">
            Delete cable
          </button>
        </div>
      </section>
    `;
  }

  return `
    <section class="ping-editor__panel-section">
      <h2 class="ping-editor__panel-title">Inspect</h2>
      <p class="ping-editor__inspect-copy">
        Selected corner ${selection.cornerIndex + 1} on ${escapeHtml(selection.edgeId)}
      </p>
      <div class="ping-editor__action-row">
        <button class="ping-editor__panel-button is-danger" type="button" data-action="delete-selection">
          Remove corner
        </button>
      </div>
    </section>
  `;
}

function buildMultiNodeInspectPanel(nodeIds) {
  return `
    <section class="ping-editor__panel-section">
      <h2 class="ping-editor__panel-title">Inspect</h2>
      <p class="ping-editor__inspect-copy">${nodeIds.length} nodes selected.</p>
      <div class="ping-editor__action-row">
        <button class="ping-editor__panel-button" type="button" data-action="open-group-config">
          Create Group
        </button>
        <button class="ping-editor__panel-button is-danger" type="button" data-action="delete-selection">
          Delete
        </button>
      </div>
    </section>
  `;
}

function buildGroupConnectionView(candidates) {
  if (!candidates.edges.length) {
    return '<p class="ping-editor__empty">No internal connections.</p>';
  }

  return `
    <ul class="ping-editor__mapping-list">
      ${candidates.edges
        .map(
          (edge) => `
            <li class="ping-editor__mapping-item">
              ${escapeHtml(edge.from.nodeId)}:${edge.from.portSlot + 1}
              <span class="ping-editor__mapping-arrow">→</span>
              ${escapeHtml(edge.to.nodeId)}:${edge.to.portSlot + 1}
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function createGroupMappingId(kind, entry) {
  if (kind === "controls") {
    return `control:${entry.nodeId}:${entry.paramKey ?? "param"}`;
  }

  return `${kind.slice(0, -1)}:${entry.nodeId}:${entry.portSlot}`;
}

function getGroupDraftNodeLabel(node, registry) {
  const definition = registry.getNodeDefinition(node.type);

  return node.name || definition?.label || node.type;
}

function createFallbackGroupMappingEntry(kind, entry) {
  return {
    ...(entry.label !== undefined
      ? { label: entry.label }
      : kind === "controls"
        ? { label: `${entry.nodeId} ${(entry.paramKey ?? "param").trim() || "param"}` }
        : { label: `${entry.nodeId} ${kind.slice(0, -1)} ${(entry.portSlot ?? 0) + 1}` }),
    id: createGroupMappingId(kind, entry),
    nodeId: entry.nodeId,
    ...(kind === "controls"
      ? { paramKey: entry.paramKey ?? "param" }
      : { portSlot: entry.portSlot }),
  };
}

function buildGroupDefinitionCandidates(group, registry) {
  const graph = group?.graph ?? { nodes: [], edges: [] };
  const candidates = {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
      manualCorners: (edge.manualCorners ?? []).map((point) => ({ ...point })),
    })),
    inputs: [],
    outputs: [],
    controls: [],
  };

  for (const node of graph.nodes) {
    const definition = registry.getNodeDefinition(node.type);

    if (!definition) {
      continue;
    }

    for (let portSlot = 0; portSlot < (definition.inputs ?? 0); portSlot += 1) {
      candidates.inputs.push({
        id: createGroupMappingId("inputs", { nodeId: node.id, portSlot }),
        label: `${getGroupDraftNodeLabel(node, registry)} input ${portSlot + 1}`,
        nodeId: node.id,
        portSlot,
      });
    }

    for (let portSlot = 0; portSlot < (definition.outputs ?? 0); portSlot += 1) {
      candidates.outputs.push({
        id: createGroupMappingId("outputs", { nodeId: node.id, portSlot }),
        label: `${getGroupDraftNodeLabel(node, registry)} output ${portSlot + 1}`,
        nodeId: node.id,
        portSlot,
      });
    }

    if (definition.hasParam) {
      candidates.controls.push({
        id: createGroupMappingId("controls", { nodeId: node.id, paramKey: "param" }),
        label: `${getGroupDraftNodeLabel(node, registry)} param`,
        nodeId: node.id,
        paramKey: "param",
      });
    }
  }

  return candidates;
}

function renderGroupMappingSection(kind, title, active, available, selectedId = "") {
  return `
    <section class="ping-editor__group-section">
      <h3>${escapeHtml(title)}</h3>
      <ul class="ping-editor__mapping-list">
        ${
          active.length > 0
            ? active
                .map(
                  (entry, index) => `
                    <li class="ping-editor__mapping-item" data-testid="group-${kind}-${index}">
                      <span>${escapeHtml(entry.label ?? entry.id)}</span>
                      <div class="ping-editor__mapping-actions">
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-move"
                          data-group-kind="${kind}"
                          data-group-index="${index}"
                          data-group-direction="-1"
                          ${index === 0 ? "disabled" : ""}
                        >
                          ↑
                        </button>
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-move"
                          data-group-kind="${kind}"
                          data-group-index="${index}"
                          data-group-direction="1"
                          ${index === active.length - 1 ? "disabled" : ""}
                        >
                          ↓
                        </button>
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-remove-mapping"
                          data-group-kind="${kind}"
                          data-group-id="${escapeHtml(entry.id)}"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  `,
                )
                .join("")
            : '<li class="ping-editor__empty">No exposed entries.</li>'
        }
      </ul>
      ${
        available.length > 0
          ? `
            <label class="ping-editor__field">
              <span>Add</span>
              <select class="ping-editor__input" name="group-${kind}" data-action="group-restore-select" data-group-kind="${kind}">
                ${available
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(entry.id)}" ${selectedId === entry.id ? "selected" : ""}>${escapeHtml(entry.label ?? entry.id)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </label>
            <button class="ping-editor__panel-button" type="button" data-action="group-restore" data-group-kind="${kind}">
              Add ${escapeHtml(title.slice(0, -1))}
            </button>
          `
          : ""
      }
    </section>
  `;
}

function renderGroupConfigPanel(groupDraft, { sidebarCollapsed = false } = {}) {
  if (!groupDraft?.open) {
    return "";
  }

  const isEdit = groupDraft.mode === "edit";

  return `
    <div
      class="ping-editor__group-dialog ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-open"}"
      data-testid="group-config"
    >
      <header class="ping-editor__group-header">
        <div>
          <h2>${isEdit ? "Edit Group" : "New Group"}</h2>
          <p class="ping-editor__group-subtitle">${
            isEdit ? `Group ${escapeHtml(groupDraft.groupId)}` : "Selected nodes"
          }: ${groupDraft.selectedNodeIds
            .map((nodeId) => escapeHtml(nodeId))
            .join(", ")}</p>
        </div>
        <button class="ping-editor__panel-button" type="button" data-action="close-group-config">Close</button>
      </header>
      <label class="ping-editor__field">
        <span>Name</span>
        <input
          class="ping-editor__input"
          type="text"
          name="group-name"
          value="${escapeHtml(groupDraft.name)}"
          data-action="group-name"
          data-testid="group-name"
        />
      </label>
      <section class="ping-editor__group-section">
        <h3>Connection View</h3>
        ${buildGroupConnectionView(groupDraft.candidates)}
      </section>
      ${renderGroupMappingSection(
        "inputs",
        "Signal Inputs",
        groupDraft.mappings.inputs,
        groupDraft.available.inputs,
        groupDraft.restoreSelection.inputs,
      )}
      ${renderGroupMappingSection(
        "outputs",
        "Signal Outputs",
        groupDraft.mappings.outputs,
        groupDraft.available.outputs,
        groupDraft.restoreSelection.outputs,
      )}
      ${renderGroupMappingSection(
        "controls",
        "Control Inputs",
        groupDraft.mappings.controls,
        groupDraft.available.controls,
        groupDraft.restoreSelection.controls,
      )}
      <div class="ping-editor__action-row">
        <button class="ping-editor__panel-button" type="button" data-action="close-group-config">
          Cancel
        </button>
        <button class="ping-editor__panel-button is-primary" type="button" data-action="commit-group" data-testid="group-confirm">
          ${isEdit ? "Save Changes" : "Save Group"}
        </button>
      </div>
    </div>
  `;
}

function createStyles(config) {
  const collapsedSidebarWidthPx = 52;
  const sidebarWidthCss = `min(${Math.max(280, config.panel.widthPx - 16)}px, 48vw, 560px)`;
  const selectionHighlightColor = config.selection.highlightColor ?? config.selection.color;
  const chromeSurfaceTop = "#f49595";
  const chromeSurfaceBottom = "#ffcfa3";
  const chromeInkStrong = "#472119";
  const chromeInk = "#5d3127";
  const chromeInkMuted = "#835246";
  const chromeBorder = "rgba(93, 49, 39, 0.18)";
  const chromeBorderStrong = "rgba(93, 49, 39, 0.3)";
  const chromePlate = "rgba(255, 246, 239, 0.56)";
  const chromePlateStrong = "rgba(255, 250, 244, 0.86)";
  const chromePlateHover = "rgba(255, 252, 248, 0.95)";
  const chromeAccent = "#9a523f";
  const chromeAccentStrong = "#7d3c2d";
  const chromeAccentSoft = "rgba(154, 82, 63, 0.16)";
  const chromeAccentOutline = "rgba(154, 82, 63, 0.28)";
  const chromeFocusRing = "rgba(154, 82, 63, 0.18)";
  const chromeTextOnAccent = "#fff7f3";
  const chromeShadow = "rgba(115, 58, 45, 0.18)";
  const chromeNotice = "#85b8ff";
  const chromeNoticeSoft = "rgba(133, 184, 255, 0.16)";
  const chromeNoticeBorder = "rgba(133, 184, 255, 0.38)";

  return `
    <style data-ping-editor-style>
      .ping-editor {
        --ping-chrome-top: ${chromeSurfaceTop};
        --ping-chrome-bottom: ${chromeSurfaceBottom};
        --ping-chrome-ink-strong: ${chromeInkStrong};
        --ping-chrome-ink: ${chromeInk};
        --ping-chrome-ink-muted: ${chromeInkMuted};
        --ping-chrome-border: ${chromeBorder};
        --ping-chrome-border-strong: ${chromeBorderStrong};
        --ping-chrome-plate: ${chromePlate};
        --ping-chrome-plate-strong: ${chromePlateStrong};
        --ping-chrome-plate-hover: ${chromePlateHover};
        --ping-chrome-accent: ${chromeAccent};
        --ping-chrome-accent-strong: ${chromeAccentStrong};
        --ping-chrome-accent-soft: ${chromeAccentSoft};
        --ping-chrome-accent-outline: ${chromeAccentOutline};
        --ping-chrome-focus: ${chromeFocusRing};
        --ping-chrome-on-accent: ${chromeTextOnAccent};
        --ping-chrome-shadow: ${chromeShadow};
        --ping-chrome-notice: ${chromeNotice};
        --ping-chrome-notice-soft: ${chromeNoticeSoft};
        --ping-chrome-notice-border: ${chromeNoticeBorder};
        --ping-chrome-shell: var(--ping-chrome-top);
        --ping-chrome-card: linear-gradient(180deg, rgba(255, 251, 247, 0.92), rgba(255, 238, 227, 0.84));
        --ping-chrome-card-strong: linear-gradient(180deg, rgba(255, 252, 247, 0.96), rgba(255, 242, 232, 0.9));
        position: relative;
        display: grid;
        grid-template-rows: minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        background: ${config.canvas.background};
        color: var(--ping-chrome-ink);
        font-family: ${config.text.fontFamily};
      }
      .ping-editor * {
        box-sizing: border-box;
      }
      .ping-editor__layout {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        min-width: 0;
        min-height: 0;
        height: 100%;
      }
      .ping-editor__toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        min-height: ${collapsedSidebarWidthPx}px;
        padding: 5px 10px;
        border-bottom: 1px solid var(--ping-chrome-border-strong);
        background: var(--ping-chrome-shell);
        backdrop-filter: blur(18px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
      }
      .ping-editor__toolbar-group {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        align-items: center;
      }
      .ping-editor__toolbar .ping-editor__panel-button,
      .ping-editor__toolbar-label {
        font-size: 11px;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: 0.04em;
      }
      .ping-editor__toolbar .ping-editor__panel-button {
        min-height: 24px;
        padding: 3px 8px;
        border-radius: 10px;
        border-color: var(--ping-chrome-border);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
      }
      .ping-editor__toolbar .ping-editor__icon-button {
        width: 24px;
        height: 24px;
        padding: 0;
        border-radius: 8px;
      }
      .ping-editor__toolbar .ping-editor__icon-button span {
        font-size: 12px;
      }
      .ping-editor__field.ping-editor__toolbar-field {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .ping-editor__toolbar-label {
        color: var(--ping-chrome-ink-muted);
        white-space: nowrap;
      }
      .ping-editor__toolbar-slider {
        width: 120px;
        min-width: 120px;
        height: 16px;
        margin: 0;
        accent-color: var(--ping-chrome-accent);
        cursor: pointer;
      }
      .ping-editor__viewport-shell {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        background:
          radial-gradient(circle at top left, rgba(31, 106, 122, 0.08), transparent 28%),
          linear-gradient(180deg, rgba(255,255,255,0.55), rgba(247, 244, 239, 0.2));
      }
      .ping-editor__viewport {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        outline: none;
        touch-action: none;
      }
      .ping-editor__viewport:focus-visible {
        box-shadow: inset 0 0 0 2px ${config.selection.color};
      }
      .ping-editor__sidebar {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 3;
        min-width: ${sidebarWidthCss};
        width: ${sidebarWidthCss};
        max-width: ${sidebarWidthCss};
        border-left: 1px solid var(--ping-chrome-border-strong);
        background: var(--ping-chrome-shell);
        box-shadow: -10px 0 30px var(--ping-chrome-shadow);
        color: var(--ping-chrome-ink);
        height: 100%;
        min-height: 0;
        overflow: visible;
      }
      .ping-editor__sidebar.is-collapsed {
        min-width: ${collapsedSidebarWidthPx}px;
        width: ${collapsedSidebarWidthPx}px;
        max-width: ${collapsedSidebarWidthPx}px;
      }
      .ping-editor__sidebar-content {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .ping-editor__sidebar-header {
        display: grid;
        background: var(--ping-chrome-shell);
        border-bottom: 1px solid var(--ping-chrome-border-strong);
      }
      .ping-editor__sidebar-toggle {
        position: absolute;
        top: 12px;
        inset-inline-start: 0;
        transform: translateX(-100%);
        z-index: 2;
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--ping-chrome-border-strong);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink-strong);
        border-radius: 999px;
        font: inherit;
        cursor: pointer;
        line-height: 1;
        box-shadow: -4px 10px 24px rgba(95, 49, 41, 0.22);
      }
      .ping-editor__sidebar.is-collapsed .ping-editor__sidebar-toggle {
        inset-inline-start: 50%;
        transform: translateX(-50%);
      }
      .ping-editor__sidebar-toggle:hover {
        transform: translateY(-1px);
      }
      .ping-editor__sidebar:not(.is-collapsed) .ping-editor__sidebar-toggle:hover {
        transform: translate(-100%, -1px);
      }
      .ping-editor__sidebar.is-collapsed .ping-editor__sidebar-toggle:hover {
        transform: translate(-50%, -1px);
      }
      .ping-editor__sidebar-toggle-icon {
        font-size: 14px;
        font-weight: 700;
      }
      .ping-editor__tabs {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
        align-items: stretch;
        min-height: ${collapsedSidebarWidthPx}px;
        padding: 0;
      }
      .ping-editor__tab + .ping-editor__tab {
        border-inline-start: 1px solid rgba(83, 41, 33, 0.12);
      }
      .ping-editor__panel-button,
      .ping-editor__menu-item,
      .ping-editor__mini-button {
        border: 1px solid ${config.panel.border};
        background: #fff;
        color: ${config.panel.text};
        border-radius: 999px;
        font: inherit;
        cursor: pointer;
      }
      .ping-editor__tab {
        position: relative;
        display: grid;
        place-items: center;
        justify-self: stretch;
        width: 100%;
        min-width: 0;
        min-height: ${collapsedSidebarWidthPx}px;
        height: 100%;
        padding: 0 8px;
        border: 0;
        background: transparent;
        color: var(--ping-chrome-ink-muted);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: 0.04em;
        text-align: center;
        text-wrap: balance;
        cursor: pointer;
        transition:
          background-color 120ms ease,
          color 120ms ease,
          box-shadow 140ms ease;
      }
      .ping-editor__tab-label {
        display: block;
        max-width: 100%;
        margin: 0 auto;
      }
      .ping-editor__panel-button,
      .ping-editor__menu-item,
      .ping-editor__mini-button {
        font: inherit;
      }
      .ping-editor__tab:disabled,
      .ping-editor__panel-button:disabled,
      .ping-editor__menu-item:disabled,
      .ping-editor__mini-button:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .ping-editor__panel-button,
      .ping-editor__menu-item {
        padding: 8px 12px;
      }
      .ping-editor__sidebar .ping-editor__panel-button,
      .ping-editor__sidebar .ping-editor__mini-button {
        border-color: var(--ping-chrome-border);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
      }
      .ping-editor__sidebar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-end;
        padding: 8px 14px 10px;
        border-top: 1px solid rgba(83, 41, 33, 0.12);
      }
      .ping-editor__sidebar-action {
        padding: 5px 10px;
        border-radius: 12px;
        border-color: var(--ping-chrome-border);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink-muted);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: lowercase;
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          color 120ms ease;
      }
      .ping-editor__mini-button {
        padding: 4px 8px;
        border-radius: 12px;
      }
      .ping-editor__icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        flex: 0 0 auto;
      }
      .ping-editor__icon-button svg {
        width: 18px;
        height: 18px;
      }
      .ping-editor__icon-button span {
        font-size: 16px;
        line-height: 1;
      }
      .ping-editor__panel-button.is-primary {
        color: #fff;
      }
      .ping-editor__tab.is-active {
        background: var(--ping-chrome-plate);
        color: var(--ping-chrome-ink-strong);
        box-shadow: inset 0 -2px 0 var(--ping-chrome-accent);
      }
      .ping-editor__toolbar .ping-editor__panel-button.is-primary,
      .ping-editor__sidebar .ping-editor__panel-button.is-primary {
        background: var(--ping-chrome-accent);
        border-color: var(--ping-chrome-accent);
        color: var(--ping-chrome-on-accent);
        box-shadow: 0 10px 18px rgba(95, 49, 41, 0.16);
      }
      .ping-editor__toolbar .ping-editor__panel-button.is-danger,
      .ping-editor__sidebar .ping-editor__panel-button.is-danger {
        color: #7f2e26;
      }
      .ping-editor__tab:hover {
        background: var(--ping-chrome-plate);
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__tab:focus-visible {
        outline: none;
        background: var(--ping-chrome-plate-hover);
        color: var(--ping-chrome-ink-strong);
        box-shadow:
          inset 0 -2px 0 var(--ping-chrome-accent),
          0 0 0 2px var(--ping-chrome-focus);
      }
      .ping-editor__tab.is-active:focus-visible {
        background: var(--ping-chrome-plate);
      }
      .ping-editor__tab.has-notice,
      .ping-editor__tab.has-notice:hover,
      .ping-editor__tab.has-notice:focus-visible {
        color: var(--ping-chrome-notice);
      }
      .ping-editor__toolbar .ping-editor__panel-button:hover,
      .ping-editor__sidebar .ping-editor__panel-button:hover,
      .ping-editor__sidebar .ping-editor__mini-button:hover {
        background: var(--ping-chrome-plate-hover);
        border-color: var(--ping-chrome-border-strong);
        color: var(--ping-chrome-ink-strong);
        transform: none;
      }
      .ping-editor__panel-button:hover,
      .ping-editor__mini-button:hover {
        transform: translateY(-1px);
      }
      .ping-editor__toolbar .ping-editor__panel-button:hover {
        transform: none;
      }
      .ping-editor__tab:disabled:hover,
      .ping-editor__panel-button:disabled:hover,
      .ping-editor__menu-item:disabled:hover,
      .ping-editor__mini-button:disabled:hover {
        transform: none;
      }
      .ping-editor__sidebar-action:hover {
        transform: none;
        background: var(--ping-chrome-plate-hover);
        border-color: var(--ping-chrome-accent-outline);
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__save-action-button {
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          color 120ms ease,
          box-shadow 140ms ease;
      }
      .ping-editor__save-action-button:hover,
      .ping-editor__save-action-button:active,
      .ping-editor__save-action-button.is-feedback-active,
      .ping-editor__save-action-button.is-feedback-success {
        transform: none;
      }
      .ping-editor__save-action-button:hover {
        background: rgba(141, 69, 54, 0.08);
        border-color: var(--ping-chrome-accent-outline);
      }
      .ping-editor__save-action-button:active,
      .ping-editor__save-action-button.is-feedback-active {
        background: rgba(141, 69, 54, 0.16);
        border-color: rgba(141, 69, 54, 0.42);
        color: var(--ping-chrome-accent-strong);
        box-shadow: inset 0 0 0 1px rgba(141, 69, 54, 0.08);
      }
      .ping-editor__save-action-button.is-feedback-success {
        background: rgba(141, 69, 54, 0.2);
        border-color: rgba(141, 69, 54, 0.48);
        color: var(--ping-chrome-accent-strong);
        box-shadow: 0 0 0 3px rgba(141, 69, 54, 0.16);
      }
      .ping-editor__panel-scroll {
        overflow: auto;
        padding: 14px;
        min-height: 0;
      }
      .ping-editor__panel-section {
        display: grid;
        gap: 10px;
        margin-bottom: 18px;
      }
      .ping-editor__panel-title,
      .ping-editor__group-section h3,
      .ping-editor__group-header h2 {
        margin: 0;
        font-size: 13px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .ping-editor__sidebar .ping-editor__panel-title {
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__panel-list,
      .ping-editor__samples,
      .ping-editor__diagnostics,
      .ping-editor__mapping-list {
        display: grid;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .ping-editor__output-entry {
        padding: 10px 12px;
        border-radius: 16px;
        border: 1px solid var(--ping-chrome-border);
        background: var(--ping-chrome-card);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
        word-break: break-word;
      }
      .ping-editor__palette-item,
      .ping-editor__group-item,
      .ping-editor__sample-slot,
      .ping-editor__diagnostic,
      .ping-editor__mapping-item {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 16px;
        border: 1px solid var(--ping-chrome-border);
        background: var(--ping-chrome-card);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
        transition:
          border-color 120ms ease,
          box-shadow 140ms ease;
      }
      .ping-editor__diagnostic {
        cursor: pointer;
      }
      .ping-editor__diagnostic.is-stale {
        opacity: 0.6;
      }
      .ping-editor__group-item {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
      }
      .ping-editor__palette-item {
        text-align: left;
      }
      .ping-editor__group-item:hover,
      .ping-editor__mapping-item:hover {
        border-color: var(--ping-chrome-notice-border);
      }
      .ping-editor__palette-label,
      .ping-editor__group-name {
        font-weight: 700;
      }
      .ping-editor__sample-slot {
        position: relative;
        gap: 8px;
      }
      .ping-editor__sample-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ping-editor__sample-label {
        color: var(--ping-chrome-ink-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .ping-editor__sample-name {
        color: var(--ping-chrome-ink-strong);
        font-weight: 700;
        word-break: break-word;
      }
      .ping-editor__sample-slot.is-empty .ping-editor__sample-name {
        font-weight: 600;
      }
      .ping-editor__sample-button {
        padding: 4px 8px;
        min-height: 24px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: 0.04em;
      }
      .ping-editor__palette-meta,
      .ping-editor__group-meta,
      .ping-editor__diagnostic-code,
      .ping-editor__sample-path,
      .ping-editor__inspect-copy {
        color: var(--ping-chrome-ink-muted);
        word-break: break-word;
      }
      .ping-editor__field {
        display: grid;
        gap: 6px;
      }
      .ping-editor__sidebar .ping-editor__input {
        width: 100%;
        border: 1px solid var(--ping-chrome-border);
        border-radius: 12px;
        padding: 9px 12px;
        font: inherit;
        background: rgba(255, 250, 247, 0.94);
        color: var(--ping-chrome-ink-strong);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
      }
      .ping-editor__sidebar .ping-editor__panel-textarea {
        width: 100%;
        min-height: 240px;
        border: 1px solid var(--ping-chrome-border);
        border-radius: 16px;
        padding: 12px;
        background: rgba(255, 250, 247, 0.94);
        color: var(--ping-chrome-ink-strong);
        resize: vertical;
        font: 12px/1.45 ${config.text.fontFamily};
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
      }
      .ping-editor__sidebar .ping-editor__input:focus,
      .ping-editor__sidebar .ping-editor__panel-textarea:focus {
        outline: 2px solid var(--ping-chrome-focus);
        border-color: var(--ping-chrome-accent);
      }
      .ping-editor__sample-file-input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(100%);
        white-space: nowrap;
        border: 0;
        pointer-events: none;
      }
      .ping-editor__action-row,
      .ping-editor__mapping-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .ping-editor__menu {
        position: absolute;
        z-index: 20;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        gap: 10px;
        padding: 14px;
        min-height: 0;
        background: rgba(251, 250, 248, 0.97);
        border: 1px solid var(--ping-chrome-border-strong);
        border-radius: 24px;
        box-shadow: 0 24px 50px var(--ping-chrome-shadow);
        overflow: hidden;
      }
      .ping-editor__menu-categories {
        display: grid;
        gap: 6px;
      }
      .ping-editor__menu-category-row {
        display: grid;
        grid-template-columns: repeat(var(--ping-menu-category-columns), minmax(0, 1fr));
        gap: 6px;
      }
      .ping-editor__menu-category {
        min-width: 0;
        min-height: 36px;
        border: 1px solid var(--ping-chrome-border);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink);
        border-radius: 14px;
        padding: 7px 8px;
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: 0.03em;
        cursor: pointer;
        text-wrap: balance;
        text-transform: lowercase;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          color 120ms ease,
          box-shadow 140ms ease;
      }
      .ping-editor__menu-category.is-active {
        background: var(--ping-chrome-notice-soft);
        color: var(--ping-chrome-notice);
        border-color: var(--ping-chrome-notice-border);
      }
      .ping-editor__menu-category:hover {
        transform: none;
        background: var(--ping-chrome-plate-hover);
        border-color: var(--ping-chrome-notice-border);
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__menu-category:focus-visible {
        outline: none;
        background: var(--ping-chrome-plate-hover);
        border-color: var(--ping-chrome-notice-border);
        color: var(--ping-chrome-ink-strong);
        box-shadow: 0 0 0 2px rgba(133, 184, 255, 0.16);
      }
      .ping-editor__menu-list {
        display: grid;
        gap: 6px;
        min-height: 0;
        overflow: auto;
      }
      .ping-editor__menu-item {
        display: flex;
        gap: 10px;
        align-items: center;
        text-align: left;
        padding: 9px 12px;
        border-radius: 16px;
        border-color: var(--ping-chrome-border);
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink-strong);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.24);
      }
      .ping-editor__menu-item:hover {
        transform: none;
        border-color: var(--ping-chrome-notice-border);
      }
      .ping-editor__menu-item-icon-wrap {
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        background: var(--ping-chrome-plate);
        flex: 0 0 auto;
      }
      .ping-editor__menu-item-icon {
        display: block;
      }
      .ping-editor__menu-item-label {
        font-weight: 700;
        line-height: 1.2;
      }
      .ping-editor__menu-empty {
        color: var(--ping-chrome-ink-muted);
        line-height: 1.35;
      }
      .ping-editor__menu-empty {
        margin: 0;
        padding: 8px 4px;
      }
      .ping-editor__group-dialog {
        position: absolute;
        right: 22px;
        top: 18px;
        z-index: 18;
        width: min(420px, calc(100% - 44px));
        max-height: calc(100% - 36px);
        overflow: auto;
        padding: 22px 18px 18px;
        border-radius: 24px;
        border: 1px solid var(--ping-chrome-border-strong);
        background: rgba(251, 250, 248, 0.97);
        box-shadow: 0 24px 50px var(--ping-chrome-shadow);
      }
      .ping-editor__group-dialog.is-sidebar-open {
        right: calc(${sidebarWidthCss} + 22px);
        max-width: calc(100% - ${sidebarWidthCss} - 44px);
      }
      .ping-editor__group-dialog.is-sidebar-collapsed {
        right: calc(${collapsedSidebarWidthPx}px + 22px);
        max-width: calc(100% - ${collapsedSidebarWidthPx}px - 44px);
      }
      .ping-editor__group-header {
        display: flex;
        gap: 10px;
        justify-content: space-between;
        align-items: flex-start;
        padding-top: 4px;
        margin-bottom: 14px;
      }
      .ping-editor__group-header .ping-editor__panel-button {
        margin-top: 2px;
      }
      .ping-editor__group-subtitle {
        margin: 4px 0 0;
        color: #6d675e;
      }
      .ping-editor__group-section {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .ping-editor__mapping-arrow {
        opacity: 0.45;
      }
      .ping-editor__empty {
        margin: 0;
        color: #6d675e;
      }
      .ping-editor__group-dialog .ping-editor__panel-button:hover,
      .ping-editor__group-dialog .ping-editor__mini-button:hover,
      .ping-editor__group-item .ping-editor__panel-button:hover {
        transform: none;
        border-color: var(--ping-chrome-notice-border);
      }
      .ping-editor__svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .ping-editor__corner.is-selected {
        stroke: ${selectionHighlightColor};
        stroke-width: var(--ping-selection-stroke-width, ${config.selection.strokeWidthPx});
      }
      .ping-editor__node.is-hovered,
      .ping-editor__edge-path.is-hovered,
      .ping-editor__port.is-hovered {
        filter: brightness(0.97);
      }
      .ping-editor__node-selection-ring {
        pointer-events: none;
      }
      .ping-editor__edge-path.is-selected {
        stroke: ${selectionHighlightColor};
      }
      .ping-editor__diagnostic-stale {
        color: #9f7d2f;
        font-weight: 700;
      }
      .ping-editor__svg text {
        font-family: ${config.text.fontFamily};
        font-weight: ${config.text.fontWeight};
      }
      @media (max-width: 1180px) {
        .ping-editor {
          grid-template-rows: minmax(0, 1fr) auto;
          gap: 18px;
        }
        .ping-editor__layout {
          height: auto;
        }
        .ping-editor__viewport-shell {
          min-height: clamp(480px, 72vw, 640px);
        }
        .ping-editor__viewport {
          position: relative;
          inset: auto;
          min-height: clamp(480px, 72vw, 640px);
        }
        .ping-editor__sidebar {
          position: relative;
          top: auto;
          right: auto;
          bottom: auto;
          width: 100%;
          min-width: 0;
          max-width: none;
          height: auto;
          border-left: 0;
          border-top: 1px solid var(--ping-chrome-border-strong);
          box-shadow: 0 -6px 20px var(--ping-chrome-shadow);
        }
        .ping-editor__sidebar.is-collapsed {
          min-width: 0;
          width: 100%;
          max-width: none;
          min-height: ${collapsedSidebarWidthPx}px;
          height: ${collapsedSidebarWidthPx}px;
        }
        .ping-editor__sidebar-toggle,
        .ping-editor__sidebar.is-collapsed .ping-editor__sidebar-toggle {
          top: 0;
          inset-inline-start: 50%;
          transform: translate(-50%, -50%);
        }
        .ping-editor__sidebar-toggle:hover,
        .ping-editor__sidebar:not(.is-collapsed) .ping-editor__sidebar-toggle:hover,
        .ping-editor__sidebar.is-collapsed .ping-editor__sidebar-toggle:hover {
          transform: translate(-50%, calc(-50% - 1px));
        }
        .ping-editor__sidebar-toggle-icon {
          display: inline-block;
          transform: rotate(90deg);
        }
      }
      @media (max-width: 720px) {
        .ping-editor__menu {
          border-radius: 24px;
          box-shadow: 0 20px 45px ${config.panel.shadow};
        }
      }
    </style>
  `;
}

function buildPanelMarkup(state) {
  const tab = state.activeTab;
  const combinedIssues = [...state.localIssues, ...state.diagnostics];
  const extensionTab = state.sidebarExtensions.tabs.find((entry) => entry.id === tab);

  if (extensionTab) {
    return extensionTab.markup;
  }

  if (tab === "console") {
    return renderDiagnosticsPanel({
      issues: combinedIssues,
      snapshot: state.snapshot,
    });
  }

  if (tab === "inspect") {
    if (state.groupSelection.nodeIds.length > 1) {
      return buildMultiNodeInspectPanel(state.groupSelection.nodeIds);
    }

    return buildSelectionInspectPanel(state.snapshot, state.registry, state.selection);
  }

  if (tab === "groups") {
    return renderGroupsPanel({
      groups: state.snapshot.groups ?? {},
      snapshot: state.snapshot,
    });
  }

  if (tab === "samples") {
    return renderSamplesPanel({
      sampleFileLabels: state.sampleFileLabels,
      slots: state.slots,
    });
  }

  return renderDiagnosticsPanel({
    issues: combinedIssues,
    snapshot: state.snapshot,
  });
}

function buildMenuMarkup(state) {
  if (!state.menu.open) {
    return "";
  }

  const margin = 12;
  const compact = state.viewportSize.width <= 720;
  const maxWidth = Math.max(0, state.viewportSize.width - margin * 2);
  const width = compact
    ? maxWidth
    : Math.min(maxWidth, Math.min(360, Math.max(280, Math.round(state.viewportSize.width * 0.34))));
  const maxHeight = Math.max(0, Math.min(420, state.viewportSize.height - margin * 2));
  const x = compact
    ? margin
    : clamp(
        state.menu.screen.x,
        margin,
        Math.max(margin, state.viewportSize.width - width - margin),
      );
  const y = compact
    ? Math.max(margin, state.viewportSize.height - maxHeight - margin)
    : clamp(
        state.menu.screen.y,
        margin,
        Math.max(margin, state.viewportSize.height - maxHeight - margin),
      );

  return `
    <div
      class="ping-editor__menu"
      style="left:${x}px; top:${y}px; width:${width}px; max-height:${maxHeight}px;"
      data-testid="palette-menu"
      data-menu-layout="${compact ? "compact" : "floating"}"
    >
      ${renderPaletteMenu({
        palette: state.palette,
        groups: state.snapshot.groups ?? {},
        activeCategory: state.menu.category,
        icons: state.config.icons,
      })}
    </div>
  `;
}

function selectionToFocusTarget(snapshot, issue) {
  if (issue.nodeId && snapshot.nodes.some((node) => node.id === issue.nodeId)) {
    return { kind: "node", nodeId: issue.nodeId };
  }

  if (issue.edgeId && snapshot.edges.some((edge) => edge.id === issue.edgeId)) {
    return { kind: "edge", edgeId: issue.edgeId };
  }

  return null;
}

function createGroupDraft(state) {
  const candidates = buildGroupCandidates(state.snapshot, state.groupSelection, state.registry);

  return {
    mode: "create",
    open: true,
    name: `Group ${createDeterministicId("group", state).replace("group-", "")}`,
    candidates,
    selectedNodeIds: [...state.groupSelection.nodeIds],
    mappings: {
      inputs: candidates.inputs.map((entry) => ({ ...entry })),
      outputs: candidates.outputs.map((entry) => ({ ...entry })),
      controls: candidates.controls.map((entry) => ({ ...entry })),
    },
    available: {
      inputs: [],
      outputs: [],
      controls: [],
    },
    restoreSelection: {
      inputs: candidates.inputs[0]?.id ?? "",
      outputs: candidates.outputs[0]?.id ?? "",
      controls: candidates.controls[0]?.id ?? "",
    },
  };
}

function createGroupEditDraft(state, group) {
  const candidates = buildGroupDefinitionCandidates(group, state.registry);
  const candidateMaps = {
    inputs: new Map(candidates.inputs.map((entry) => [entry.id, entry])),
    outputs: new Map(candidates.outputs.map((entry) => [entry.id, entry])),
    controls: new Map(candidates.controls.map((entry) => [entry.id, entry])),
  };
  const mappings = {
    inputs: group.inputs.map((entry) =>
      candidateMaps.inputs.get(createGroupMappingId("inputs", entry)) ??
      createFallbackGroupMappingEntry("inputs", entry),
    ),
    outputs: group.outputs.map((entry) =>
      candidateMaps.outputs.get(createGroupMappingId("outputs", entry)) ??
      createFallbackGroupMappingEntry("outputs", entry),
    ),
    controls: group.controls.map((entry) =>
      candidateMaps.controls.get(createGroupMappingId("controls", entry)) ??
      createFallbackGroupMappingEntry("controls", entry),
    ),
  };
  const activeIds = {
    inputs: new Set(mappings.inputs.map((entry) => entry.id)),
    outputs: new Set(mappings.outputs.map((entry) => entry.id)),
    controls: new Set(mappings.controls.map((entry) => entry.id)),
  };
  const available = {
    inputs: candidates.inputs.filter((entry) => !activeIds.inputs.has(entry.id)),
    outputs: candidates.outputs.filter((entry) => !activeIds.outputs.has(entry.id)),
    controls: candidates.controls.filter((entry) => !activeIds.controls.has(entry.id)),
  };

  return {
    mode: "edit",
    open: true,
    groupId: group.id,
    name: group.name,
    candidates,
    selectedNodeIds: group.graph.nodes.map((node) => node.id),
    mappings,
    available,
    restoreSelection: {
      inputs: available.inputs[0]?.id ?? "",
      outputs: available.outputs[0]?.id ?? "",
      controls: available.controls[0]?.id ?? "",
    },
  };
}

function readSidebarTabsScrollLeft(root) {
  return root?.querySelector?.(".ping-editor__tabs")?.scrollLeft ?? 0;
}

function restoreSidebarTabsScrollLeft(root, scrollLeft) {
  const tabs = root?.querySelector?.(".ping-editor__tabs");

  if (!tabs) {
    return;
  }

  tabs.scrollLeft = scrollLeft;
}

function readMenuCategoriesScrollLeft(root) {
  return root?.querySelector?.(".ping-editor__menu-categories")?.scrollLeft ?? 0;
}

function restoreMenuCategoriesScrollLeft(root, scrollLeft) {
  const categories = root?.querySelector?.(".ping-editor__menu-categories");

  if (!categories) {
    return;
  }

  categories.scrollLeft = scrollLeft;
}

function readGroupDialogScrollTop(root) {
  return root?.querySelector?.(".ping-editor__group-dialog")?.scrollTop ?? 0;
}

function restoreGroupDialogScrollTop(root, scrollTop) {
  const dialog = root?.querySelector?.(".ping-editor__group-dialog");

  if (!dialog) {
    return;
  }

  dialog.scrollTop = scrollTop;
}

function focusElementWithoutScroll(element) {
  if (!element?.focus) {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function readGroupDialogFocusState(root) {
  const activeElement = root?.ownerDocument?.activeElement;

  if (
    !activeElement ||
    typeof activeElement.matches !== "function" ||
    !root?.contains?.(activeElement) ||
    !activeElement.closest(".ping-editor__group-dialog")
  ) {
    return null;
  }

  return {
    tagName: activeElement.tagName.toLowerCase(),
    attributes: [
      "data-action",
      "data-group-kind",
      "data-group-id",
      "data-group-index",
      "data-group-direction",
      "data-testid",
      "name",
      "type",
    ]
      .map((name) => [name, activeElement.getAttribute(name)])
      .filter(([, value]) => value !== null),
    selectionStart:
      typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd:
      typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
  };
}

function restoreGroupDialogFocus(root, focusState) {
  if (!focusState) {
    return false;
  }

  const dialog = root?.querySelector?.(".ping-editor__group-dialog");

  if (!dialog) {
    return false;
  }

  const nextElement = Array.from(dialog.querySelectorAll(focusState.tagName)).find((element) =>
    focusState.attributes.every(([name, value]) => element.getAttribute(name) === value),
  );

  if (!nextElement) {
    return false;
  }

  focusElementWithoutScroll(nextElement);

  if (
    focusState.selectionStart !== null &&
    focusState.selectionEnd !== null &&
    typeof nextElement.setSelectionRange === "function"
  ) {
    try {
      nextElement.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    } catch {}
  }

  return true;
}

function moveArrayEntry(list, index, nextIndex) {
  if (index < 0 || index >= list.length || nextIndex < 0 || nextIndex >= list.length) {
    return list;
  }

  const copy = [...list];
  const [entry] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, entry);
  return copy;
}

async function readFileAsDataUrl(file) {
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

export function createEditor({ registry, runtime, onOutput, onSidebarAction, sidebarExtensions, config }) {
  const resolvedConfig = mergeUIConfig(undefined, config ?? {});
  const state = {
    registry,
    runtime,
    config: resolvedConfig,
    root: null,
    viewport: null,
    snapshot: createEmptyGraphSnapshot(),
    routes: createEmptyRoutes(),
    diagnostics: [],
    localIssues: createEmptyNoticeList(),
    palette: [],
    selection: createEmptySelection(),
    groupSelection: createEmptyGroupSelection(),
    hover: createEmptyHover(),
    drag: createEmptyDragState(),
    pan: null,
    camera: createDefaultCamera(),
    viewportSize: createViewportFallback(),
    sampleFileLabels: new Map(),
    menu: {
      open: false,
      screen: { x: 48, y: 48 },
      world: { x: 2, y: 2 },
      category: DEFAULT_PALETTE_MENU_CATEGORY_ID,
    },
    sidebarExtensions: normalizeSidebarExtensions(sidebarExtensions),
    sidebarCollapsed: false,
    activeTab: "console",
    slots: createDefaultSampleSlots(),
    tempo: DEFAULT_TEMPO_BPM,
    thumbs: [],
    frameId: null,
    dirty: true,
    mounted: false,
    thumbOnlyDirty: false,
    viewportOnlyDirty: false,
    lastFrameAt: null,
    frameDurationMs: 16,
    previewThrottleMs: 0,
    lastPreviewUpdateAt: 0,
    boxSelection: null,
    lastPointerWorld: { x: 2, y: 2 },
    lastPointerScreen: { x: 48, y: 48 },
    nodePositionOverrides: new Map(),
    pointerPress: null,
    dragStarted: false,
    edgeCreatePointerActive: false,
    suppressViewportClick: false,
    groupDraft: null,
    idCounters: createIdFactory(),
    creationOffset: 0,
    sidebarTabsScrollLeft: 0,
    menuCategoriesScrollLeft: 0,
    groupDialogScrollTop: 0,
    history: {
      canUndo: false,
      canRedo: false,
    },
    clipboardPayload: null,
    lastClipboardSignature: null,
    pasteRepeatCount: 0,
  };

  function markDirty() {
    state.dirty = true;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
  }

  function markViewportDirty() {
    if (state.dirty && !state.thumbOnlyDirty && !state.viewportOnlyDirty) {
      return;
    }

    state.dirty = true;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = true;
  }

  function emitOutput(output) {
    onOutput?.(output);
  }

  function updateTempo(value, { emit = false, control = null } = {}) {
    const nextTempo = normalizeTempo(value);
    const changed = nextTempo !== state.tempo;
    state.tempo = nextTempo;

    const tempoInput =
      control?.matches?.("[data-action='tempo']") ? control : state.root?.querySelector("[data-action='tempo']");
    syncRangeValue(tempoInput, nextTempo);

    if (changed && emit) {
      emitOutput({
        type: "audio/updateTempo",
        payload: { bpm: nextTempo },
      });
    }

    return changed;
  }

  function requestUndo() {
    if (!state.history.canUndo) {
      return;
    }

    emitOutput({ type: "ui/requestUndo" });
    focusViewport();
  }

  function requestRedo() {
    if (!state.history.canRedo) {
      return;
    }

    emitOutput({ type: "ui/requestRedo" });
    focusViewport();
  }

  function pushLocalIssue(code, message, extra = {}) {
    state.localIssues = [
      createLocalIssue(code, message, extra),
      ...state.localIssues,
    ].slice(0, 6);
    markDirty();
  }

  function emitSelection(nextSelection) {
    const normalized = clearDeletedSelection(normalizeSelection(nextSelection), state.snapshot);

    if (!selectionEquals(state.selection, normalized)) {
      state.selection = normalized;
      emitOutput({
        type: "ui/selectionChanged",
        payload: normalized,
      });
    } else {
      state.selection = normalized;
    }

    markDirty();
  }

  function getExistingNodeIdSet(nodeIds) {
    const existingIds = new Set(state.snapshot.nodes.map((node) => node.id));
    return normalizeGroupSelection({
      nodeIds: nodeIds.filter((nodeId) => existingIds.has(nodeId)),
    });
  }

  function getSelectedNodeIds() {
    const normalized = getExistingNodeIdSet(state.groupSelection.nodeIds);

    if (
      normalized.nodeIds.length === 0 &&
      state.selection.kind === "node" &&
      state.snapshot.nodes.some((node) => node.id === state.selection.nodeId)
    ) {
      return [state.selection.nodeId];
    }

    return normalized.nodeIds;
  }

  function setNodeSetSelection(nodeIds, preferredNodeId = null) {
    const normalized = getExistingNodeIdSet(nodeIds);
    state.groupSelection = normalized;

    if (normalized.nodeIds.length === 0) {
      emitSelection(createEmptySelection());
      return;
    }

    const nextPrimaryNodeId = normalized.nodeIds.includes(preferredNodeId)
      ? preferredNodeId
      : normalized.nodeIds[normalized.nodeIds.length - 1];
    emitSelection({ kind: "node", nodeId: nextPrimaryNodeId });
  }

  function clearNodeSetSelection() {
    state.groupSelection = createEmptyGroupSelection();
  }

  function getRenderableNodePosition(nodeId) {
    return (
      state.nodePositionOverrides.get(nodeId) ??
      state.snapshot.nodes.find((node) => node.id === nodeId)?.pos ??
      null
    );
  }

  function setNodePositionOverridesForIds(positionsByNodeId) {
    const nextOverrides = new Map(
      Array.from(state.nodePositionOverrides.entries()).filter(
        ([nodeId]) => !Object.hasOwn(positionsByNodeId, nodeId),
      ),
    );

    for (const [nodeId, pos] of Object.entries(positionsByNodeId)) {
      nextOverrides.set(nodeId, pos);
    }

    state.nodePositionOverrides = nextOverrides;
  }

  function clearNodePositionOverrides(nodeIds) {
    const nodeIdSet = new Set(nodeIds);
    state.nodePositionOverrides = new Map(
      Array.from(state.nodePositionOverrides.entries()).filter(([nodeId]) => !nodeIdSet.has(nodeId)),
    );
  }

  function getNodeDragIds(nodeId) {
    const selectedNodeIds = getSelectedNodeIds();

    if (selectedNodeIds.includes(nodeId)) {
      return selectedNodeIds;
    }

    return [nodeId];
  }

  function hasMultiNodeSelection() {
    return getSelectedNodeIds().length > 1;
  }

  function getClipboardSignature(payload) {
    return JSON.stringify(payload);
  }

  function getPasteTargetPosition() {
    const pointerInsideViewport =
      state.lastPointerScreen.x >= 0 &&
      state.lastPointerScreen.y >= 0 &&
      state.lastPointerScreen.x <= state.viewportSize.width &&
      state.lastPointerScreen.y <= state.viewportSize.height;
    const base = pointerInsideViewport ? state.lastPointerWorld : getViewportCenterWorld();
    const repeatOffset = state.pasteRepeatCount * 2;

    return snapWorldPoint(
      {
        x: base.x + repeatOffset,
        y: base.y + repeatOffset,
      },
      state.config,
    );
  }

  function rememberClipboardPayload(payload) {
    state.clipboardPayload = cloneValue(payload);
    state.lastClipboardSignature = getClipboardSignature(payload);
    state.pasteRepeatCount = 0;
  }

  function openMenuAt(screen, world) {
    state.menu = {
      ...state.menu,
      open: true,
      screen: { ...screen },
      world: { ...world },
      category: DEFAULT_PALETTE_MENU_CATEGORY_ID,
    };
    state.menuCategoriesScrollLeft = 0;
    state.creationOffset = 0;
    markDirty();
  }

  function closeMenu({ restoreViewportFocus = false } = {}) {
    if (!state.menu.open) {
      if (restoreViewportFocus) {
        focusViewport();
      }
      return;
    }

    state.menu = {
      ...state.menu,
      open: false,
    };
    if (restoreViewportFocus) {
      focusViewport();
    }
    markDirty();
  }

  function focusViewport() {
    if (!state.viewport?.focus) {
      return;
    }

    if (state.root?.ownerDocument?.activeElement === state.viewport) {
      return;
    }

    focusElementWithoutScroll(state.viewport);
  }

  function getViewportRect() {
    return state.viewport?.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: state.viewportSize.width,
      height: state.viewportSize.height,
    };
  }

  function updateViewportSize() {
    if (!state.viewport) {
      return;
    }

    const size = getViewportSize(state.viewport);

    if (size.width > 0 && size.height > 0) {
      const nextCamera = clampCamera(state.camera, size, state.config);
      const sizeChanged =
        state.viewportSize.width !== size.width || state.viewportSize.height !== size.height;
      const cameraChanged =
        state.camera.x !== nextCamera.x ||
        state.camera.y !== nextCamera.y ||
        state.camera.scale !== nextCamera.scale;

      if (sizeChanged || cameraChanged) {
        state.viewportSize = size;
        state.camera = nextCamera;
        markDirty();
      }
    }
  }

  function getViewportCenterWorld() {
    return {
      x:
        (state.viewportSize.width / 2 - state.camera.x) /
        (state.camera.scale * state.config.grid.GRID_PX),
      y:
        (state.viewportSize.height / 2 - state.camera.y) /
        (state.camera.scale * state.config.grid.GRID_PX),
    };
  }

  function getNextCreatePosition() {
    const step = 4;
    const base = state.menu.open
      ? state.menu.world
      : state.lastPointerWorld ?? getViewportCenterWorld();
    const offset = state.creationOffset;
    state.creationOffset += 1;

    return snapWorldPoint(
      {
        x: base.x + offset * step,
        y: base.y + (offset % 2 === 0 ? 0 : 2),
      },
      state.config,
    );
  }

  function emitUndo(reason) {
    emitOutput(createUndoOutput(state.snapshot, reason));
  }

  function emitGraphOps(ops, reason) {
    if (!Array.isArray(ops) || ops.length === 0) {
      return;
    }

    emitOutput(createGraphOpsOutput(ops, reason));
  }

  function createGroupNodeRecord(groupRef) {
    return {
      id: createDeterministicId("node", state),
      type: "group",
      groupRef,
      pos: getNextCreatePosition(),
      rot: 0,
      params: {},
    };
  }

  function handleCreateNode(type, groupRef = null) {
    const definition = groupRef ? state.registry.getNodeDefinition("group") : state.registry.getNodeDefinition(type);

    if (!definition && !groupRef) {
      pushLocalIssue("UI_UNKNOWN_NODE_TYPE", `Node type "${type}" is not available in the registry.`);
      return;
    }

    const node = groupRef
      ? createGroupNodeRecord(groupRef)
      : createNodeRecord(createDeterministicId("node", state), definition, getNextCreatePosition());

    emitUndo("create node");
    emitGraphOps([createAddNodeOp(node)], "create node");
    setNodeSetSelection([node.id], node.id);
    closeMenu({ restoreViewportFocus: true });
  }

  function handleRotateSelection() {
    if (state.selection.kind !== "node") {
      return;
    }

    const node = state.snapshot.nodes.find((entry) => entry.id === state.selection.nodeId);

    if (!node) {
      return;
    }

    emitUndo("rotate node");
    emitGraphOps([createRotateNodeOp(node.id, ((node.rot ?? 0) + 90) % 360)], "rotate node");
  }

  function handleDeleteSelection() {
    const nodeIds = getSelectedNodeIds();
    const ops =
      nodeIds.length > 0
        ? createDeleteNodeSetOps(state.snapshot, nodeIds)
        : createDeleteSelectionOps(state.snapshot, state.selection);

    if (ops.length === 0) {
      return;
    }

    emitUndo("delete selection");
    emitGraphOps(ops, "delete selection");
    clearNodeSetSelection();
    emitSelection(createEmptySelection());
  }

  function handleRenameNode(nodeId, name) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

    if (!node || (node.name ?? "") === name) {
      return;
    }

    emitUndo("rename node");
    emitGraphOps([createRenameNodeOp(nodeId, name)], "rename node");
  }

  function handleSetParam(nodeId, value) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

    if (!node) {
      return;
    }

    const nextValue = clampParamInput(value);

    if ((node.params?.param ?? 1) === nextValue) {
      return;
    }

    const reason = node.type === "pulse" ? "set pulse rate" : "set param";
    emitUndo(reason);
    emitGraphOps([createSetParamOp(nodeId, nextValue)], reason);
  }

  function handleRemoveGroup(groupId) {
    if (!canRemoveGroup(state.snapshot, groupId)) {
      pushLocalIssue("UI_GROUP_IN_USE", `Group "${groupId}" cannot be removed while an instance still exists.`, {
        severity: "error",
      });
      return;
    }

    emitUndo("remove group");
    emitGraphOps(
      [
        {
          type: "removeGroup",
          payload: {
            groupId,
          },
        },
      ],
      "remove group",
    );
  }

  function getSeededGroupSelection() {
    return normalizeGroupSelection({ nodeIds: getSelectedNodeIds() });
  }

  function handleGroupOpen() {
    const draft = createGroupDraft(state);

    if (draft.candidates.nodes.length === 0) {
      pushLocalIssue(
        "UI_GROUP_EMPTY",
        "Grouping requires at least one internally connected selection.",
      );
      return;
    }

    state.groupDraft = draft;
    state.groupDialogScrollTop = 0;
    markViewportDirty();
  }

  function handleGroupEdit(groupId) {
    const group = state.snapshot.groups?.[groupId];

    if (!group) {
      pushLocalIssue("UI_GROUP_NOT_FOUND", `Group "${groupId}" was not found.`, {
        severity: "error",
      });
      return;
    }

    state.groupDraft = createGroupEditDraft(state, group);
    state.groupDialogScrollTop = 0;
    markViewportDirty();
  }

  function handleGroupMove(kind, index, direction) {
    if (!state.groupDraft) {
      return;
    }

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: moveArrayEntry(
          state.groupDraft.mappings[kind],
          index,
          index + direction,
        ),
      },
    };
    markViewportDirty();
  }

  function handleGroupRemoveMapping(kind, mappingId) {
    if (!state.groupDraft) {
      return;
    }

    const active = state.groupDraft.mappings[kind];
    const index = active.findIndex((entry) => entry.id === mappingId);

    if (index < 0) {
      return;
    }

    const removed = active[index];

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: active.filter((entry) => entry.id !== mappingId),
      },
      available: {
        ...state.groupDraft.available,
        [kind]: [...state.groupDraft.available[kind], removed],
      },
      restoreSelection: {
        ...state.groupDraft.restoreSelection,
        [kind]: state.groupDraft.restoreSelection[kind] || removed.id,
      },
    };
    markViewportDirty();
  }

  function handleGroupRestore(kind) {
    if (!state.groupDraft) {
      return;
    }

    const mappingId = state.groupDraft.restoreSelection[kind];
    const available = state.groupDraft.available[kind];
    const entry = available.find((item) => item.id === mappingId);

    if (!entry) {
      return;
    }

    const nextAvailable = available.filter((item) => item.id !== mappingId);

    state.groupDraft = {
      ...state.groupDraft,
      mappings: {
        ...state.groupDraft.mappings,
        [kind]: [...state.groupDraft.mappings[kind], entry],
      },
      available: {
        ...state.groupDraft.available,
        [kind]: nextAvailable,
      },
      restoreSelection: {
        ...state.groupDraft.restoreSelection,
        [kind]: nextAvailable[0]?.id ?? "",
      },
    };
    markViewportDirty();
  }

  function handleGroupCommit() {
    if (!state.groupDraft) {
      return;
    }

    if (state.groupDraft.mode === "edit") {
      const result = buildUpdateGroupOps({
        snapshot: state.snapshot,
        groupId: state.groupDraft.groupId,
        groupName: state.groupDraft.name.trim() || state.groupDraft.groupId,
        mappings: state.groupDraft.mappings,
      });

      if (!result.ok) {
        pushLocalIssue("UI_GROUP_UPDATE_FAILED", result.reason, { severity: "error" });
        return;
      }

      emitUndo("update group");
      emitGraphOps(result.ops, "update group");
      state.groupDraft = null;
      state.groupDialogScrollTop = 0;
      markDirty();
      return;
    }

    const groupId = createDeterministicId("group", state);
    const groupNodeId = createDeterministicId("node", state);
    const result = buildCreateGroupOps({
      snapshot: state.snapshot,
      registry: state.registry,
      groupSelection: state.groupSelection,
      groupId,
      groupName: state.groupDraft.name.trim() || groupId,
      groupNodeId,
      groupPosition: getNextCreatePosition(),
      mappings: state.groupDraft.mappings,
    });

    if (!result.ok) {
      pushLocalIssue("UI_GROUP_BUILD_FAILED", result.reason, { severity: "error" });
      return;
    }

    emitUndo("create group");
    emitGraphOps(result.ops, "create group");
    state.groupDraft = null;
    state.groupDialogScrollTop = 0;
    setNodeSetSelection([groupNodeId], groupNodeId);
  }

  function clearTransientStates() {
    state.drag = createEmptyDragState();
    state.pan = null;
    state.pointerPress = null;
    state.dragStarted = false;
    state.boxSelection = null;
    state.edgeCreatePointerActive = false;
    state.suppressViewportClick = false;
  }

  function getPortHitFromPointerEvent(event) {
    const targetHit = getPortHitFromTarget(event.target);

    if (targetHit) {
      return targetHit;
    }

    if (!state.viewport) {
      return null;
    }

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);

    return hitPort(
      state.snapshot,
      state.registry,
      worldPoint,
      state.config.port.hoverRadiusPx / state.config.grid.GRID_PX,
    );
  }

  function completeEdgeCreate(portHit) {
    const normalizedEndpoints = normalizeEdgeEndpoints(state.drag.from, portHit);
    const canConnect = canCreateEdge(state.snapshot, state.registry, state.drag.from, portHit);

    if (!normalizedEndpoints || !canConnect) {
      pushLocalIssue(
        "UI_EDGE_REJECTED",
        "That connection would violate the single-cable or port-direction rules.",
      );
      return false;
    }

    const edge = createEdgeRecord(
      createDeterministicId("edge", state),
      normalizedEndpoints.from,
      normalizedEndpoints.to,
      state.drag.tempCorners,
    );
    emitUndo("create edge");
    emitGraphOps(
      [
        {
          type: "addEdge",
          payload: { edge },
        },
      ],
      "create edge",
    );
    clearTransientStates();
    closeMenu();
    return true;
  }

  function addEdgeCreateCorner(worldPoint) {
    if (state.drag.kind !== "edge-create") {
      return;
    }

    state.drag = {
      ...state.drag,
      tempCorners: [...state.drag.tempCorners, snapWorldPoint(worldPoint, state.config)],
      cursor: worldPoint,
    };
    markDirty();
  }

  function beginNodeDrag(nodeId, startWorld, startScreen) {
    const nodeIds = getNodeDragIds(nodeId);
    const startPositions = Object.fromEntries(
      nodeIds
        .map((entryNodeId) => [entryNodeId, getRenderableNodePosition(entryNodeId)])
        .filter(([, pos]) => pos),
    );

    if (Object.keys(startPositions).length === 0) {
      return;
    }

    state.pointerPress = {
      kind: "node",
      nodeId,
      nodeIds,
      startWorld,
      startScreen,
      startPositions,
    };
    state.dragStarted = false;
  }

  function beginCornerDrag(edgeId, cornerIndex, startWorld, startScreen) {
    const edge = state.snapshot.edges.find((entry) => entry.id === edgeId);
    const point = edge?.manualCorners?.[cornerIndex];

    if (!point) {
      return;
    }

    state.pointerPress = {
      kind: "corner",
      edgeId,
      cornerIndex,
      startWorld,
      startScreen,
      startPoint: { ...point },
    };
    state.dragStarted = false;
  }

  function beginBoxSelection(startWorld, mode) {
    state.boxSelection = {
      start: startWorld,
      current: startWorld,
      mode,
    };
    markDirty();
  }

  function commitBoxSelection() {
    if (!state.boxSelection) {
      return;
    }

    const start = state.boxSelection.start;
    const end = state.boxSelection.current;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const nextSelection = state.boxSelection.mode === "add" ? [...getSelectedNodeIds()] : [];

    for (const node of state.snapshot.nodes) {
      const bounds = getNodeWorldBounds(state.snapshot, node, state.registry);
      const overlaps =
        bounds.x < maxX &&
        bounds.x + bounds.width > minX &&
        bounds.y < maxY &&
        bounds.y + bounds.height > minY;

      if (overlaps && !nextSelection.includes(node.id)) {
        nextSelection.push(node.id);
      }
    }

    setNodeSetSelection(nextSelection, nextSelection[nextSelection.length - 1] ?? null);
    state.boxSelection = null;
    markDirty();
  }

  function commitNodeDrag() {
    if (state.drag.kind !== "node") {
      return;
    }

    const snappedPositions = Object.fromEntries(
      Object.entries(state.drag.currentPositions ?? state.drag.startPositions).map(([nodeId, pos]) => [
        nodeId,
        snapWorldPoint(pos, state.config),
      ]),
    );
    const ops = createMoveNodeSetOps(state.drag.startPositions, snappedPositions);

    if (ops.length > 0) {
      setNodePositionOverridesForIds(snappedPositions);
      emitUndo("move node");
      emitGraphOps(ops, ops.length > 1 ? "move nodes" : "move node");
    } else {
      clearNodePositionOverrides(state.drag.nodeIds);
    }

    clearTransientStates();
    markDirty();
  }

  function commitCornerDrag() {
    if (state.drag.kind !== "corner") {
      return;
    }

    const snapped = snapWorldPoint(state.drag.currentPoint, state.config);

    if (
      snapped.x !== state.drag.startPoint.x ||
      snapped.y !== state.drag.startPoint.y
    ) {
      emitUndo("move corner");
      emitGraphOps(
        [
          {
            type: "moveCorner",
            payload: {
              edgeId: state.drag.edgeId,
              index: state.drag.cornerIndex,
              point: snapped,
            },
          },
        ],
        "move corner",
      );
    }

    clearTransientStates();
    markDirty();
  }

  function cancelEdgeCreate() {
    if (state.drag.kind !== "edge-create") {
      return;
    }

    clearTransientStates();
    markDirty();
  }

  function getPortHitFromTarget(target) {
    const portElement = target?.closest?.("[data-port-node-id]");

    if (!portElement) {
      return null;
    }

    return {
      kind: "port",
      nodeId: portElement.getAttribute("data-port-node-id"),
      portSlot: Number(portElement.getAttribute("data-port-slot")),
      direction: portElement.getAttribute("data-port-direction"),
    };
  }

  function getNodeHitFromTarget(target) {
    const nodeElement = target?.closest?.("[data-node-id]");

    if (!nodeElement) {
      return null;
    }

    return {
      kind: "node",
      nodeId: nodeElement.getAttribute("data-node-id"),
    };
  }

  function getEdgeHitFromTarget(target) {
    const edgeElement = target?.closest?.("[data-edge-id]");

    if (!edgeElement) {
      return null;
    }

    return {
      kind: "edge",
      edgeId: edgeElement.getAttribute("data-edge-id"),
    };
  }

  function getCornerHitFromTarget(target) {
    const cornerElement = target?.closest?.("[data-corner-edge-id]");

    if (!cornerElement) {
      return null;
    }

    return {
      kind: "corner",
      edgeId: cornerElement.getAttribute("data-corner-edge-id"),
      cornerIndex: Number(cornerElement.getAttribute("data-corner-index")),
    };
  }

  function updateHoverFromTarget(target) {
    const hover =
      getPortHitFromTarget(target) ??
      getCornerHitFromTarget(target) ??
      getEdgeHitFromTarget(target) ??
      getNodeHitFromTarget(target) ??
      createEmptyHover();

    if (hoverEquals(state.hover, hover)) {
      return;
    }

    state.hover = hover;
    markViewportDirty();
  }

  function handlePointerDown(event) {
    if (!state.viewport || isInteractiveTarget(event.target)) {
      return;
    }

    focusViewport();
    state.suppressViewportClick = false;

    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
    const screenPoint = {
      x: event.clientX - getViewportRect().left,
      y: event.clientY - getViewportRect().top,
    };

    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;
    const multiSelectModifier = event.shiftKey || event.metaKey || event.ctrlKey;

    const portHit = getPortHitFromPointerEvent(event);

    if (event.button === 0 && state.drag.kind === "edge-create" && !state.edgeCreatePointerActive) {
      if (portHit?.direction !== undefined) {
        if (portHit.direction !== state.drag.from.direction) {
          const completed = completeEdgeCreate(portHit);

          if (completed) {
            state.suppressViewportClick = true;
          }
          return;
        }

        return;
      }

      return;
    }

    if (event.button === 0 && (portHit?.direction === "out" || portHit?.direction === "in")) {
      clearNodeSetSelection();
      state.drag = {
        kind: "edge-create",
        from: {
          nodeId: portHit.nodeId,
          portSlot: portHit.portSlot,
          direction: portHit.direction,
        },
        cursor: worldPoint,
        tempCorners: [],
      };
      state.edgeCreatePointerActive = true;
      emitSelection(createEmptySelection());
      closeMenu();
      markDirty();
      return;
    }

    const cornerHit = getCornerHitFromTarget(event.target);

    if (event.button === 0 && cornerHit) {
      clearNodeSetSelection();
      emitSelection(cornerHit);
      beginCornerDrag(cornerHit.edgeId, cornerHit.cornerIndex, worldPoint, screenPoint);
      return;
    }

    const edgeHit = getEdgeHitFromTarget(event.target);

    if (event.button === 0 && edgeHit) {
      clearNodeSetSelection();
      emitSelection(edgeHit);
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (event.button === 0 && nodeHit) {
      if (multiSelectModifier) {
        const toggled = toggleGroupSelection(getSeededGroupSelection(), nodeHit.nodeId);
        setNodeSetSelection(toggled.nodeIds, nodeHit.nodeId);
        state.suppressViewportClick = true;
        return;
      }

      setNodeSetSelection(
        getNodeDragIds(nodeHit.nodeId),
        nodeHit.nodeId,
      );
      beginNodeDrag(nodeHit.nodeId, worldPoint, screenPoint);
      return;
    }

    if (event.button === 0) {
      closeMenu();
      beginBoxSelection(worldPoint, multiSelectModifier ? "add" : "replace");
    }
  }

  function shouldThrottlePreview(now) {
    if (state.drag.kind === "none" && !state.pan && !state.boxSelection) {
      return false;
    }

    return now - state.lastPreviewUpdateAt < state.previewThrottleMs;
  }

  function handlePointerMove(event) {
    if (!state.viewport) {
      return;
    }

    const now = performance.now();

    if (shouldThrottlePreview(now)) {
      return;
    }

    state.lastPreviewUpdateAt = now;
    const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
    const screenPoint = {
      x: event.clientX - getViewportRect().left,
      y: event.clientY - getViewportRect().top,
    };
    state.lastPointerWorld = worldPoint;
    state.lastPointerScreen = screenPoint;

    if (state.boxSelection) {
      state.boxSelection = {
        ...state.boxSelection,
        current: worldPoint,
      };
      markViewportDirty();
      return;
    }

    if (state.pointerPress?.kind === "node") {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= state.config.interaction.dragThresholdPx) {
        state.drag = {
          kind: "node",
          nodeIds: [...state.pointerPress.nodeIds],
          startPositions: state.pointerPress.startPositions,
          currentPositions: state.pointerPress.startPositions,
        };
        state.dragStarted = true;
      }

      if (state.drag.kind === "node") {
        const delta = {
          x: worldPoint.x - state.pointerPress.startWorld.x,
          y: worldPoint.y - state.pointerPress.startWorld.y,
        };
        const currentPositions = Object.fromEntries(
          Object.entries(state.pointerPress.startPositions).map(([nodeId, pos]) => [
            nodeId,
            {
              x: pos.x + delta.x,
              y: pos.y + delta.y,
            },
          ]),
        );
        state.drag = {
          ...state.drag,
          currentPositions,
        };
        setNodePositionOverridesForIds(currentPositions);
        markViewportDirty();
        return;
      }
    }

    if (state.pointerPress?.kind === "corner") {
      const distance = Math.hypot(
        screenPoint.x - state.pointerPress.startScreen.x,
        screenPoint.y - state.pointerPress.startScreen.y,
      );

      if (!state.dragStarted && distance >= state.config.interaction.dragThresholdPx) {
        state.drag = {
          kind: "corner",
          edgeId: state.pointerPress.edgeId,
          cornerIndex: state.pointerPress.cornerIndex,
          startPoint: state.pointerPress.startPoint,
          currentPoint: state.pointerPress.startPoint,
        };
        state.dragStarted = true;
      }

      if (state.drag.kind === "corner") {
        state.drag = {
          ...state.drag,
          currentPoint: worldPoint,
        };
        markViewportDirty();
        return;
      }
    }

    if (state.drag.kind === "edge-create") {
      state.drag = {
        ...state.drag,
        cursor: worldPoint,
      };
      markViewportDirty();
      return;
    }

    if (!event.target?.closest?.(".ping-editor__viewport") || isInteractiveTarget(event.target)) {
      return;
    }

    updateHoverFromTarget(event.target);
  }

  function handlePointerUp(event) {
    if (state.drag.kind === "edge-create" && state.edgeCreatePointerActive) {
      const portHit = getPortHitFromPointerEvent(event);

      state.edgeCreatePointerActive = false;

      if (portHit && portHit.direction !== state.drag.from.direction) {
        completeEdgeCreate(portHit);
        return;
      }

      if (state.viewport) {
        state.drag = {
          ...state.drag,
          cursor: getWorldCursorFromPointer(event, state.viewport, state.camera, state.config),
        };
      }
      markViewportDirty();
      return;
    }

    if (state.drag.kind === "edge-create") {
      return;
    }

    if (state.boxSelection) {
      commitBoxSelection();
      state.suppressViewportClick = true;
      clearTransientStates();
      return;
    }

    if (state.drag.kind === "node") {
      commitNodeDrag();
      return;
    }

    if (state.drag.kind === "corner") {
      commitCornerDrag();
      return;
    }

    if (state.pointerPress?.kind === "node" && !state.dragStarted) {
      emitSelection({ kind: "node", nodeId: state.pointerPress.nodeId });
      clearTransientStates();
      return;
    }

    if (state.pointerPress?.kind === "corner" && !state.dragStarted) {
      emitSelection({
        kind: "corner",
        edgeId: state.pointerPress.edgeId,
        cornerIndex: state.pointerPress.cornerIndex,
      });
      clearTransientStates();
      return;
    }

    clearTransientStates();
  }

  function handleViewportClick(event) {
    if (!state.viewport || event.target.closest("[data-action], input, select, button, label")) {
      return;
    }

    if (state.suppressViewportClick) {
      state.suppressViewportClick = false;
      return;
    }

    const portHit = getPortHitFromTarget(event.target);

    if (state.drag.kind === "edge-create") {
      if (state.edgeCreatePointerActive) {
        return;
      }

      if (portHit && portHit.direction !== state.drag.from.direction) {
        completeEdgeCreate(portHit);
        return;
      }

      if (portHit) {
        return;
      }

      const worldPoint = getWorldCursorFromPointer(event, state.viewport, state.camera, state.config);
      addEdgeCreateCorner(worldPoint);
      return;
    }

    const cornerHit = getCornerHitFromTarget(event.target);

    if (cornerHit) {
      clearNodeSetSelection();
      emitSelection(cornerHit);
      return;
    }

    const edgeHit = getEdgeHitFromTarget(event.target);

    if (edgeHit) {
      clearNodeSetSelection();
      emitSelection(edgeHit);
      return;
    }

    const nodeHit = getNodeHitFromTarget(event.target);

    if (nodeHit) {
      emitSelection(nodeHit);
      return;
    }

    clearNodeSetSelection();
    emitSelection(createEmptySelection());
  }

  function handleContextMenu(event) {
    const nodeHit = getNodeHitFromTarget(event.target);

    if (state.drag.kind === "edge-create") {
      event.preventDefault();
      cancelEdgeCreate();
      return;
    }

    if (nodeHit) {
      event.preventDefault();
      setNodeSetSelection([nodeHit.nodeId], nodeHit.nodeId);
      handleRotateSelection();
    }
  }

  function handleWheel(event) {
    if (!state.viewport) {
      return;
    }

    const target = event.target;

    if (!target?.closest?.(".ping-editor__viewport")) {
      return;
    }

    if (target.closest(".ping-editor__group-dialog, .ping-editor__menu") || isInteractiveTarget(target)) {
      return;
    }

    event.preventDefault();
    // Plain wheel/trackpad scroll pans the desktop canvas; modified wheel zooms at the cursor.
    state.camera =
      event.ctrlKey || event.metaKey
        ? applyWheelZoom(state.camera, event, state.viewport, state.config)
        : applyWheelPan(state.camera, event, state.viewport, state.config);
    markViewportDirty();
  }

  function isNodeMenuShortcut(event) {
    if (event.defaultPrevented || event.isComposing) {
      return false;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    return event.key === "N" || event.key === "n";
  }

  function triggerNodeMenuShortcut(event) {
    event.preventDefault();
    if (state.menu.open) {
      closeMenu({ restoreViewportFocus: true });
    } else {
      openMenuAt(state.lastPointerScreen, state.lastPointerWorld);
    }
  }

  function isGlobalEditorShortcutTarget(target) {
    const document = state.root?.ownerDocument;

    if (!state.root || !document) {
      return false;
    }

    if (!target || target === document || target === document.body || target === document.documentElement) {
      return true;
    }
    return false;
  }

  function handleKeyDown(event) {
    if (isTextInputTarget(event.target)) {
      return;
    }

    const wantsUndo = (event.metaKey || event.ctrlKey) && !event.shiftKey && (event.key === "z" || event.key === "Z");
    const wantsRedo =
      (event.metaKey || event.ctrlKey) &&
      ((event.shiftKey && (event.key === "z" || event.key === "Z")) || event.key === "y" || event.key === "Y");

    if (wantsUndo) {
      event.preventDefault();
      requestUndo();
      return;
    }

    if (wantsRedo) {
      event.preventDefault();
      requestRedo();
      return;
    }

    if (isNodeMenuShortcut(event)) {
      triggerNodeMenuShortcut(event);
      return;
    }

    if (event.key === "G" || event.key === "g") {
      event.preventDefault();
      handleGroupOpen();
      return;
    }

    if (event.key === "R" || event.key === "r") {
      event.preventDefault();
      handleRotateSelection();
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      handleDeleteSelection();
    }
  }

  function handleDocumentKeyDown(event) {
    if (isTextInputTarget(event.target) || !isNodeMenuShortcut(event)) {
      return;
    }

    if (!isGlobalEditorShortcutTarget(event.target)) {
      return;
    }

    triggerNodeMenuShortcut(event);
  }

  function isClipboardEventForEditor(event) {
    const activeElement = state.root?.ownerDocument?.activeElement;

    return Boolean(
      state.root &&
      (state.root.contains(event.target) || state.root.contains(activeElement) || activeElement === state.viewport),
    );
  }

  function handleCopyLikeEvent(event, mode) {
    if (!isClipboardEventForEditor(event) || isTextInputTarget(event.target)) {
      return;
    }

    const nodeIds = getSelectedNodeIds();

    if (nodeIds.length === 0) {
      return;
    }

    const payload = createClipboardSubgraph(state.snapshot, nodeIds);

    if (!payload) {
      return;
    }

    rememberClipboardPayload(payload);
    event.preventDefault();
    event.clipboardData?.setData?.(CLIPBOARD_MIME, JSON.stringify(payload));
    event.clipboardData?.setData?.("text/plain", CLIPBOARD_TEXT_MARKER);

    if (mode !== "cut") {
      return;
    }

    const ops = createDeleteNodeSetOps(state.snapshot, nodeIds);

    if (ops.length === 0) {
      return;
    }

    emitUndo("cut nodes");
    emitGraphOps(ops, "cut nodes");
    clearNodeSetSelection();
    emitSelection(createEmptySelection());
  }

  function handleCopy(event) {
    handleCopyLikeEvent(event, "copy");
  }

  function handleCut(event) {
    handleCopyLikeEvent(event, "cut");
  }

  function readClipboardPayload(event) {
    const rawPayload =
      event.clipboardData?.getData?.(CLIPBOARD_MIME) ||
      (event.clipboardData?.getData?.("text/plain") === CLIPBOARD_TEXT_MARKER && state.clipboardPayload
        ? JSON.stringify(state.clipboardPayload)
        : "");

    if (!rawPayload) {
      return null;
    }

    try {
      return JSON.parse(rawPayload);
    } catch {
      return null;
    }
  }

  function handlePaste(event) {
    if (!isClipboardEventForEditor(event) || isTextInputTarget(event.target)) {
      return;
    }

    const payload = readClipboardPayload(event);

    if (!payload) {
      return;
    }

    const signature = getClipboardSignature(payload);
    state.pasteRepeatCount = signature === state.lastClipboardSignature ? state.pasteRepeatCount + 1 : 0;
    state.lastClipboardSignature = signature;

    const result = instantiateClipboardSubgraph({
      snapshot: state.snapshot,
      payload,
      targetPosition: getPasteTargetPosition(),
      createId(prefix) {
        return createDeterministicId(prefix, state);
      },
    });

    if (!result.ok || result.ops.length === 0) {
      return;
    }

    event.preventDefault();
    state.clipboardPayload = cloneValue(payload);
    emitUndo("paste nodes");
    emitGraphOps(result.ops, "paste nodes");
    setNodeSetSelection(result.pastedNodeIds, result.pastedNodeIds[result.pastedNodeIds.length - 1] ?? null);
  }

  function getSampleInputBySlotId(slotId) {
    if (!state.root || !slotId) {
      return null;
    }

    return (
      Array.from(state.root.querySelectorAll("[data-action='sample-file']")).find(
        (input) => input.getAttribute("data-slot-id") === slotId,
      ) ?? null
    );
  }

  function commitSampleSlots(nextSlots, labelUpdate = null) {
    const nextLabels = new Map(state.sampleFileLabels);

    if (labelUpdate?.slotId) {
      if (typeof labelUpdate.fileLabel === "string" && labelUpdate.fileLabel.trim() !== "") {
        nextLabels.set(labelUpdate.slotId, labelUpdate.fileLabel.trim());
      } else {
        nextLabels.delete(labelUpdate.slotId);
      }
    }

    state.slots = nextSlots;
    state.sampleFileLabels = reconcileSampleFileLabels(nextLabels, nextSlots);
    emitOutput({
      type: "audio/updateSlots",
      payload: {
        slots: cloneSlots(nextSlots),
      },
    });
    markDirty();
  }

  async function handleFileInputChange(input) {
    const slotId = input.getAttribute("data-slot-id");
    const file = input.files?.[0];

    if (!slotId || !file) {
      return;
    }

    try {
      const nextPath = await readFileAsDataUrl(file);
      const nextSlots = state.slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              path: nextPath,
            }
          : { ...slot },
      );

      commitSampleSlots(nextSlots, {
        fileLabel: file.name,
        slotId,
      });
    } finally {
      input.value = "";
    }
  }

  function handleActionClick(target) {
    if (!target) {
      return false;
    }

    const action = target.getAttribute("data-action");

    if (!action) {
      return false;
    }

    if (action === "create-node") {
      handleCreateNode(target.getAttribute("data-palette-type"));
      return true;
    }

    if (action === "create-group-node") {
      handleCreateNode("group", target.getAttribute("data-group-ref"));
      return true;
    }

    if (action === "set-tab") {
      state.activeTab = target.getAttribute("data-tab");
      markDirty();
      return true;
    }

    if (action === "set-menu-category") {
      state.menu = {
        ...state.menu,
        category: target.getAttribute("data-menu-category") || DEFAULT_PALETTE_MENU_CATEGORY_ID,
      };
      markDirty();
      return true;
    }

    if (action === "toggle-sidebar") {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      markDirty();
      return true;
    }

    if (action === "open-sample-picker") {
      getSampleInputBySlotId(target.getAttribute("data-slot-id"))?.click();
      return true;
    }

    if (action === "request-undo") {
      requestUndo();
      return true;
    }

    if (action === "request-redo") {
      requestRedo();
      return true;
    }

    if (action === "trigger-sidebar-action") {
      onSidebarAction?.(target.getAttribute("data-sidebar-action-id"));
      return true;
    }

    if (action === "open-menu") {
      if (state.menu.open) {
        closeMenu();
      } else {
        openMenuAt({ x: 24, y: 24 }, getViewportCenterWorld());
      }
      return true;
    }

    if (action === "rotate-selection") {
      handleRotateSelection();
      return true;
    }

    if (action === "delete-selection") {
      handleDeleteSelection();
      return true;
    }

    if (action === "reset-pulses") {
      state.runtime?.resetPulses?.();
      emitOutput({ type: "runtime/resetPulses" });
      return true;
    }

    if (action === "remove-group") {
      handleRemoveGroup(target.getAttribute("data-group-id"));
      return true;
    }

    if (action === "edit-group") {
      handleGroupEdit(target.getAttribute("data-group-id"));
      return true;
    }

    if (action === "focus-diagnostic") {
      const index = Number(target.getAttribute("data-issue-index"));
      const issue = [...state.localIssues, ...state.diagnostics][index];
      const nextSelection = issue ? selectionToFocusTarget(state.snapshot, issue) : null;

      if (nextSelection) {
        emitSelection(nextSelection);
      }

      return true;
    }

    if (action === "open-group-config") {
      handleGroupOpen();
      return true;
    }

    if (action === "close-group-config") {
      state.groupDraft = null;
      state.groupDialogScrollTop = 0;
      markViewportDirty();
      return true;
    }

    if (action === "commit-group") {
      handleGroupCommit();
      return true;
    }

    if (action === "group-move") {
      handleGroupMove(
        target.getAttribute("data-group-kind"),
        Number(target.getAttribute("data-group-index")),
        Number(target.getAttribute("data-group-direction")),
      );
      return true;
    }

    if (action === "group-remove-mapping") {
      handleGroupRemoveMapping(
        target.getAttribute("data-group-kind"),
        target.getAttribute("data-group-id"),
      );
      return true;
    }

    if (action === "group-restore") {
      handleGroupRestore(target.getAttribute("data-group-kind"));
      return true;
    }

    return false;
  }

  function handleChange(event) {
    const target = event.target;

    if (target.matches("[data-action='tempo']")) {
      updateTempo(Number(target.value || 0), { emit: true, control: target });
      return;
    }

    if (target.matches("[data-action='rename-node']")) {
      handleRenameNode(target.getAttribute("data-node-id"), target.value);
      return;
    }

    if (target.matches("[data-action='set-param']")) {
      handleSetParam(target.getAttribute("data-node-id"), Number(target.value));
      return;
    }

    if (target.matches("[data-action='group-restore-select']") && state.groupDraft) {
      const kind = target.getAttribute("data-group-kind");
      state.groupDraft = {
        ...state.groupDraft,
        restoreSelection: {
          ...state.groupDraft.restoreSelection,
          [kind]: target.value,
        },
      };
      markDirty();
      return;
    }

    if (target.matches("[data-action='sample-file']")) {
      void handleFileInputChange(target);
    }
  }

  function handleInput(event) {
    const target = event.target;

    if (target.matches("[data-action='tempo']")) {
      updateTempo(Number(target.value || 0), { emit: true, control: target });
      return;
    }

    if (target.matches("[data-action='group-name']") && state.groupDraft) {
      state.groupDraft = {
        ...state.groupDraft,
        name: target.value,
      };
    }
  }

  function buildPreviewRouteForRender() {
    if (state.drag.kind !== "edge-create") {
      return null;
    }

    const node = state.snapshot.nodes.find((entry) => entry.id === state.drag.from.nodeId);

    if (!node) {
      return null;
    }

    const fromPoint = getPortWorldPoint(
      state.snapshot,
      node,
      state.registry,
      state.drag.from.direction,
      state.drag.from.portSlot,
    );

    if (!fromPoint) {
      return null;
    }

    return buildPreviewRoute(fromPoint, state.drag.cursor, "horizontal-first", state.drag.tempCorners);
  }

  function getViewportCursor() {
    return state.pan
      ? "grabbing"
      : state.boxSelection
        ? "crosshair"
      : state.drag.kind === "node"
        ? "grabbing"
      : state.drag.kind === "corner"
          ? "move"
          : state.drag.kind === "edge-create"
            ? "crosshair"
            : state.hover.kind === "port"
              ? "crosshair"
              : state.hover.kind === "node"
                ? "grab"
                : state.hover.kind === "edge"
                  ? "pointer"
                  : state.hover.kind === "corner"
                    ? "move"
                    : "default";
  }

function buildViewportMarkup(selection) {
  return `
      ${renderSvgMarkup({
        snapshot: state.snapshot,
        routes: state.routes,
        registry: state.registry,
        config: state.config,
        camera: state.camera,
        viewportSize: state.viewportSize,
        selection,
        hover: state.hover,
        groupSelection: state.groupSelection,
        drag: state.drag,
        nodePositionOverrides: state.nodePositionOverrides,
        thumbs: state.thumbs,
        previewRoute: buildPreviewRouteForRender(),
        boxSelection: state.boxSelection,
      })}
      ${buildMenuMarkup(state)}
      ${renderGroupConfigPanel(state.groupDraft, { sidebarCollapsed: state.sidebarCollapsed })}
    `;
}

  function render() {
    if (!state.root) {
      return;
    }

    state.sidebarTabsScrollLeft = readSidebarTabsScrollLeft(state.root);
    state.menuCategoriesScrollLeft = readMenuCategoriesScrollLeft(state.root);
    state.groupDialogScrollTop = readGroupDialogScrollTop(state.root);
    const groupDialogFocusState = readGroupDialogFocusState(state.root);
    const shouldRestoreViewportFocus = state.root.ownerDocument?.activeElement === state.viewport;

    const selection = clearDeletedSelection(state.selection, state.snapshot);
    state.selection = selection;
    const cursor = getViewportCursor();

    state.root.innerHTML = `
      ${createStyles(state.config)}
      <div class="ping-editor" data-testid="editor-root">
        <div class="ping-editor__layout">
          <div class="ping-editor__toolbar">
            <div class="ping-editor__toolbar-group">
              <button
                class="ping-editor__panel-button ping-editor__icon-button"
                type="button"
                data-action="request-undo"
                data-testid="undo-button"
                aria-label="Undo"
                title="Undo"
                ${state.history.canUndo ? "" : "disabled"}
              >
                <span aria-hidden="true">&larr;</span>
              </button>
              <button
                class="ping-editor__panel-button ping-editor__icon-button"
                type="button"
                data-action="request-redo"
                data-testid="redo-button"
                aria-label="Redo"
                title="Redo"
                ${state.history.canRedo ? "" : "disabled"}
              >
                <span aria-hidden="true">&rarr;</span>
              </button>
            </div>
            <div class="ping-editor__toolbar-group">
              <button class="ping-editor__panel-button is-primary" type="button" data-action="open-menu">
                Add Node
              </button>
              <button class="ping-editor__panel-button" type="button" data-action="open-group-config">
                Create Group
              </button>
            </div>
            <div class="ping-editor__toolbar-group">
              <button class="ping-editor__panel-button" type="button" data-action="reset-pulses" data-testid="reset-pulses">
                Reset
              </button>
              <label class="ping-editor__field ping-editor__toolbar-field">
                <span class="ping-editor__toolbar-label">Tempo</span>
                <input
                  class="ping-editor__toolbar-slider"
                  type="range"
                  name="tempo"
                  min="1"
                  max="100"
                  step="1"
                  value="${escapeHtml(state.tempo)}"
                  data-action="tempo"
                  data-testid="tempo-input"
                />
              </label>
            </div>
          </div>
          <div class="ping-editor__viewport-shell">
            <div
              class="ping-editor__viewport"
              tabindex="0"
              aria-label="Node editor canvas"
              style="cursor:${cursor};"
              data-testid="editor-viewport"
            >
              ${buildViewportMarkup(selection)}
            </div>
          </div>
          <aside
            class="ping-editor__sidebar ${state.sidebarCollapsed ? "is-collapsed" : ""}"
            data-testid="editor-sidebar"
          >
            <button
              class="ping-editor__sidebar-toggle"
              type="button"
              data-action="toggle-sidebar"
              data-testid="sidebar-toggle"
              aria-label="${state.sidebarCollapsed ? "Open sidebar" : "Close sidebar"}"
              aria-expanded="${state.sidebarCollapsed ? "false" : "true"}"
            >
              <span class="ping-editor__sidebar-toggle-icon" aria-hidden="true">
                ${state.sidebarCollapsed ? "&lsaquo;" : "&rsaquo;"}
              </span>
            </button>
            ${
              state.sidebarCollapsed
                ? ""
                : `
                  <div class="ping-editor__sidebar-content">
                    <div class="ping-editor__sidebar-header">
                      <div class="ping-editor__tabs">
                        ${BUILT_IN_SIDEBAR_TABS.concat(state.sidebarExtensions.tabs)
                          .map(
                            (tab) => `
                              <button
                                class="ping-editor__tab ${state.activeTab === tab.id ? "is-active" : ""} ${
                                  tab.id === "inspect" && state.selection.kind !== "none" ? "has-notice" : ""
                                }"
                                type="button"
                                data-action="set-tab"
                                data-tab="${escapeHtml(tab.id)}"
                                ${
                                  tab.id === "inspect" && state.selection.kind !== "none"
                                    ? 'aria-label="inspect (selection available)"'
                                    : ""
                                }
                                ${tab.testId ? `data-testid="${escapeHtml(tab.testId)}"` : ""}
                              >
                                <span class="ping-editor__tab-label">${escapeHtml(tab.label)}</span>
                              </button>
                            `,
                          )
                          .join("")}
                      </div>
                      ${
                        state.sidebarExtensions.actions.length
                          ? `
                            <div class="ping-editor__sidebar-actions">
                              ${state.sidebarExtensions.actions
                                .map(
                                  (action) => `
                                    <button
                                      class="ping-editor__mini-button ping-editor__sidebar-action"
                                      type="button"
                                      data-action="trigger-sidebar-action"
                                      data-sidebar-action-id="${escapeHtml(action.id)}"
                                      ${action.testId ? `data-testid="${escapeHtml(action.testId)}"` : ""}
                                    >
                                      ${escapeHtml(action.label)}
                                    </button>
                                  `,
                                )
                                .join("")}
                            </div>
                          `
                          : ""
                      }
                    </div>
                    <div class="ping-editor__panel-scroll">
                      ${buildPanelMarkup(state)}
                    </div>
                  </div>
                `
            }
          </aside>
        </div>
      </div>
    `;

    state.viewport = state.root.querySelector(".ping-editor__viewport");
    restoreSidebarTabsScrollLeft(state.root, state.sidebarTabsScrollLeft);
    restoreMenuCategoriesScrollLeft(state.root, state.menuCategoriesScrollLeft);
    restoreGroupDialogScrollTop(state.root, state.groupDialogScrollTop);
    const restoredGroupDialogFocus = restoreGroupDialogFocus(state.root, groupDialogFocusState);
    if (shouldRestoreViewportFocus && !restoredGroupDialogFocus) {
      focusViewport();
    }
    state.dirty = false;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
  }

  function renderViewport() {
    if (!state.root || !state.viewport) {
      render();
      return;
    }

    state.menuCategoriesScrollLeft = readMenuCategoriesScrollLeft(state.root);
    state.groupDialogScrollTop = readGroupDialogScrollTop(state.root);
    const groupDialogFocusState = readGroupDialogFocusState(state.root);
    const selection = clearDeletedSelection(state.selection, state.snapshot);
    state.selection = selection;
    state.viewport.style.cursor = getViewportCursor();
    state.viewport.innerHTML = buildViewportMarkup(selection);
    restoreMenuCategoriesScrollLeft(state.root, state.menuCategoriesScrollLeft);
    restoreGroupDialogScrollTop(state.root, state.groupDialogScrollTop);
    restoreGroupDialogFocus(state.root, groupDialogFocusState);
    state.dirty = false;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
  }

  function renderThumbLayer() {
    if (!state.root) {
      return;
    }

    const thumbLayer = state.root.querySelector(".ping-editor__thumb-layer");

    if (!thumbLayer) {
      render();
      return;
    }

    thumbLayer.innerHTML = renderThumbLayerMarkup({
      routes: state.routes,
      camera: state.camera,
      config: state.config,
      thumbs: state.thumbs,
      hiddenEdgeIds: createHiddenThumbEdgeIds(state.snapshot, {
        drag: state.drag,
        nodePositionOverrides: state.nodePositionOverrides,
      }),
    });
    state.dirty = false;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
  }

  function tick(now) {
    if (!state.mounted) {
      return;
    }

    if (state.lastFrameAt !== null) {
      state.frameDurationMs = now - state.lastFrameAt;
      state.previewThrottleMs =
        state.frameDurationMs > 33
          ? 66
          : state.frameDurationMs > 16
            ? 33
            : 0;
    }

    state.lastFrameAt = now;
    const nextThumbs = state.runtime?.getThumbState?.(
      state.runtime?.getMetrics?.()?.lastTickProcessed ?? 0,
    ) ?? [];

    if (JSON.stringify(nextThumbs) !== JSON.stringify(state.thumbs)) {
      state.thumbs = nextThumbs;
      if (!state.dirty) {
        state.thumbOnlyDirty = true;
      }
      state.dirty = true;
    }

    if (state.dirty) {
      if (state.thumbOnlyDirty) {
        renderThumbLayer();
      } else if (state.viewportOnlyDirty) {
        renderViewport();
      } else {
        render();
        updateViewportSize();
      }
    }

    state.frameId = window.requestAnimationFrame(tick);
  }

  function handleRootClick(event) {
    if (handleActionClick(event.target.closest("[data-action]"))) {
      return;
    }

    handleViewportClick(event);
  }

  function mount(element) {
    state.root = element;
    state.mounted = true;
    render();
    updateViewportSize();

    state.root.addEventListener("click", handleRootClick);
    state.root.addEventListener("change", handleChange);
    state.root.addEventListener("input", handleInput);
    state.root.addEventListener("keydown", handleKeyDown);
    state.root.addEventListener("pointerdown", handlePointerDown);
    state.root.addEventListener("pointermove", handlePointerMove);
    state.root.addEventListener("contextmenu", handleContextMenu);
    state.root.addEventListener("wheel", handleWheel, { passive: false });
    state.root.ownerDocument.addEventListener("keydown", handleDocumentKeyDown);
    state.root.ownerDocument.addEventListener("copy", handleCopy);
    state.root.ownerDocument.addEventListener("cut", handleCut);
    state.root.ownerDocument.addEventListener("paste", handlePaste);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("resize", updateViewportSize);
    state.frameId = window.requestAnimationFrame(tick);
  }

  function unmount() {
    if (!state.root) {
      return;
    }

    state.mounted = false;
    window.cancelAnimationFrame(state.frameId);
    state.root.removeEventListener("click", handleRootClick);
    state.root.removeEventListener("change", handleChange);
    state.root.removeEventListener("input", handleInput);
    state.root.removeEventListener("keydown", handleKeyDown);
    state.root.removeEventListener("pointerdown", handlePointerDown);
    state.root.removeEventListener("pointermove", handlePointerMove);
    state.root.removeEventListener("contextmenu", handleContextMenu);
    state.root.removeEventListener("wheel", handleWheel);
    state.root.ownerDocument.removeEventListener("keydown", handleDocumentKeyDown);
    state.root.ownerDocument.removeEventListener("copy", handleCopy);
    state.root.ownerDocument.removeEventListener("cut", handleCut);
    state.root.ownerDocument.removeEventListener("paste", handlePaste);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("resize", updateViewportSize);
    state.root.innerHTML = "";
    state.root = null;
    state.viewport = null;
  }

  return {
    mount,
    unmount,
    setSnapshot(snapshot) {
      state.snapshot = snapshot ?? createEmptyGraphSnapshot();
      state.nodePositionOverrides = new Map(
        Array.from(state.nodePositionOverrides.entries()).filter(([nodeId, overridePos]) => {
          const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

          if (!node) {
            return false;
          }

          return node.pos.x !== overridePos.x || node.pos.y !== overridePos.y;
        }),
      );
      state.selection = clearDeletedSelection(state.selection, state.snapshot);
      state.groupSelection = normalizeGroupSelection({
        nodeIds: state.groupSelection.nodeIds.filter((nodeId) =>
          state.snapshot.nodes.some((node) => node.id === nodeId),
        ),
      });
      if (
        state.groupDraft?.mode === "edit" &&
        !state.snapshot.groups?.[state.groupDraft.groupId]
      ) {
        state.groupDraft = null;
      }
      markDirty();
    },
    setRoutes(routes) {
      state.routes = routes ?? createEmptyRoutes();
      markDirty();
    },
    setDiagnostics(issues) {
      state.diagnostics = Array.isArray(issues) ? issues.map((issue) => ({ ...issue })) : [];
      markDirty();
    },
    setPalette(palette) {
      state.palette = Array.isArray(palette) ? palette.map((entry) => ({ ...entry })) : [];
      markDirty();
    },
    setSelection(selection) {
      state.selection = clearDeletedSelection(normalizeSelection(selection), state.snapshot);
      markDirty();
    },
    setSlots(slots) {
      state.slots = normalizeSlots(slots);
      state.sampleFileLabels = reconcileSampleFileLabels(state.sampleFileLabels, state.slots);
      markDirty();
    },
    setTempo(tempo) {
      updateTempo(tempo);
    },
    setSidebarExtensions(extensions) {
      state.sidebarExtensions = normalizeSidebarExtensions(extensions);

      if (!getSidebarTabIds(state.sidebarExtensions).has(state.activeTab)) {
        state.activeTab = "console";
      }

      markDirty();
    },
    setHistory(history) {
      state.history = {
        canUndo: history?.canUndo === true,
        canRedo: history?.canRedo === true,
      };
      markDirty();
    },
  };
}
