import { getNodeLabelFontPx, getNodePulseScale } from "../render/svg-layer.js";
import { resolveNodeTheme } from "../theme/node-theme.js";
import { clampParamInput, getNodeScreenBox, getResolvedNodeDefinition } from "./geometry.js";
import { focusElementWithoutScroll } from "./focus-state.js";
import { clamp, escapeHtml, invertHexColor, normalizeHexColor } from "./utils.js";

function getInlineParamFieldLayout(screenBox, value, camera, config) {
  const fontSize = getNodeLabelFontPx(camera, config);
  const paddingX = clamp(
    Math.round(fontSize * 0.45),
    4,
    Number(config.node.inlineParamPaddingXPx ?? 5),
  );
  const paddingY = clamp(
    Math.round(fontSize * 0.12),
    0,
    Number(config.node.inlineParamPaddingYPx ?? 0),
  );
  const minWidth = Number(config.node.inlineParamMinWidthPx ?? 22);
  const verticalPct = Number(config.node.inlineParamVerticalPct ?? 0.76);
  const charWidth = Math.max(6, Math.round(fontSize * 0.68));
  const text = String(value ?? "");
  const width = clamp(
    Math.round(Math.max(minWidth, text.length * charWidth + paddingX * 2)),
    minWidth,
    Math.max(minWidth, Math.round(screenBox.width - 8)),
  );
  const height = fontSize + paddingY * 2;

  return {
    x: Math.round(screenBox.x + (screenBox.width - width) / 2),
    y: Math.round(screenBox.y + screenBox.height * verticalPct - height / 2),
    width,
    height,
    fontSize,
    paddingX,
    paddingY,
    cornerRadius: Number(config.node.inlineParamCornerRadiusPx ?? 4),
  };
}

