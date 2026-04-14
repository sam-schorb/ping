import { getPaletteMenuModel } from "../panels/palette.js";
import { createClipboardSubgraph, createDeleteNodeSetOps, instantiateClipboardSubgraph } from "./ops.js";
import { createEmptySelection, isTextInputTarget } from "./state.js";
import {
  CLIPBOARD_MIME,
  CLIPBOARD_TEXT_MARKER,
  cloneValue,
  getSidebarTabIds,
} from "./utils.js";

export function createInputController({
  state,
  onSidebarAction,
  markDirty,
  defaultPaletteMenuCategoryId,
  emitOutput,
  selectionToFocusTarget,
  updateTempo,
  requestUndo,
  requestRedo,
  openMenuAt,
  closeMenu,
  focusViewport,
  getViewportCenterWorld,
  handleCreateNode,
  handleRotateSelection,
  handleDeleteSelection,
  handleCancelEdgeCreate,
  handleUndoEdgeCreateCorner,
  handleRenameNode,
  handleSetParam,
  handleGroupOpen,
  handleGroupEdit,
  handleGroupMove,
  handleGroupRemoveMapping,
  handleGroupRestore,
  handleGroupExposeInstead,
  handleGroupCommit,
  handleRemoveGroup,
  handleInspectDslInput,
  insertInspectDslNewline,
  handleApplyInspectDsl,
  handleReloadInspectDsl,
  handleJumpDocsCategory,
  handleFileInputChange,
  getSelectedNodeIds,
  clearNodeSetSelection,
  emitSelection,
  setNodeSetSelection,
  emitUndo,
  emitGraphOps,
  rememberClipboardPayload,
  getClipboardSignature,
  getPasteTargetPosition,
  createDeterministicId,
  beginInlineParamEdit,
  clearInlineParamBlurCommitTimer,
  commitInlineParamValue,
  cancelInlineParamEdit,
}) {
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

  function getCurrentPaletteMenuModel() {
    return getPaletteMenuModel({
      palette: state.palette,
      groups: state.snapshot.groups ?? {},
      activeCategory: state.menu.category,
      query: state.menu.query,
      activeItemId: state.menu.activeItemId,
    });
  }

  function getActivePaletteMenuItem() {
    return getCurrentPaletteMenuModel().activeItem;
  }

  function movePaletteMenuSelection(direction) {
    const model = getCurrentPaletteMenuModel();

    if (model.items.length === 0) {
      return false;
    }

    const activeItem = model.activeItem ?? model.items[0];
    const activeIndex = Math.max(
      0,
      model.items.findIndex((item) => item.id === activeItem?.id),
    );
    const nextIndex = Math.max(0, Math.min(activeIndex + direction, model.items.length - 1));
    const nextItem = model.items[nextIndex];

    if (!nextItem || nextItem.id === state.menu.activeItemId) {
      return false;
    }

    state.menu = {
      ...state.menu,
      activeItemId: nextItem.id,
      scrollActiveItem: true,
    };
    markDirty();
    return true;
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
    if (
      state.menu.open &&
      event.target?.matches?.("[data-action='search-menu']") &&
      (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        movePaletteMenuSelection(event.key === "ArrowDown" ? 1 : -1);
        return;
      }

      const activeMenuItem = getActivePaletteMenuItem();

      if (!activeMenuItem) {
        return;
      }

      event.preventDefault();
      if (activeMenuItem.action === "create-group-node") {
        handleCreateNode("group", activeMenuItem.groupRef);
      } else {
        handleCreateNode(activeMenuItem.type);
      }
      return;
    }

    if (event.target?.matches?.("[data-action='inline-param']")) {
      const nodeId = event.target.getAttribute("data-node-id");

      if (event.key === "Enter") {
        event.preventDefault();
        clearInlineParamBlurCommitTimer();
        if (state.inlineParamEdit?.nodeId === nodeId) {
          state.inlineParamEdit = null;
        }
        event.target.dataset.inlineParamSkipBlurCommit = "true";
        commitInlineParamValue(nodeId, event.target.value);
        focusViewport();
        event.target.blur();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearInlineParamBlurCommitTimer();
        if (state.inlineParamEdit?.nodeId === nodeId) {
          state.inlineParamEdit = null;
        }
        event.target.dataset.inlineParamSkipBlurCommit = "true";
        cancelInlineParamEdit(nodeId);
        focusViewport();
        event.target.blur();
        return;
      }
    }

    if (
      event.target?.matches?.("[data-action='group-dsl-source']") &&
      event.key === "Enter"
    ) {
      if (event.shiftKey) {
        event.preventDefault();
        insertInspectDslNewline(event.target);
        return;
      }

      event.preventDefault();
      handleApplyInspectDsl();
      return;
    }

    if (event.key === "Escape" && state.tempoPopoverOpen && event.target?.closest?.("[data-tempo-popover]")) {
      event.preventDefault();
      state.tempoPopoverOpen = false;
      markDirty();
      focusViewport();
      return;
    }

    if (isTextInputTarget(event.target)) {
      return;
    }

    if (state.drag.kind === "edge-create") {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelEdgeCreate();
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();

        if (!handleUndoEdgeCreateCorner()) {
          handleCancelEdgeCreate();
        }
        return;
      }
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
        return createDeterministicId(prefix);
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

  function handleActionClick(target) {
    if (!target) {
      return false;
    }

    const action = target.getAttribute("data-action");

    if (!action) {
      return false;
    }

    function closeTempoPopover() {
      if (!state.tempoPopoverOpen) {
        return false;
      }

      state.tempoPopoverOpen = false;
      return true;
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
      const nextTab = target.getAttribute("data-tab");

      if (getSidebarTabIds(state.sidebarExtensions).has(nextTab)) {
        state.activeTab = nextTab;
        markDirty();
      }
      return true;
    }

    if (action === "set-menu-category") {
      state.menu = {
        ...state.menu,
        category: target.getAttribute("data-menu-category") || defaultPaletteMenuCategoryId,
        activeItemId: null,
        scrollActiveItem: false,
      };
      markDirty();
      return true;
    }

    if (action === "toggle-sidebar") {
      closeTempoPopover();
      state.sidebarAutoMode = false;
      state.sidebarCollapsed = !state.sidebarCollapsed;
      markDirty();
      return true;
    }

    if (action === "open-docs-sidebar") {
      closeTempoPopover();
      state.sidebarAutoMode = false;
      state.sidebarCollapsed = false;
      state.activeTab = "docs";
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
      closeTempoPopover();
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

    if (action === "cancel-edge-create") {
      handleCancelEdgeCreate();
      return true;
    }

    if (action === "reset-pulses") {
      closeTempoPopover();
      state.runtime?.resetPulses?.();
      emitOutput({ type: "runtime/resetPulses" });
      return true;
    }

    if (action === "toggle-tempo-popover") {
      state.tempoPopoverOpen = !state.tempoPopoverOpen;
      markDirty();
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

    if (action === "apply-group-dsl") {
      handleApplyInspectDsl();
      return true;
    }

    if (action === "reload-group-dsl") {
      handleReloadInspectDsl();
      return true;
    }

    if (action === "jump-docs-category") {
      handleJumpDocsCategory(target.getAttribute("data-docs-category"));
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
      markDirty();
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

    if (action === "group-expose-instead") {
      handleGroupExposeInstead(
        target.getAttribute("data-group-kind"),
        target.getAttribute("data-group-id"),
      );
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

    if (target.matches("[data-action='group-preserve-delays']") && state.groupDraft) {
      state.groupDraft = {
        ...state.groupDraft,
        preserveInternalCableDelays: target.checked,
      };
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

    if (target.matches("[data-action='inline-param']")) {
      beginInlineParamEdit(target.getAttribute("data-node-id"), { target });
      return;
    }

    if (target.matches("[data-action='search-menu']")) {
      if (state.menu.query === target.value) {
        return;
      }

      state.menu = {
        ...state.menu,
        query: target.value,
        focusSearch: false,
        activeItemId: null,
        scrollActiveItem: false,
      };
      markDirty();
      return;
    }

    if (target.matches("[data-action='group-dsl-source']")) {
      handleInspectDslInput(target.value);
      return;
    }

    if (target.matches("[data-action='group-name']") && state.groupDraft) {
      state.groupDraft = {
        ...state.groupDraft,
        name: target.value,
      };
    }
  }

  function handleFocusIn(event) {
    const target = event.target;

    if (!target?.matches?.("[data-action='inline-param']")) {
      return;
    }

    clearInlineParamBlurCommitTimer();
    const nodeId = target.getAttribute("data-node-id");
    const shouldSelectAll = Boolean(
      state.inlineParamEdit?.nodeId === nodeId && state.inlineParamEdit.selectAllOnFocus,
    );

    beginInlineParamEdit(nodeId, { target, selectAll: shouldSelectAll });

    if (shouldSelectAll && typeof target.setSelectionRange === "function") {
      const valueLength = target.value.length;
      target.setSelectionRange(0, valueLength);
      state.inlineParamEdit = {
        ...state.inlineParamEdit,
        selectionStart: 0,
        selectionEnd: valueLength,
      };
    }
  }

  function handleFocusOut(event) {
    const target = event.target;

    if (!target?.matches?.("[data-action='inline-param']") || state.rendering) {
      return;
    }

    clearInlineParamBlurCommitTimer();

    const nodeId = target.getAttribute("data-node-id");

    if (target.dataset.inlineParamSkipBlurCommit === "true") {
      delete target.dataset.inlineParamSkipBlurCommit;
      return;
    }

    const draftValue = target.value;

    if (state.inlineParamEdit?.nodeId === nodeId) {
      state.inlineParamEdit = null;
    }

    state.inlineParamBlurCommitTimer = window.setTimeout(() => {
      state.inlineParamBlurCommitTimer = null;
      commitInlineParamValue(nodeId, draftValue);
    }, 0);
  }

  function handleRootClick(event, handleViewportClick) {
    if (
      state.tempoPopoverOpen &&
      !event.target?.closest?.("[data-tempo-popover], [data-action='toggle-tempo-popover']")
    ) {
      state.tempoPopoverOpen = false;
      markDirty();
    }

    if (handleActionClick(event.target.closest("[data-action]"))) {
      return;
    }

    handleViewportClick(event);
  }

  return {
    handleKeyDown,
    handleDocumentKeyDown,
    handleCopy,
    handleCut,
    handlePaste,
    handleActionClick,
    handleChange,
    handleInput,
    handleFocusIn,
    handleFocusOut,
    handleRootClick,
  };
}
