import { isCodeNodeGroupId } from "@ping/core";

import { resolveIcon } from "../icons/library.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const DEFAULT_PALETTE_MENU_CATEGORY_ID = "basic";

const BASIC_MENU_TYPES = new Set(["pulse", "out", "mux", "every", "set"]);
const CATEGORY_ORDER = ["Sources", "Sinks", "Routing", "Math", "Modifiers", "State", "Logic"];
const STACKED_CATEGORY_THRESHOLD = 5;

function normalizeSearchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

function normalizeCategoryId(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "other";
}

function getCategoryDisplayLabel(category) {
  const normalized = String(category ?? "").trim().toLowerCase();

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

function createBuiltInMenuItem(item, order) {
  return {
    id: item.type,
    label: item.label,
    action: "create-node",
    type: item.type,
    category: item.category,
    icon: item.icon,
    color: item.color,
    order,
    searchTerms: [item.label, item.type].map((value) => normalizeSearchText(value)),
    testId: `palette-menu-${item.type}`,
  };
}

function createGroupMenuItem(group, order) {
  const label = group.name ?? group.id;

  return {
    id: group.id,
    label,
    action: "create-group-node",
    groupRef: group.id,
    category: "Groups",
    icon: "group",
    color: "#7f786d",
    order,
    searchTerms: [label, group.id].map((value) => normalizeSearchText(value)),
    testId: `palette-menu-group-${group.id}`,
  };
}

function buildPaletteMenuEntries(palette, groups) {
  const builtInItems = palette.map((item, index) => createBuiltInMenuItem(item, index));
  const groupItems = Object.values(groups ?? {})
    .filter((group) => !isCodeNodeGroupId(group?.id))
    .map((group, index) => createGroupMenuItem(group, builtInItems.length + index));

  return [...builtInItems, ...groupItems];
}

function buildPaletteMenuCategories(items) {
  const categories = [];
  const seenCategoryIds = new Set();
  const basicItems = items.filter((item) => item.action === "create-node" && BASIC_MENU_TYPES.has(item.type));

  if (basicItems.length > 0) {
    categories.push({
      id: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      label: DEFAULT_PALETTE_MENU_CATEGORY_ID,
      items: basicItems,
    });
    seenCategoryIds.add(DEFAULT_PALETTE_MENU_CATEGORY_ID);
  }

  for (const category of CATEGORY_ORDER) {
    const categoryItems = items.filter((item) => item.category === category);
    const categoryId = normalizeCategoryId(category);

    if (categoryItems.length === 0 || seenCategoryIds.has(categoryId)) {
      continue;
    }

    categories.push({
      id: categoryId,
      label: getCategoryDisplayLabel(category),
      items: categoryItems,
    });
    seenCategoryIds.add(categoryId);
  }

  const extraCategoryLabels = [
    ...new Set(
      items
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
      items: items.filter((item) => item.category === category),
    });
    seenCategoryIds.add(categoryId);
  }

  return categories;
}

function getSearchRank(item, query) {
  let bestRank = Number.POSITIVE_INFINITY;

  for (const term of item.searchTerms) {
    if (!term) {
      continue;
    }

    if (term === query) {
      bestRank = Math.min(bestRank, 0);
      continue;
    }

    if (term.startsWith(query)) {
      bestRank = Math.min(bestRank, 1);
      continue;
    }

    if (term.includes(query)) {
      bestRank = Math.min(bestRank, 2);
    }
  }

  return Number.isFinite(bestRank) ? bestRank : null;
}

export function getPaletteMenuModel({ palette, groups, activeCategory, query = "" }) {
  const items = buildPaletteMenuEntries(palette, groups);
  const categories = buildPaletteMenuCategories(items);
  const activeCategoryId = categories.some((category) => category.id === activeCategory)
    ? activeCategory
    : categories[0]?.id ?? DEFAULT_PALETTE_MENU_CATEGORY_ID;
  const selectedCategory = categories.find((category) => category.id === activeCategoryId);
  const normalizedQuery = normalizeSearchText(query);
  const isSearching = normalizedQuery !== "";
  const categorySummaries = categories.map((category) => ({
    id: category.id,
    label: category.label,
    count: category.items.length,
  }));

  if (isSearching) {
    const matchedItems = items
      .map((item) => ({
        item,
        rank: getSearchRank(item, normalizedQuery),
      }))
      .filter((entry) => entry.rank !== null)
      .sort((left, right) => left.rank - right.rank || left.item.order - right.item.order)
      .map(({ item }) => item);

    return {
      mode: "search",
      categories: categorySummaries,
      activeCategoryId,
      items: matchedItems,
      matchCount: matchedItems.length,
      query,
      showItemMeta: true,
      emptyMessage: `No nodes match "${query.trim()}".`,
    };
  }

  return {
    mode: "category",
    categories: categorySummaries,
    activeCategoryId,
    query,
    items: selectedCategory?.items ?? [],
    matchCount: selectedCategory?.items.length ?? 0,
    showItemMeta: false,
    emptyMessage: "No nodes available in this category.",
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

export function renderPaletteMenu({ palette, groups, activeCategory, query = "", icons }) {
  const model = getPaletteMenuModel({ palette, groups, activeCategory, query });
  const categoryRows = buildPaletteMenuCategoryRows(model.categories);
  const categoryLayout = categoryRows.length > 1 ? "stacked" : "single";

  return `
    <div class="ping-editor__menu-header" data-menu-mode="${model.mode}">
      <input
        class="ping-editor__menu-search-input"
        type="text"
        name="menu-query"
        value="${escapeHtml(query)}"
        placeholder="Search nodes"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-action="search-menu"
        data-testid="palette-menu-search"
        aria-label="Search nodes"
      />
      ${
        model.mode === "search"
          ? ""
          : `
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
          `
      }
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
                    <span class="ping-editor__menu-item-body">
                      <span class="ping-editor__menu-item-label">${escapeHtml(item.label)}</span>
                      ${
                        model.showItemMeta
                          ? `<span class="ping-editor__menu-item-meta">${escapeHtml(getCategoryDisplayLabel(item.category))}</span>`
                          : ""
                      }
                    </span>
                  </button>
                `;
              })
              .join("")
          : `<p class="ping-editor__menu-empty">${escapeHtml(model.emptyMessage)}</p>`
      }
    </div>
  `;
}
