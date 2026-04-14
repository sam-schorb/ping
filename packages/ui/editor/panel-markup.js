import { renderDiagnosticsPanel } from "../panels/diagnostics.js";
import { renderDocsPanel } from "../panels/docs.js";
import { renderGroupsPanel } from "../panels/groups.js";
import { renderPaletteMenu } from "../panels/palette.js";
import { renderSamplesPanel } from "../panels/samples.js";
import { clamp, escapeHtml } from "./utils.js";

export function buildPanelMarkup(state) {
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

  if (tab === "docs") {
    return renderDocsPanel({
      palette: state.palette,
      config: state.config,
    });
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

export function buildMenuMarkup(state) {
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
    ? margin
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
        query: state.menu.query,
        activeItemId: state.menu.activeItemId,
        icons: state.config.icons,
        config: state.config,
      })}
    </div>
  `;
}

export function selectionToFocusTarget(snapshot, issue) {
  if (issue.nodeId && snapshot.nodes.some((node) => node.id === issue.nodeId)) {
    return { kind: "node", nodeId: issue.nodeId };
  }

  if (issue.edgeId && snapshot.edges.some((edge) => edge.id === issue.edgeId)) {
    return { kind: "edge", edgeId: issue.edgeId };
  }

  return null;
}

export function buildSidebarMarkup(state, { renderToolbarMarkup }) {
  return `
    ${renderToolbarMarkup()}
    <div class="ping-editor__viewport-shell">
      <div
        class="ping-editor__viewport"
        tabindex="0"
        aria-label="Node editor canvas"
        style="cursor:default;"
        data-testid="editor-viewport"
      ></div>
    </div>
    <aside
      class="ping-editor__sidebar ${state.sidebarCollapsed ? "is-collapsed" : ""}"
      data-testid="editor-sidebar"
    ></aside>
  `;
}
