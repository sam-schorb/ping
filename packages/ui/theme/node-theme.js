const DEFAULT_NODE_CATEGORY_THEMES = Object.freeze({
  default: Object.freeze({
    fill: "#fbf4ec",
    icon: "#7b6252",
    menuChip: "#efe5db",
  }),
  Sources: Object.freeze({
    fill: "#f3e6df",
    icon: "#b6664c",
    menuChip: "#f0dfd6",
  }),
  Sinks: Object.freeze({
    fill: "#f4ebd7",
    icon: "#b79045",
    menuChip: "#f3e9d2",
  }),
  Routing: Object.freeze({
    fill: "#e7ede6",
    icon: "#6b7a72",
    menuChip: "#e2ebe3",
  }),
  Math: Object.freeze({
    fill: "#efe4d9",
    icon: "#8b6a45",
    menuChip: "#ebdece",
  }),
  Modifiers: Object.freeze({
    fill: "#f3e1dd",
    icon: "#a85e50",
    menuChip: "#efd9d5",
  }),
  State: Object.freeze({
    fill: "#ede2d7",
    icon: "#7b5c45",
    menuChip: "#e6d9cf",
  }),
  Logic: Object.freeze({
    fill: "#e3ebf0",
    icon: "#64798a",
    menuChip: "#dde7ed",
  }),
  Groups: Object.freeze({
    fill: "#e9e2da",
    icon: "#84796c",
    menuChip: "#e3dbd1",
  }),
  Unknown: Object.freeze({
    fill: "#e7ddd2",
    icon: "#8b7e71",
    menuChip: "#e1d7cc",
  }),
});

export { DEFAULT_NODE_CATEGORY_THEMES };

export function resolveNodeTheme({ category, color, config } = {}) {
  const categoryThemes = config?.node?.categoryThemes ?? {};
  const categoryKey =
    typeof category === "string" && category.trim() !== "" ? category.trim() : "default";
  const builtinTheme = DEFAULT_NODE_CATEGORY_THEMES[categoryKey] ?? {};
  const configuredDefaultTheme = categoryThemes.default ?? {};
  const configuredCategoryTheme = categoryThemes[categoryKey] ?? {};
  const theme = {
    ...DEFAULT_NODE_CATEGORY_THEMES.default,
    ...builtinTheme,
    ...configuredDefaultTheme,
    ...configuredCategoryTheme,
  };
  const fallbackIcon = typeof color === "string" && color.trim() !== "" ? color : undefined;

  return {
    fill: theme.fill,
    icon: theme.icon ?? fallbackIcon ?? DEFAULT_NODE_CATEGORY_THEMES.default.icon,
    menuChip:
      theme.menuChip ??
      theme.fill ??
      DEFAULT_NODE_CATEGORY_THEMES.default.menuChip,
  };
}
