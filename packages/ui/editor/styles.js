import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine, RiArrowUpSLine } from "react-icons/ri";

import { escapeHtml } from "./utils.js";

export const COLLAPSED_SIDEBAR_WIDTH_PX = 52;
export const SIDEBAR_TOGGLE_OVERHANG_PX = 32;

function renderToolbarIconMarkup(IconComponent) {
  return renderToStaticMarkup(
    createElement(IconComponent, {
      "aria-hidden": "true",
      focusable: "false",
    }),
  );
}

export function renderToolbarButtonContent(label, IconComponent) {
  return `
    <span class="ping-editor__toolbar-button-icon" aria-hidden="true">
      ${renderToolbarIconMarkup(IconComponent)}
    </span>
    <span class="ping-editor__toolbar-button-label">${escapeHtml(label)}</span>
  `;
}

export function renderToolbarIconButtonContent(IconComponent) {
  return `
    <span class="ping-editor__toolbar-button-icon ping-editor__toolbar-button-icon--always-visible" aria-hidden="true">
      ${renderToolbarIconMarkup(IconComponent)}
    </span>
  `;
}

export function renderSidebarToggleIconContent(collapsed) {
  return `
    <span class="ping-editor__sidebar-toggle-icon ping-editor__sidebar-toggle-icon--desktop" aria-hidden="true">
      ${renderToolbarIconMarkup(collapsed ? RiArrowLeftSLine : RiArrowRightSLine)}
    </span>
    <span class="ping-editor__sidebar-toggle-icon ping-editor__sidebar-toggle-icon--mobile" aria-hidden="true">
      ${renderToolbarIconMarkup(collapsed ? RiArrowUpSLine : RiArrowDownSLine)}
    </span>
  `;
}

function getSidebarWidthCss(config) {
  return `min(${Math.max(280, config.panel.widthPx - 16)}px, 48vw, 560px)`;
}

export function getToolbarSidebarClearanceCss(config, sidebarCollapsed) {
  if (sidebarCollapsed) {
    return `${COLLAPSED_SIDEBAR_WIDTH_PX}px`;
  }

  return `calc(${getSidebarWidthCss(config)} + ${SIDEBAR_TOGGLE_OVERHANG_PX}px)`;
}

