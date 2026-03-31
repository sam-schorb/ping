const DEFAULT_NODE_CATEGORY_THEMES = Object.freeze({
  default: Object.freeze({
    fill: "#f7dfc8",
    icon: "#8c533a",
    menuChip: "#f0c8a6",
  }),
  Sources: Object.freeze({
    fill: "#72d2c6",
    icon: "#1f6e67",
    menuChip: "#54c4b6",
  }),
  Sinks: Object.freeze({
    fill: "#f1cb67",
    icon: "#8e6722",
    menuChip: "#e4bc4d",
  }),
  Routing: Object.freeze({
    fill: "#8ba3d0",
    icon: "#42597f",
    menuChip: "#738ec0",
  }),
  Math: Object.freeze({
    fill: "#76c8aa",
    icon: "#2e6e59",
    menuChip: "#5fb996",
  }),
  Modifiers: Object.freeze({
    fill: "#ef9467",
    icon: "#8f452c",
    menuChip: "#e67d4c",
  }),
  State: Object.freeze({
    fill: "#d38d59",
    icon: "#734021",
    menuChip: "#c77742",
  }),
  Logic: Object.freeze({
    fill: "#74bbdf",
    icon: "#285c78",
    menuChip: "#5aa8d1",
  }),
  Groups: Object.freeze({
    fill: "#d9a07f",
    icon: "#7b4536",
    menuChip: "#cd8a65",
  }),
  Unknown: Object.freeze({
    fill: "#d7b79f",
    icon: "#6a5040",
    menuChip: "#c79f82",
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
