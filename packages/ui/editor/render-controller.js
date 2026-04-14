import { FaArrowLeftLong, FaArrowRightLong, FaObjectGroup, FaRegTrashCan } from "react-icons/fa6";
import { GrPowerReset } from "react-icons/gr";
import { IoIosHelpCircle } from "react-icons/io";
import { IoMdAdd } from "react-icons/io";
import { RiClockwise2Line, RiCloseLine } from "react-icons/ri";
import { TbMetronome } from "react-icons/tb";

import {
  focusElementWithoutScroll,
  readGroupDialogFocusState,
  readGroupDialogScrollTop,
  readMenuCategoriesScrollLeft,
  readMenuFocusState,
  readSidebarFocusState,
  readSidebarTabsScrollLeft,
  restoreGroupDialogFocus,
  restoreGroupDialogScrollTop,
  restoreMenuCategoriesScrollLeft,
  restoreMenuFocus,
  restoreSidebarFocus,
  restoreSidebarTabsScrollLeft,
} from "./focus-state.js";
import { renderGroupConfigPanel } from "./group-config.js";
import { buildMenuMarkup, buildPanelMarkup } from "./panel-markup.js";
import {
  createStyles,
  getToolbarSidebarClearanceCss,
  renderSidebarToggleIconContent,
  renderToolbarButtonContent,
  renderToolbarIconButtonContent,
} from "./styles.js";
import { clearDeletedSelection } from "./state.js";
import { BUILT_IN_SIDEBAR_TABS, escapeHtml, getNodePulseWindowTicks } from "./utils.js";
import { createPreviewRenderState, renderSvgMarkup, renderThumbLayerMarkup } from "../render/svg-layer.js";

function getSelectedNodeCount(selection, groupSelection, snapshot) {
  const existingNodeIds = new Set(snapshot.nodes.map((node) => node.id));
  const selectedNodeIds = Array.isArray(groupSelection?.nodeIds)
    ? groupSelection.nodeIds.filter((nodeId) => existingNodeIds.has(nodeId))
    : [];

  if (selectedNodeIds.length > 0) {
    return selectedNodeIds.length;
  }

  if (selection.kind === "node" && existingNodeIds.has(selection.nodeId)) {
    return 1;
  }

  return 0;
}

function getDeleteToolbarLabel(selection, groupSelection, snapshot) {
  const selectedNodeCount = getSelectedNodeCount(selection, groupSelection, snapshot);

  if (selectedNodeCount > 1) {
    return "Delete Nodes";
  }

  if (selectedNodeCount === 1) {
    return "Delete Node";
  }

  if (selection.kind === "corner") {
    return "Delete Bend";
  }

  if (selection.kind === "edge") {
    return "Delete Cable";
  }

  return "Delete";
}

