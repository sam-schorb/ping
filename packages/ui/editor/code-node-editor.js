import {
  CURRENT_GROUP_DSL_FORMAT_VERSION,
  GraphModel,
  exportGroupDsl,
  lowerGroupDsl,
} from "@ping/core";

import { getNodeLabelFontPx } from "../render/svg-layer.js";
import { getNodeScreenBox } from "./geometry.js";
import { clamp, escapeHtml } from "./utils.js";

function getRenderableCodeNode(node, state) {
  const overridePos = state.nodePositionOverrides.get(node.id);

  if (!overridePos) {
    return node;
  }

  return {
    ...node,
    pos: {
      x: overridePos.x,
      y: overridePos.y,
    },
  };
}

function getCodeNodeEditButtonLayout(screenBox, camera, config) {
  const labelFontPx = getNodeLabelFontPx(camera, config);
  const nodeInset = Math.max(2, Math.round(Math.min(screenBox.width, screenBox.height) * 0.08));
  const availableWidth = Math.max(0, screenBox.width - nodeInset * 2);
  const availableHeight = Math.max(0, screenBox.height - nodeInset * 2);
  const preferredWidth = Math.round(labelFontPx * 2.85);
  const preferredHeight = Math.round(labelFontPx * 1.48);
  const width = Math.round(Math.min(preferredWidth, Math.max(22, availableWidth)));
  const height = Math.round(Math.min(preferredHeight, Math.max(18, availableHeight)));
  const centerX = screenBox.x + screenBox.width / 2;
  const centerY = screenBox.y + screenBox.height * (config.node.labelMiddleYPct ?? 0.52);

  return {
    x: Math.round(centerX - width / 2),
    y: Math.round(centerY - height / 2),
    width,
    height,
    fontSize: clamp(Math.round(labelFontPx * 0.86), 11, 18),
    borderRadius: Math.round(height * 0.34),
  };
}

function normalizeIssue(issue, fallbackCode = "UI_CODE_EDITOR_ERROR") {
  return {
    code: issue?.code ?? fallbackCode,
    message: issue?.message ?? "The code could not be applied.",
    severity: issue?.severity ?? "error",
  };
}

function renderCodeEditorIssue(issue, index) {
  return `
    <li class="ping-editor__code-editor-issue" data-testid="code-editor-issue-${index}">
      <span class="ping-editor__code-editor-issue-code">${escapeHtml(issue.code)}</span>
      <span>${escapeHtml(issue.message)}</span>
    </li>
  `;
}

function getCodeNodeContext(state, nodeId) {
  const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);

  if (!node || node.type !== "code" || typeof node.groupRef !== "string") {
    return null;
  }

  return {
    node,
    groupId: node.groupRef,
    group: state.snapshot.groups?.[node.groupRef] ?? null,
  };
}

