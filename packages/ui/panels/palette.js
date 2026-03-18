import { resolveIcon } from "../icons/library.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const DEFAULT_PALETTE_MENU_CATEGORY_ID = "basic";

const BASIC_MENU_TYPES = new Set(["pulse", "out", "add", "set", "const1", "speed"]);
const CATEGORY_ORDER = ["Sources", "Sinks", "Routing", "Math", "Constants", "Modifiers", "State", "Logic"];
const STACKED_CATEGORY_THRESHOLD = 5;

function normalizeCategoryId(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "other";
}

function getCategoryDisplayLabel(category) {
  const normalized = String(category ?? "").trim().toLowerCase();

  if (normalized === "constants") {
    return "consts";
  }

  if (normalized === "modifiers") {
    return "mods";
  }

  return normalized;
}

function createMenuIcon(item, icons) {
  const icon = resolveIcon(item.icon, icons);
  const stroke = item.color || "#2c2823";

  return `
    <span class="ping-editor__menu-item-icon-wrap" aria-hidden="true">
      <svg
        class="ping-editor__menu-item-icon"
        viewBox="${icon.viewBox}"
        width="18"
        height="18"
      >
        <path
          d="${icon.path}"
          fill="none"
          stroke="${escapeHtml(stroke)}"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
  `;
}

function createBuiltInMenuItem(item) {
  return {
    id: item.type,
    label: item.label,
    action: "create-node",
    type: item.type,
    icon: item.icon,
    color: item.color,
    testId: `palette-menu-${item.type}`,
  };
}

function createGroupMenuItem(group) {
  return {
    id: group.id,
    label: group.name ?? group.id,
    action: "create-group-node",
    groupRef: group.id,
    icon: "group",
    color: "#7f786d",
    testId: `palette-menu-group-${group.id}`,
  };
}

function buildPaletteMenuCategories(palette, groups) {
  const builtInItems = palette.map(createBuiltInMenuItem);
  const categories = [];
  const seenCategoryIds = new Set();

  const basicItems = builtInItems.filter((item) => BASIC_MENU_TYPES.has(item.type));

  if (basicItems.length > 0) {
    categories.push({
      id: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      label: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      items: basicItems,
    });
    seenCategoryIds.add(DEFAULT_PALETTE_MENU_CATEGORY_ID);
  }

  for (const category of CATEGORY_ORDER) {
    const items = palette
      .filter((item) => item.category === category)
      .map(createBuiltInMenuItem);
    const categoryId = normalizeCategoryId(category);

    if (items.length === 0 || seenCategoryIds.has(categoryId)) {
      continue;
    }

    categories.push({
      id: categoryId,
      label: getCategoryDisplayLabel(category),
      items,
    });
    seenCategoryIds.add(categoryId);
  }

  const extraCategoryLabels = [
    ...new Set(
      palette
        .map((item) => item.category)
        .filter((category) => typeof category === "string" && category.trim() !== "")
        .filter((category) => !CATEGORY_ORDER.includes(category)),
    ),
  ];

  for (const category of extraCategoryLabels) {
    const categoryId = normalizeCategoryId(category);

    if (seenCategoryIds.has(categoryId)) {
      continue;
    }

    categories.push({
      id: categoryId,
      label: getCategoryDisplayLabel(category),
      items: palette.filter((item) => item.category === category).map(createBuiltInMenuItem),
    });
    seenCategoryIds.add(categoryId);
  }

  const groupItems = Object.values(groups ?? {}).map(createGroupMenuItem);

  if (groupItems.length > 0) {
    categories.push({
      id: "groups",
      label: "groups",
      items: groupItems,
    });
  }

  return categories;
}

export function getPaletteMenuModel({ palette, groups, activeCategory }) {
  const categories = buildPaletteMenuCategories(palette, groups);
  const activeCategoryId = categories.some((category) => category.id === activeCategory)
    ? activeCategory
    : categories[0]?.id ?? DEFAULT_PALETTE_MENU_CATEGORY_ID;
  const selectedCategory = categories.find((category) => category.id === activeCategoryId);

  return {
    categories: categories.map((category) => ({
      id: category.id,
      label: category.label,
      count: category.items.length,
    })),
    activeCategoryId,
    items: selectedCategory?.items ?? [],
  };
}

