import { DEFAULT_ICON_LIBRARY } from "../icons/library.js";
import { DEFAULT_NODE_CATEGORY_THEMES } from "../theme/node-theme.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeValue(baseValue, overrideValue) {
  if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
    return mergeUIConfig(baseValue, overrideValue);
  }

  return overrideValue === undefined ? baseValue : overrideValue;
}

export const DEFAULT_UI_CONFIG = Object.freeze({
  grid: {
    GRID_PX: 24,
    snap: true,
    subdivisions: 4,
    worldBounds: null,
  },
  node: {
    paddingPx: 6,
    cornerRadiusPx: 6,
    minSizePx: 32,
    labelOffsetYPx: 14,
    labelMiddleYPct: 0.52,
    labelFontSizePx: 18,
    labelFontWeight: 500,
    labelVisibilityThresholdMultiplier: 1.15,
    fill: "#fbf4ec",
    stroke: "#4a3229",
    text: "#3a2921",
    iconSizePx: 16,
    iconBandHeightPct: 2 / 3,
    iconOffsetXPx: 0,
    iconOffsetYPx: 0,
    inlineParamFontSizePx: 12,
    inlineParamPaddingXPx: 5,
    inlineParamPaddingYPx: 0,
    inlineParamMinWidthPx: 22,
    inlineParamCornerRadiusPx: 4,
    inlineParamVerticalPct: 0.76,
    categoryThemes: DEFAULT_NODE_CATEGORY_THEMES,
  },
  port: {
    radiusPx: 4,
    strokeWidthPx: 1,
    hoverRadiusPx: 8,
    signalIn: "#e45d5d",
    signalOut: "#f2c14e",
    control: "#4c8fd9",
  },
  edge: {
    strokeWidthPx: 2,
    hoverWidthPx: 10,
    cornerRadiusPx: 8,
    previewDash: "4 3",
    mutedOpacity: 0.35,
    stroke: "#8a847c",
    previewStroke: "#7d766c",
  },
  thumb: {
    radiusPx: 4,
    strokeWidthPx: 1,
    color: "#2c2823",
    opacity: 0.9,
  },
  selection: {
    strokeWidthPx: 2,
    color: "#1f6a7a",
    highlightColor: "#2b7fda",
    hoverColor: "#2f8a96",
    dash: "4 2",
  },
  canvas: {
    background: "#ffcfa3",
    gridLine: "#f49595",
    gridAccent: "#f49595",
    gridLineWidthPx: 1,
    gridAccentEvery: 4,
  },
  panel: {
    widthPx: 336,
    bg: "#fbfaf8",
    text: "#2c2823",
    border: "#d7d1c7",
    shadow: "rgba(0,0,0,0.08)",
  },
  text: {
    fontFamily: "\"Courier New\", Courier, monospace",
    fontSizePx: 12,
    fontWeight: 400,
  },
  interaction: {
    dragThresholdPx: 3,
    doubleClickMs: 250,
    panSpeed: 1,
    zoomStep: 0.1,
    minZoom: 0.5,
    maxZoom: 3,
  },
  icons: {
    fallbackId: "default",
    library: DEFAULT_ICON_LIBRARY,
  },
});

export function mergeUIConfig(baseConfig = DEFAULT_UI_CONFIG, overrideConfig = {}) {
  const merged = {};

  for (const [key, baseValue] of Object.entries(baseConfig)) {
    merged[key] = mergeValue(baseValue, overrideConfig[key]);
  }

  for (const [key, overrideValue] of Object.entries(overrideConfig)) {
    if (!(key in merged)) {
      merged[key] = overrideValue;
    }
  }

  return merged;
}
