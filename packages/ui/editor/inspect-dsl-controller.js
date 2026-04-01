import {
  CURRENT_GROUP_DSL_FORMAT_VERSION,
  exportGroupDsl,
  isGroupBackedNodeType,
  lowerGroupDsl,
} from "@ping/core";

import { createLocalIssue } from "./utils.js";

export function createInspectDslController({
  state,
  markDirty,
  emitUndo,
  emitGraphOps,
}) {
  function getSelectedGroupBackedNodeContext() {
    if (state.selection.kind !== "node") {
      return null;
    }

    const node = state.snapshot.nodes.find((entry) => entry.id === state.selection.nodeId);

    if (!node || !isGroupBackedNodeType(node.type) || typeof node.groupRef !== "string") {
      return null;
    }

    return {
      node,
      nodeType: node.type,
      groupId: node.groupRef,
      group: state.snapshot.groups?.[node.groupRef] ?? null,
    };
  }

  function deriveInspectDslSource(context) {
    if (!context?.group) {
      return {
        text: "",
        mode: "generated",
        syncStatus: "stale",
        issues: [
          createLocalIssue(
            "UI_GROUP_NOT_FOUND",
            `Group "${context?.groupId ?? ""}" was not found.`,
            { severity: "error" },
          ),
        ],
      };
    }

    if (
      typeof context.group.dsl?.source === "string" &&
      (context.group.dsl.formatVersion ?? 1) >= CURRENT_GROUP_DSL_FORMAT_VERSION
    ) {
      return {
        text: context.group.dsl.source,
        mode: context.group.dsl.mode ?? "authored",
        syncStatus: context.group.dsl.syncStatus ?? "in-sync",
        issues: [],
      };
    }

    const exported = exportGroupDsl(context.group, state.registry, {
      groups: state.snapshot.groups ?? {},
    });

    if (!exported.ok) {
      return {
        text: "",
        mode: "generated",
        syncStatus: "stale",
        issues: exported.errors.map((issue) => ({ ...issue })),
      };
    }

    return {
      text: exported.text,
      mode: "generated",
      syncStatus: "in-sync",
      issues: [],
    };
  }

  function syncInspectDslDraft({ preserveDirty = true } = {}) {
    const context = getSelectedGroupBackedNodeContext();

    if (!context) {
      state.inspectDslDraft = null;
      return;
    }

    const sourceView = deriveInspectDslSource(context);
    const nextDraft = {
      groupId: context.groupId,
      nodeId: context.node.id,
      nodeType: context.nodeType,
      text: sourceView.text,
      mode: sourceView.mode,
      syncStatus: sourceView.syncStatus,
      issues: sourceView.issues,
      dirty: false,
    };
    const current = state.inspectDslDraft;

    if (!current || current.groupId !== context.groupId) {
      state.inspectDslDraft = nextDraft;
      return;
    }

    if (preserveDirty && current.dirty) {
      state.inspectDslDraft = {
        ...current,
        nodeId: context.node.id,
        nodeType: context.nodeType,
        mode: sourceView.mode,
        syncStatus: sourceView.syncStatus,
      };
      return;
    }

    state.inspectDslDraft = nextDraft;
  }

  function handleInspectDslInput(value) {
    if (!state.inspectDslDraft) {
      return;
    }

    state.inspectDslDraft = {
      ...state.inspectDslDraft,
      text: value,
      dirty: true,
      issues: [],
    };
    markDirty();
  }

  function insertInspectDslNewline(target) {
    if (!state.inspectDslDraft || !target) {
      return;
    }

    const value = target.value ?? "";
    const start = Number.isInteger(target.selectionStart) ? target.selectionStart : value.length;
    const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : value.length;
    const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`;
    const nextCaret = start + 1;

    target.value = nextValue;

    if (typeof target.setSelectionRange === "function") {
      target.setSelectionRange(nextCaret, nextCaret);
    }

    handleInspectDslInput(nextValue);
  }

  function handleReloadInspectDsl() {
    syncInspectDslDraft({ preserveDirty: false });
    markDirty();
  }

  function handleJumpDocsCategory(categoryId) {
    if (!state.root) {
      return;
    }

    const panelScroll = state.root.querySelector(".ping-editor__panel-scroll");

    if (!(panelScroll instanceof HTMLElement)) {
      return;
    }

    if (categoryId === "all") {
      if (typeof panelScroll.scrollTo === "function") {
        panelScroll.scrollTo({ top: 0, behavior: "instant" });
      } else {
        panelScroll.scrollTop = 0;
      }
      return;
    }

    const target = panelScroll.querySelector(`[data-docs-category-id="${categoryId}"]`);

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const panelRect = panelScroll.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, panelScroll.scrollTop + (targetRect.top - panelRect.top) - 8);

    if (typeof panelScroll.scrollTo === "function") {
      panelScroll.scrollTo({ top: nextTop, behavior: "instant" });
    } else {
      panelScroll.scrollTop = nextTop;
    }
  }

  function handleApplyInspectDsl() {
    const context = getSelectedGroupBackedNodeContext();

    if (!context || !context.group || !state.inspectDslDraft) {
      return;
    }

    const lowered = lowerGroupDsl(state.inspectDslDraft.text, state.registry, {
      existingGroup: context.group,
      groups: state.snapshot.groups ?? {},
    });

    if (!lowered.ok) {
      state.inspectDslDraft = {
        ...state.inspectDslDraft,
        issues: lowered.errors.map((issue) => ({ ...issue })),
        dirty: true,
      };
      markDirty();
      return;
    }

    const reason = context.nodeType === "code" ? "edit code DSL" : "edit group DSL";
    emitUndo(reason);
    emitGraphOps(
      [
        {
          type: "updateGroup",
          payload: {
            group: lowered.group,
          },
        },
      ],
      reason,
    );
    state.inspectDslDraft = {
      ...state.inspectDslDraft,
      text: lowered.group.dsl?.source ?? state.inspectDslDraft.text,
      mode: lowered.group.dsl?.mode ?? "authored",
      syncStatus: "in-sync",
      issues: [],
      dirty: false,
    };
    markDirty();
  }

  return {
    syncInspectDslDraft,
    handleInspectDslInput,
    insertInspectDslNewline,
    handleReloadInspectDsl,
    handleJumpDocsCategory,
    handleApplyInspectDsl,
  };
}