export function createRenderController({
  state,
  markViewportDirty,
  syncInspectDslDraft,
  buildInlineParamLayerMarkup,
  syncInlineParamEditFromDom,
  restoreInlineParamFocus,
  scheduleInlineParamFocusRestore,
  buildPreviewRouteForRender,
  getViewportCursor,
  focusViewport,
  updateViewportSize,
}) {
  function buildViewportCanvasMarkup(selection) {
    const previewRenderState = createPreviewRenderState(
      state.snapshot,
      state.routes,
      state.registry,
      {
        drag: state.drag,
        nodePositionOverrides: state.nodePositionOverrides,
      },
      state.config,
    );
    state.previewRenderState = previewRenderState;

    return renderSvgMarkup({
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
      nodePulseStates: state.nodePulseStates,
      previewRoute: buildPreviewRouteForRender(),
      boxSelection: state.boxSelection,
      previewRenderState,
    });
  }

  function buildViewportOverlayMarkup() {
    return `
      ${buildInlineParamLayerMarkup()}
      ${buildMenuMarkup(state)}
      ${renderGroupConfigPanel(state.groupDraft, { sidebarCollapsed: state.sidebarCollapsed })}
    `;
  }

  function buildViewportMarkup(selection) {
    return `
      <div class="ping-editor__viewport-canvas">
        ${buildViewportCanvasMarkup(selection)}
      </div>
      ${buildViewportOverlayMarkup()}
    `;
  }

  function render() {
    if (!state.root) {
      return;
    }

    state.rendering = true;
    syncInlineParamEditFromDom();
    state.sidebarTabsScrollLeft = readSidebarTabsScrollLeft(state.root);
    state.menuCategoriesScrollLeft = readMenuCategoriesScrollLeft(state.root);
    state.groupDialogScrollTop = readGroupDialogScrollTop(state.root);
    const groupDialogFocusState = readGroupDialogFocusState(state.root);
    const menuFocusState = readMenuFocusState(state.root);
    const sidebarFocusState = readSidebarFocusState(state.root);
    const shouldRestoreViewportFocus = state.root.ownerDocument?.activeElement === state.viewport;

    const selection = clearDeletedSelection(state.selection, state.snapshot);
    state.selection = selection;
    syncInspectDslDraft();
    const cursor = getViewportCursor();
    const hasDeletableSelection = selection.kind !== "none" || state.groupSelection.nodeIds.length > 0;
    const hasRotatableSelection = selection.kind === "node";
    const deleteToolbarLabel = getDeleteToolbarLabel(selection, state.groupSelection, state.snapshot);
    const showCancelCableButton = state.drag.kind === "edge-create";

    state.root.innerHTML = `
      ${createStyles(state.config)}
      <div class="ping-editor" data-testid="editor-root">
        <div class="ping-editor__layout">
          <div
            class="ping-editor__toolbar"
            style="--ping-toolbar-sidebar-clearance:${escapeHtml(
              getToolbarSidebarClearanceCss(state.config, state.sidebarCollapsed),
            )};"
          >
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
                ${renderToolbarIconButtonContent(FaArrowLeftLong)}
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
                ${renderToolbarIconButtonContent(FaArrowRightLong)}
              </button>
            </div>
            <div class="ping-editor__toolbar-group">
              ${
                showCancelCableButton
                  ? `
                    <button
                      class="ping-editor__panel-button ping-editor__toolbar-cancel-cable-button"
                      type="button"
                      data-action="cancel-edge-create"
                      data-testid="cancel-cable-button"
                      aria-label="Cancel Cable"
                      title="Cancel Cable"
                    >
                      ${renderToolbarButtonContent("Cancel Cable", RiCloseLine)}
                    </button>
                  `
                  : ""
              }
              <button
                class="ping-editor__panel-button is-primary"
                type="button"
                data-action="open-menu"
                aria-label="Add Node"
                title="Add Node"
              >
                ${renderToolbarButtonContent("Add Node", IoMdAdd)}
              </button>
              <button
                class="ping-editor__panel-button"
                type="button"
                data-action="open-group-config"
                aria-label="Create Group"
                title="Create Group"
              >
                ${renderToolbarButtonContent("Create Group", FaObjectGroup)}
              </button>
              <button
                class="ping-editor__panel-button ping-editor__toolbar-delete-button"
                type="button"
                data-action="delete-selection"
                data-testid="delete-toolbar-button"
                aria-label="${escapeHtml(deleteToolbarLabel)}"
                title="${escapeHtml(deleteToolbarLabel)}"
                ${hasDeletableSelection ? "" : "disabled"}
              >
                ${renderToolbarButtonContent(deleteToolbarLabel, FaRegTrashCan)}
              </button>
              <button
                class="ping-editor__panel-button ping-editor__toolbar-rotate-button"
                type="button"
                data-action="rotate-selection"
                data-testid="rotate-toolbar-button"
                aria-label="Rotate"
                title="Rotate"
                ${hasRotatableSelection ? "" : "disabled"}
              >
                ${renderToolbarButtonContent("Rotate", RiClockwise2Line)}
              </button>
            </div>
            <div class="ping-editor__toolbar-group">
              <button
                class="ping-editor__panel-button"
                type="button"
                data-action="reset-pulses"
                data-testid="reset-pulses"
                aria-label="Reset Pulses"
                title="Reset Pulses"
              >
                ${renderToolbarButtonContent("Reset", GrPowerReset)}
              </button>
              <button
                class="ping-editor__panel-button ping-editor__toolbar-docs-button"
                type="button"
                data-action="open-docs-sidebar"
                data-testid="docs-toolbar-button"
                aria-label="Docs"
                title="Docs"
              >
                ${renderToolbarButtonContent("Docs", IoIosHelpCircle)}
              </button>
              <div class="ping-editor__toolbar-tempo">
                <label class="ping-editor__field ping-editor__toolbar-field ping-editor__toolbar-tempo-field">
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
                <button
                  class="ping-editor__panel-button ping-editor__toolbar-tempo-button"
                  type="button"
                  data-action="toggle-tempo-popover"
                  data-testid="tempo-popover-button"
                  aria-label="Tempo"
                  aria-expanded="${state.tempoPopoverOpen ? "true" : "false"}"
                  title="Tempo"
                >
                  ${renderToolbarButtonContent("Tempo", TbMetronome)}
                </button>
                ${
                  state.tempoPopoverOpen
                    ? `
                      <div class="ping-editor__tempo-popover" data-tempo-popover data-testid="tempo-popover">
                        <div class="ping-editor__tempo-popover-header">
                          <span class="ping-editor__tempo-popover-title">Tempo</span>
                        </div>
                        <input
                          class="ping-editor__toolbar-slider ping-editor__tempo-popover-slider"
                          type="range"
                          name="tempo"
                          min="1"
                          max="100"
                          step="1"
                          value="${escapeHtml(state.tempo)}"
                          data-action="tempo"
                          data-testid="tempo-popover-input"
                        />
                      </div>
                    `
                    : ""
                }
              </div>
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
              ${renderSidebarToggleIconContent(state.sidebarCollapsed)}
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
                                class="ping-editor__tab ${state.activeTab === tab.id ? "is-active" : ""}"
                                type="button"
                                data-action="set-tab"
                                data-tab="${escapeHtml(tab.id)}"
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
    state.viewportCanvas = state.root.querySelector(".ping-editor__viewport-canvas");
    state.inlineParamLayer = state.root.querySelector(".ping-editor__inline-param-layer");
    restoreSidebarTabsScrollLeft(state.root, state.sidebarTabsScrollLeft);
    restoreMenuCategoriesScrollLeft(state.root, state.menuCategoriesScrollLeft);
    restoreGroupDialogScrollTop(state.root, state.groupDialogScrollTop);
    const restoredMenuFocus =
      state.menu.open && state.menu.focusSearch ? false : restoreMenuFocus(state.root, menuFocusState);
    const restoredGroupDialogFocus = restoreGroupDialogFocus(state.root, groupDialogFocusState);
    const restoredSidebarFocus =
      restoredMenuFocus || restoredGroupDialogFocus
        ? false
        : restoreSidebarFocus(state.root, sidebarFocusState);
    if (!restoredMenuFocus && state.menu.open && state.menu.focusSearch) {
      focusElementWithoutScroll(state.root.querySelector('[data-testid="palette-menu-search"]'));
      state.menu = {
        ...state.menu,
        focusSearch: false,
      };
    }
    if (state.menu.open && state.menu.scrollActiveItem) {
      const activeMenuItem = Array.from(state.root.querySelectorAll("[data-menu-item-id]")).find(
        (element) => element.getAttribute("data-menu-item-id") === state.menu.activeItemId,
      );
      activeMenuItem?.scrollIntoView?.({ block: "nearest" });
      state.menu = {
        ...state.menu,
        scrollActiveItem: false,
      };
    }
    const restoredInlineParamFocus = restoreInlineParamFocus();
    if (restoredInlineParamFocus) {
      scheduleInlineParamFocusRestore();
    }
    if (
      shouldRestoreViewportFocus &&
      !restoredInlineParamFocus &&
      !restoredGroupDialogFocus &&
      !restoredSidebarFocus &&
      !state.menu.open
    ) {
      focusViewport();
    }
    state.dirty = false;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
    state.inlineParamLayerDirty = false;
    state.rendering = false;
  }

  function renderViewport() {
    if (!state.root || !state.viewport || !state.viewportCanvas) {
      render();
      return;
    }

    state.rendering = true;
    syncInlineParamEditFromDom();
    const selection = clearDeletedSelection(state.selection, state.snapshot);
    state.selection = selection;
    state.viewport.style.cursor = getViewportCursor();
    state.viewportCanvas.innerHTML = buildViewportCanvasMarkup(selection);
    let restoredInlineParamLayer = false;
    if (state.inlineParamLayerDirty || !state.inlineParamLayer) {
      state.inlineParamLayer = state.root.querySelector(".ping-editor__inline-param-layer");
      if (state.inlineParamLayer) {
        state.inlineParamLayer.outerHTML = buildInlineParamLayerMarkup();
        state.inlineParamLayer = state.root.querySelector(".ping-editor__inline-param-layer");
        restoredInlineParamLayer = true;
      }
    }
    if (restoredInlineParamLayer) {
      if (restoreInlineParamFocus()) {
        scheduleInlineParamFocusRestore();
      }
    }
    state.dirty = false;
    state.thumbOnlyDirty = false;
    state.viewportOnlyDirty = false;
    state.inlineParamLayerDirty = false;
    state.rendering = false;
  }

  function renderThumbLayer() {
    if (!state.root) {
      return;
    }

    const thumbLayer = state.viewportCanvas?.querySelector(".ping-editor__thumb-layer");

    if (!thumbLayer) {
      render();
      return;
    }

    const previewRenderState =
      state.previewRenderState ??
      createPreviewRenderState(
        state.snapshot,
        state.routes,
        state.registry,
        {
          drag: state.drag,
          nodePositionOverrides: state.nodePositionOverrides,
        },
        state.config,
      );
    state.previewRenderState = previewRenderState;

    thumbLayer.innerHTML = renderThumbLayerMarkup({
      routes: previewRenderState.displayRoutes,
      camera: state.camera,
      config: state.config,
      thumbs: state.thumbs,
      hiddenEdgeIds: previewRenderState.hiddenThumbEdgeIds,
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
    const currentTick = state.runtime?.getMetrics?.()?.lastTickProcessed ?? 0;
    const presentedActivity = state.runtime?.getPresentedActivity?.(
      currentTick,
      getNodePulseWindowTicks(state.tempo),
    );
    const nextThumbs =
      presentedActivity?.thumbs ??
      state.runtime?.getProjectedThumbState?.(currentTick) ??
      state.runtime?.getThumbState?.(currentTick) ??
      [];
    const nextNodePulseStates =
      presentedActivity?.nodePulseStates ??
      state.runtime?.getProjectedNodePulseState?.(
        currentTick,
        getNodePulseWindowTicks(state.tempo),
      ) ??
      state.runtime?.getNodePulseState?.(currentTick, getNodePulseWindowTicks(state.tempo)) ??
      [];
    const previousThumbs = state.thumbs;
    const thumbsChanged = JSON.stringify(nextThumbs) !== JSON.stringify(previousThumbs);

    if (thumbsChanged) {
      state.thumbs = nextThumbs;
      if (!state.dirty) {
        state.thumbOnlyDirty = true;
      }
      state.dirty = true;
    }

    if (JSON.stringify(nextNodePulseStates) !== JSON.stringify(state.nodePulseStates)) {
      state.nodePulseStates = nextNodePulseStates;
      markViewportDirty({ inlineParamLayer: true });
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

  return {
    render,
    renderViewport,
    renderThumbLayer,
    tick,
  };
}