export function createInlineParamController({ state, markViewportDirty, handleSetParam }) {
  function clearInlineParamBlurCommitTimer() {
    if (state.inlineParamBlurCommitTimer === null) {
      return;
    }

    window.clearTimeout(state.inlineParamBlurCommitTimer);
    state.inlineParamBlurCommitTimer = null;
  }

  function clearInlineParamAutofocusTimer() {
    if (state.inlineParamAutofocusTimer === null) {
      return;
    }

    window.clearTimeout(state.inlineParamAutofocusTimer);
    state.inlineParamAutofocusTimer = null;
  }

  function getInlineParamNodeDefinition(node) {
    const definition = getResolvedNodeDefinition(state.snapshot, node, state.registry);
    return definition?.hasParam ? definition : null;
  }

  function getStoredNodeParamValue(node, definition = getInlineParamNodeDefinition(node)) {
    return String(node?.params?.param ?? definition?.defaultParam ?? 1);
  }

  function getRenderableInlineParamNode(node) {
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

  function restoreInlineParamFocus() {
    if (!state.root || !state.inlineParamEdit) {
      return false;
    }

    const input = state.root.querySelector(
      `[data-action="inline-param"][data-node-id="${state.inlineParamEdit.nodeId}"]`,
    );

    if (!(input instanceof HTMLElement)) {
      return false;
    }

    const valueLength = input.value.length;
    const start = clamp(state.inlineParamEdit.selectionStart ?? valueLength, 0, valueLength);
    const end = clamp(state.inlineParamEdit.selectionEnd ?? valueLength, start, valueLength);

    focusElementWithoutScroll(input);

    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(start, end);
    }

    state.inlineParamEdit = {
      ...state.inlineParamEdit,
      selectionStart: start,
      selectionEnd: end,
      selectAllOnFocus: false,
    };
    return true;
  }

  function scheduleInlineParamFocusRestore(attemptsRemaining = 4) {
    if (state.inlineParamFocusFrameId !== null) {
      window.cancelAnimationFrame(state.inlineParamFocusFrameId);
    }

    state.inlineParamFocusFrameId = window.requestAnimationFrame(() => {
      const restored = state.inlineParamEdit ? restoreInlineParamFocus() : false;
      const activeElement = state.root?.ownerDocument?.activeElement;
      const isFocusedInlineParam = Boolean(
        restored &&
          activeElement?.matches?.("[data-action='inline-param']") &&
          activeElement.getAttribute("data-node-id") === state.inlineParamEdit?.nodeId,
      );

      if (isFocusedInlineParam || attemptsRemaining <= 1 || !state.inlineParamEdit) {
        state.inlineParamFocusFrameId = null;
        return;
      }

      scheduleInlineParamFocusRestore(attemptsRemaining - 1);
    });
  }

  function requestInlineParamAutofocus(nodeId, attemptsRemaining = 10) {
    clearInlineParamAutofocusTimer();

    state.inlineParamAutofocusTimer = window.setTimeout(() => {
      state.inlineParamAutofocusTimer = null;

      if (!state.root || !state.inlineParamEdit || state.inlineParamEdit.nodeId !== nodeId) {
        return;
      }

      const input = state.root.querySelector(
        `[data-action="inline-param"][data-node-id="${nodeId}"]`,
      );

      if (!(input instanceof HTMLElement)) {
        if (attemptsRemaining > 1) {
          requestInlineParamAutofocus(nodeId, attemptsRemaining - 1);
        }
        return;
      }

      focusElementWithoutScroll(input);
      input.select?.();

      if (state.root.ownerDocument?.activeElement !== input && attemptsRemaining > 1) {
        requestInlineParamAutofocus(nodeId, attemptsRemaining - 1);
      }
    }, 16);
  }

  function buildInlineParamLayerMarkup() {
    const fields = state.snapshot.nodes
      .map((node) => {
        const definition = getInlineParamNodeDefinition(node);

        if (!definition) {
          return "";
        }

        const renderNode = getRenderableInlineParamNode(node);
        const screenBox = getNodeScreenBox(state.snapshot, renderNode, state.registry, state.camera, state.config);
        const value =
          state.inlineParamEdit?.nodeId === node.id
            ? state.inlineParamEdit.draftValue
            : getStoredNodeParamValue(node, definition);
        const shouldAutofocus =
          state.inlineParamEdit?.nodeId === node.id && state.inlineParamEdit.selectAllOnFocus === true;
        const layout = getInlineParamFieldLayout(screenBox, value, state.camera, state.config);
        const nodePulseState = state.nodePulseStates.find((entry) => entry.nodeId === node.id) ?? null;
        const pulseProgress = nodePulseState ? clamp(nodePulseState.progress, 0, 1) : null;
        const pulseScale =
          pulseProgress === null
            ? 1
            : getNodePulseScale(pulseProgress, state.camera?.scale, screenBox, state.config);
        const nodeCenterX = screenBox.x + screenBox.width / 2;
        const nodeCenterY = screenBox.y + screenBox.height / 2;
        const pulseTransformStyle =
          Math.abs(pulseScale - 1) < 1e-6
            ? ""
            : `transform:scale(${pulseScale.toFixed(4)});transform-origin:${(nodeCenterX - layout.x).toFixed(3)}px ${(nodeCenterY - layout.y).toFixed(3)}px;`;
        const theme = resolveNodeTheme({
          category: definition.category,
          color: definition.color,
          config: state.config,
        });
        const restingFill = normalizeHexColor(theme.fill, "#f7dfc8");
        const activeFill = invertHexColor(restingFill, "#082037");

        return `
          <input
            class="ping-editor__inline-param"
            type="text"
            id="inline-param-${escapeHtml(node.id)}"
            name="inline-param-${escapeHtml(node.id)}"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            value="${escapeHtml(value)}"
            aria-label="${escapeHtml(`${node.name || definition.label || node.type} parameter`)}"
            data-action="inline-param"
            data-node-id="${escapeHtml(node.id)}"
            data-testid="inline-param-${escapeHtml(node.id)}"
            ${shouldAutofocus ? "autofocus" : ""}
            style="
              left:${layout.x}px;
              top:${layout.y}px;
              width:${layout.width}px;
              height:${layout.height}px;
              font-size:${layout.fontSize}px;
              font-weight:${state.config.node.labelFontWeight ?? state.config.text.fontWeight};
              padding:${layout.paddingY}px ${layout.paddingX}px;
              border-radius:${layout.cornerRadius}px;
              ${pulseTransformStyle}
              --ping-inline-param-fill:${restingFill};
              --ping-inline-param-active-fill:${activeFill};
            "
          />
        `;
      })
      .join("");

    return `
      <div class="ping-editor__inline-param-layer" data-testid="inline-param-layer">
        ${fields}
      </div>
    `;
  }

  function syncInlineParamEditFromDom() {
    if (!state.root || !state.inlineParamEdit) {
      return;
    }

    const input = state.root.querySelector(
      `[data-action="inline-param"][data-node-id="${state.inlineParamEdit.nodeId}"]`,
    );

    if (!(input instanceof HTMLElement)) {
      return;
    }

    state.inlineParamEdit = {
      ...state.inlineParamEdit,
      draftValue: input.value,
      selectionStart:
        typeof input.selectionStart === "number"
          ? input.selectionStart
          : state.inlineParamEdit.selectionStart,
      selectionEnd:
        typeof input.selectionEnd === "number"
          ? input.selectionEnd
          : state.inlineParamEdit.selectionEnd,
    };
  }

  function beginInlineParamEdit(nodeId, { selectAll = false, target = null } = {}) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);
    const definition = node ? getInlineParamNodeDefinition(node) : null;

    if (!node || !definition) {
      state.inlineParamEdit = null;
      return;
    }

    const value = target?.value ?? getStoredNodeParamValue(node, definition);
    const shouldSelectAll = selectAll || Boolean(state.inlineParamEdit?.selectAllOnFocus);
    const valueLength = value.length;
    const selectionStart =
      shouldSelectAll
        ? 0
        : Number.isInteger(target?.selectionStart)
          ? target.selectionStart
          : valueLength;
    const selectionEnd =
      shouldSelectAll
        ? valueLength
        : Number.isInteger(target?.selectionEnd)
          ? target.selectionEnd
          : valueLength;

    state.inlineParamEdit = {
      nodeId,
      draftValue: value,
      selectionStart,
      selectionEnd,
      selectAllOnFocus: shouldSelectAll,
    };
  }

  function parseInlineParamInputValue(value) {
    const trimmed = String(value ?? "").trim();

    if (trimmed === "") {
      return null;
    }

    const numeric = Number(trimmed);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return clampParamInput(numeric);
  }

  function commitInlineParamValue(nodeId, value) {
    const node = state.snapshot.nodes.find((entry) => entry.id === nodeId);
    const definition = node ? getInlineParamNodeDefinition(node) : null;

    if (!node || !definition) {
      return;
    }

    const normalizedValue = parseInlineParamInputValue(value);
    const currentValue = Number(node.params?.param ?? definition.defaultParam ?? 1);

    if (normalizedValue === null) {
      markViewportDirty({ inlineParamLayer: true });
      return false;
    }

    if (currentValue === normalizedValue) {
      markViewportDirty({ inlineParamLayer: true });
      return true;
    }

    handleSetParam(nodeId, normalizedValue);
    return true;
  }

  function cancelInlineParamEdit(nodeId) {
    if (state.inlineParamEdit?.nodeId === nodeId) {
      state.inlineParamEdit = null;
    }

    markViewportDirty({ inlineParamLayer: true });
  }

  return {
    clearInlineParamAutofocusTimer,
    clearInlineParamBlurCommitTimer,
    requestInlineParamAutofocus,
    scheduleInlineParamFocusRestore,
    getInlineParamNodeDefinition,
    buildInlineParamLayerMarkup,
    restoreInlineParamFocus,
    syncInlineParamEditFromDom,
    beginInlineParamEdit,
    commitInlineParamValue,
    cancelInlineParamEdit,
  };
}