function deriveCodeSource(state, context) {
  if (!context?.group) {
    return {
      text: "",
      mode: "authored",
      syncStatus: "stale",
      issues: [
        normalizeIssue({
          code: "UI_CODE_GROUP_NOT_FOUND",
          message: `Code backing group "${context?.groupId ?? ""}" was not found.`,
        }),
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
      issues: exported.errors.map((issue) => normalizeIssue(issue)),
    };
  }

  return {
    text: exported.text,
    mode: "generated",
    syncStatus: "in-sync",
    issues: [],
  };
}

function preflightCodeGroupUpdate(state, op) {
  try {
    const model = new GraphModel({
      getNodeDefinition: (type) => state.registry.getNodeDefinition(type),
      snapshot: state.snapshot,
    });

    return model.applyOps([op]);
  } catch (error) {
    return {
      ok: false,
      errors: [
        normalizeIssue({
          code: error?.code ?? "UI_CODE_PREFLIGHT_FAILED",
          message: error?.message ?? "The edited code would make the current graph invalid.",
        }),
      ],
    };
  }
}

export function renderCodeNodeEditLayer(state) {
  const buttons = state.snapshot.nodes
    .filter((node) => node.type === "code")
    .map((node) => {
      const renderNode = getRenderableCodeNode(node, state);
      const screenBox = getNodeScreenBox(state.snapshot, renderNode, state.registry, state.camera, state.config);
      const layout = getCodeNodeEditButtonLayout(screenBox, state.camera, state.config);
      const label = `${node.name || "Code"} DSL`;

      return `
        <button
          class="ping-editor__code-node-edit-button"
          type="button"
          data-action="open-code-editor"
          data-node-id="${escapeHtml(node.id)}"
          data-testid="code-node-edit-${escapeHtml(node.id)}"
          aria-label="${escapeHtml(label)}"
          title="${escapeHtml(label)}"
          style="left:${layout.x}px; top:${layout.y}px; width:${layout.width}px; height:${layout.height}px; border-radius:${layout.borderRadius}px; font-size:${layout.fontSize}px;"
        >
          <span aria-hidden="true">&lt;/&gt;</span>
        </button>
      `;
    })
    .join("");

  return `
    <div class="ping-editor__code-node-edit-layer" data-testid="code-node-edit-layer">
      ${buttons}
    </div>
  `;
}

export function renderCodeEditorModal(draft) {
  if (!draft?.open) {
    return "";
  }

  const issues = Array.isArray(draft.issues) ? draft.issues : [];

  return `
    <div class="ping-editor__code-editor-overlay" data-testid="code-editor-overlay">
      <div class="ping-editor__code-editor-backdrop" data-testid="code-editor-backdrop"></div>
      <section
        class="ping-editor__code-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ping-code-editor-title"
        data-testid="code-editor-modal"
      >
        <header class="ping-editor__code-editor-header">
          <div>
            <h2 id="ping-code-editor-title">Code</h2>
            <p class="ping-editor__code-editor-subtitle">${escapeHtml(draft.nodeId)}</p>
          </div>
        </header>
        <textarea
          class="ping-editor__code-editor-source"
          name="code-editor-source"
          spellcheck="false"
          autocomplete="off"
          data-action="code-editor-source"
          data-node-id="${escapeHtml(draft.nodeId)}"
          data-testid="code-editor-source"
        >${escapeHtml(draft.text)}</textarea>
        ${
          issues.length > 0
            ? `
              <ul class="ping-editor__code-editor-issues" data-testid="code-editor-issues">
                ${issues.map((issue, index) => renderCodeEditorIssue(issue, index)).join("")}
              </ul>
            `
            : ""
        }
        <div class="ping-editor__action-row">
          <button class="ping-editor__panel-button" type="button" data-action="cancel-code-editor">
            Cancel
          </button>
          <button class="ping-editor__panel-button is-primary" type="button" data-action="apply-code-editor" data-testid="code-editor-apply">
            OK
          </button>
        </div>
      </section>
    </div>
  `;
}

export function createCodeNodeEditorController({
  state,
  markDirty,
  emitUndo,
  emitGraphOps,
  pushLocalIssue,
  focusViewport,
}) {
  function openCodeEditor(nodeId) {
    const context = getCodeNodeContext(state, nodeId);

    if (!context) {
      pushLocalIssue?.("UI_CODE_NODE_NOT_FOUND", `Code node "${nodeId ?? ""}" was not found.`, {
        severity: "error",
      });
      return;
    }

    const source = deriveCodeSource(state, context);

    state.codeEditorDraft = {
      open: true,
      nodeId: context.node.id,
      groupId: context.groupId,
      text: source.text,
      originalText: source.text,
      mode: source.mode,
      syncStatus: source.syncStatus,
      issues: source.issues,
      dirty: false,
      focusOnOpen: true,
    };
    markDirty();
  }

  function handleCodeEditorInput(value) {
    if (!state.codeEditorDraft?.open) {
      return;
    }

    state.codeEditorDraft = {
      ...state.codeEditorDraft,
      text: value,
      issues: [],
      dirty: true,
      focusOnOpen: false,
    };
    markDirty();
  }

  function cancelCodeEditor({ restoreViewportFocus = true } = {}) {
    if (!state.codeEditorDraft?.open) {
      return;
    }

    state.codeEditorDraft = null;

    if (restoreViewportFocus) {
      focusViewport?.();
    }

    markDirty();
  }

  function applyCodeEditor() {
    const draft = state.codeEditorDraft;

    if (!draft?.open) {
      return;
    }

    const context = getCodeNodeContext(state, draft.nodeId);

    if (!context?.group) {
      state.codeEditorDraft = {
        ...draft,
        issues: [
          normalizeIssue({
            code: "UI_CODE_GROUP_NOT_FOUND",
            message: `Code backing group "${draft.groupId}" was not found.`,
          }),
        ],
        focusOnOpen: false,
      };
      markDirty();
      return;
    }

    if (!draft.dirty && draft.syncStatus === "in-sync") {
      cancelCodeEditor();
      return;
    }

    const lowered = lowerGroupDsl(draft.text, state.registry, {
      existingGroup: context.group,
      groups: state.snapshot.groups ?? {},
    });

    if (!lowered.ok) {
      state.codeEditorDraft = {
        ...draft,
        issues: lowered.errors.map((issue) => normalizeIssue(issue)),
        dirty: true,
        focusOnOpen: false,
      };
      markDirty();
      return;
    }

    const op = {
      type: "updateGroup",
      payload: {
        group: lowered.group,
      },
    };
    const preflight = preflightCodeGroupUpdate(state, op);

    if (!preflight.ok) {
      state.codeEditorDraft = {
        ...draft,
        issues: (preflight.errors ?? []).map((issue) => normalizeIssue(issue, "UI_CODE_PREFLIGHT_FAILED")),
        dirty: true,
        focusOnOpen: false,
      };
      markDirty();
      return;
    }

    emitUndo("edit code DSL");
    emitGraphOps([op], "edit code DSL");
    state.codeEditorDraft = null;
    focusViewport?.();
    markDirty();
  }

  function clearMissingCodeEditorDraft() {
    const draft = state.codeEditorDraft;

    if (!draft?.open) {
      return;
    }

    const context = getCodeNodeContext(state, draft.nodeId);

    if (!context?.group || context.groupId !== draft.groupId) {
      state.codeEditorDraft = null;
    }
  }

  return {
    openCodeEditor,
    handleCodeEditorInput,
    cancelCodeEditor,
    applyCodeEditor,
    clearMissingCodeEditorDraft,
  };
}