function buildPaletteMenuCategoryRows(categories) {
  if (categories.length <= STACKED_CATEGORY_THRESHOLD) {
    return [categories];
  }

  const splitIndex = Math.ceil(categories.length / 2);

  return [categories.slice(0, splitIndex), categories.slice(splitIndex)].filter((row) => row.length > 0);
}

export function renderPalettePanel({ palette, groups }) {
  const builtins = palette
    .map(
      (item) => `
        <button
          class="ping-editor__panel-button ping-editor__palette-item"
          type="button"
          data-action="create-node"
          data-palette-type="${escapeHtml(item.type)}"
          data-testid="palette-${escapeHtml(item.type)}"
          aria-label="Create ${escapeHtml(item.label)} node"
        >
          <span class="ping-editor__palette-label">${escapeHtml(item.label)}</span>
          <span class="ping-editor__palette-meta">${escapeHtml(item.category)}</span>
        </button>
      `,
    )
    .join("");

  const userGroups = Object.values(groups ?? {})
    .map(
      (group) => `
        <button
          class="ping-editor__panel-button ping-editor__palette-item"
          type="button"
          data-action="create-group-node"
          data-group-ref="${escapeHtml(group.id)}"
          data-testid="palette-group-${escapeHtml(group.id)}"
          aria-label="Create group node ${escapeHtml(group.name ?? group.id)}"
        >
          <span class="ping-editor__palette-label">${escapeHtml(group.name ?? group.id)}</span>
          <span class="ping-editor__palette-meta">Group</span>
        </button>
      `,
    )
    .join("");

  return `
    <section class="ping-editor__panel-section">
      <div class="ping-editor__panel-list">${builtins || '<p class="ping-editor__empty">No palette items.</p>'}</div>
    </section>
    <section class="ping-editor__panel-section">
      <h2 class="ping-editor__panel-title">User Groups</h2>
      <div class="ping-editor__panel-list">${userGroups || '<p class="ping-editor__empty">No saved groups.</p>'}</div>
    </section>
  `;
}

export function renderPaletteMenu({ palette, groups, activeCategory, icons }) {
  const model = getPaletteMenuModel({ palette, groups, activeCategory });
  const categoryRows = buildPaletteMenuCategoryRows(model.categories);
  const categoryLayout = categoryRows.length > 1 ? "stacked" : "single";

  return `
    <div
      class="ping-editor__menu-categories"
      data-menu-category-layout="${categoryLayout}"
      aria-label="Node categories"
    >
      ${categoryRows
        .map(
          (row, rowIndex) => `
            <div
              class="ping-editor__menu-category-row"
              role="tablist"
              aria-label="Node categories${categoryRows.length > 1 ? ` row ${rowIndex + 1}` : ""}"
              data-menu-category-row="${rowIndex}"
              style="--ping-menu-category-columns:${row.length};"
            >
              ${row
                .map(
                  (category) => `
                    <button
                      class="ping-editor__menu-category ${model.activeCategoryId === category.id ? "is-active" : ""}"
                      type="button"
                      data-action="set-menu-category"
                      data-menu-category="${escapeHtml(category.id)}"
                      data-testid="palette-menu-category-${escapeHtml(category.id)}"
                      aria-pressed="${model.activeCategoryId === category.id ? "true" : "false"}"
                    >
                      ${escapeHtml(category.label)}
                    </button>
                  `,
                )
                .join("")}
            </div>
          `,
        )
        .join("")}
    </div>
    <div class="ping-editor__menu-list" data-testid="palette-menu-list">
      ${
        model.items.length > 0
          ? model.items
              .map((item) => {
                const extra =
                  item.action === "create-node"
                    ? `data-palette-type="${escapeHtml(item.type)}"`
                    : `data-group-ref="${escapeHtml(item.groupRef)}"`;

                return `
                  <button
                    class="ping-editor__menu-item"
                    type="button"
                    data-action="${item.action}"
                    ${extra}
                    data-testid="${escapeHtml(item.testId)}"
                    aria-label="Create ${escapeHtml(item.label)}"
                  >
                    ${createMenuIcon(item, icons)}
                    <span class="ping-editor__menu-item-label">${escapeHtml(item.label)}</span>
                  </button>
                `;
              })
              .join("")
          : '<p class="ping-editor__menu-empty">No nodes available in this category.</p>'
      }
    </div>
  `;
}