export function createStyles(config) {
  const collapsedSidebarWidthPx = COLLAPSED_SIDEBAR_WIDTH_PX;
  const sidebarWidthCss = getSidebarWidthCss(config);
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
        justify-content: flex-start;
        min-height: ${collapsedSidebarWidthPx}px;
        padding: 5px 10px;
        padding-inline-end: calc(10px + var(--ping-toolbar-sidebar-clearance, 0px));
        border-bottom: 1px solid var(--ping-chrome-border-strong);
        background: var(--ping-chrome-shell);
        backdrop-filter: blur(18px);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
        transition: padding-inline-end 160ms ease;
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
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
      .ping-editor__toolbar-button-icon {
        display: none;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        line-height: 0;
      }
      .ping-editor__toolbar-button-icon--always-visible {
        display: inline-flex;
      }
      .ping-editor__toolbar-button-icon svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .ping-editor__toolbar-button-label {
        display: inline;
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
      .ping-editor__viewport-canvas {
        position: absolute;
        inset: 0;
      }
      .ping-editor__inline-param-layer {
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
      }
      .ping-editor__inline-param {
        position: absolute;
        margin: 0;
        border: 0;
        outline: none;
        appearance: none;
        pointer-events: auto;
        background: var(--ping-inline-param-fill);
        color: ${config.node.text};
        font: inherit;
        line-height: 1;
        text-align: center;
        caret-color: transparent;
      }
      .ping-editor__inline-param:focus {
        background: var(--ping-inline-param-active-fill);
        color: #ffffff;
        caret-color: #ffffff;
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        line-height: 0;
      }
      .ping-editor__sidebar-toggle-icon svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      .ping-editor__sidebar-toggle-icon--mobile {
        display: none;
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
        background: var(--ping-chrome-accent);
        border-color: var(--ping-chrome-accent);
        color: var(--ping-chrome-on-accent);
        box-shadow: 0 10px 18px rgba(95, 49, 41, 0.16);
      }
      .ping-editor__tab.is-active {
        background: var(--ping-chrome-plate);
        color: var(--ping-chrome-ink-strong);
        box-shadow: inset 0 -2px 0 var(--ping-chrome-accent);
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
      .ping-editor__mapping-copy {
        display: grid;
        gap: 4px;
      }
      .ping-editor__mapping-note {
        color: var(--ping-chrome-ink-muted);
        font-size: 11px;
      }
      .ping-editor__group-unavailable {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      .ping-editor__group-unavailable-title {
        margin: 0;
        color: var(--ping-chrome-ink-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .ping-editor__docs-panel {
        gap: 16px;
      }
      .ping-editor__docs-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .ping-editor__docs-tag {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border: 1px solid;
        border-radius: 12px;
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: 0.03em;
        text-transform: lowercase;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
        transition:
          opacity 120ms ease,
          box-shadow 140ms ease;
      }
      .ping-editor__docs-tag:hover {
        opacity: 0.8;
      }
      .ping-editor__docs-tag.is-all {
        background: var(--ping-chrome-card-strong);
        color: var(--ping-chrome-ink);
        border-color: var(--ping-chrome-border);
      }
      .ping-editor__docs-tag.is-compact {
        padding: 3px 8px;
        font-size: 10px;
      }
      .ping-editor__docs-sections {
        display: grid;
        gap: 20px;
      }
      .ping-editor__docs-section-title {
        margin: 0 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ping-chrome-ink-muted);
      }
      .ping-editor__docs-list {
        display: grid;
        gap: 10px;
      }
      .ping-editor__docs-entry {
        display: grid;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 16px;
        border: 1px solid var(--ping-chrome-border);
        background: var(--ping-chrome-card);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
      }
      .ping-editor__docs-entry-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ping-editor__docs-entry-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__docs-entry-copy {
        margin: 0;
        font-size: 12px;
        color: var(--ping-chrome-ink-muted);
        line-height: 1.4;
      }
      .ping-editor__docs-entry-copy strong {
        color: var(--ping-chrome-ink);
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
      .ping-editor__menu-header {
        display: grid;
        gap: 6px;
      }
      .ping-editor__menu-search-input {
        width: 100%;
        min-height: 34px;
        border: 1px solid var(--ping-chrome-border);
        border-radius: 12px;
        padding: 7px 10px;
        font: inherit;
        background: rgba(255, 250, 247, 0.96);
        color: var(--ping-chrome-ink-strong);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
      }
      .ping-editor__menu-search-input::placeholder {
        color: var(--ping-chrome-ink-muted);
      }
      .ping-editor__menu-search-input:focus {
        outline: 2px solid var(--ping-chrome-focus);
        border-color: var(--ping-chrome-accent);
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
      .ping-editor__menu-item.is-active {
        border-color: var(--ping-chrome-notice-border);
        background: var(--ping-chrome-notice-soft);
        color: var(--ping-chrome-ink-strong);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.24),
          0 0 0 1px rgba(133, 184, 255, 0.14);
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
      .ping-editor__menu-item-body {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .ping-editor__menu-item-label {
        font-weight: 700;
        line-height: 1.2;
      }
      .ping-editor__menu-item-meta {
        color: var(--ping-chrome-ink-muted);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
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
      .ping-editor__group-checkbox {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        margin-top: 16px;
        padding: 12px;
        border: 1px solid var(--ping-chrome-border);
        border-radius: 16px;
        background: var(--ping-chrome-card);
        cursor: pointer;
      }
      .ping-editor__group-checkbox-input {
        margin: 2px 0 0;
      }
      .ping-editor__group-checkbox-copy {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .ping-editor__group-checkbox-label {
        font-weight: 600;
        color: var(--ping-chrome-ink-strong);
      }
      .ping-editor__group-checkbox-note {
        color: #6d675e;
        line-height: 1.35;
      }
      .ping-editor__group-section {
        display: grid;
        gap: 10px;
        margin-top: 16px;
      }
      .ping-editor__group-dialog .ping-editor__action-row {
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
        .ping-editor__toolbar {
          padding-inline-end: 10px;
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
        .ping-editor__sidebar-toggle-icon--desktop {
          display: none;
        }
        .ping-editor__sidebar-toggle-icon--mobile {
          display: inline-flex;
        }
      }
      @media (max-width: 720px) {
        .ping-editor__toolbar {
          flex-wrap: nowrap;
          gap: 4px;
          padding: 6px 8px;
        }
        .ping-editor__toolbar-group {
          gap: 4px;
        }
        [data-testid="undo-button"],
        .ping-editor__toolbar [data-testid="redo-button"] {
          display: none;
        }
        .ping-editor__toolbar .ping-editor__panel-button {
          min-height: 22px;
          padding: 2px 7px;
        }
        .ping-editor__toolbar .ping-editor__icon-button {
          width: 22px;
          height: 22px;
        }
        .ping-editor__toolbar-button-icon {
          display: inline-flex;
        }
        .ping-editor__toolbar-button-label,
        .ping-editor__toolbar-label {
          display: none;
        }
        .ping-editor__toolbar-slider {
          width: clamp(72px, 24vw, 96px);
          min-width: 0;
        }
        .ping-editor__menu {
          border-radius: 24px;
          box-shadow: 0 20px 45px ${config.panel.shadow};
        }
      }
      .ping-editor__selection-highlight {
        stroke: ${selectionHighlightColor};
      }
    </style>
  `;
}
