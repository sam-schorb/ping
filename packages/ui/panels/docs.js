import { resolveNodeTheme } from "../theme/node-theme.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeCategoryId(label) {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "") || "other";
}

function formatCategoryLabel(category) {
  return String(category ?? "").trim().toLowerCase();
}

function sortPaletteItems(items) {
  return [...items].sort((left, right) => left.label.localeCompare(right.label) || left.type.localeCompare(right.type));
}

function buildDocsCategories(palette) {
  const byCategory = new Map();
  const codeItems = [];

  for (const item of palette ?? []) {
    if (item?.type === "group") {
      continue;
    }

    if (item?.type === "code") {
      codeItems.push(item);
      continue;
    }

    const category = typeof item.category === "string" && item.category.trim() !== "" ? item.category : "Other";

    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }

    byCategory.get(category).push(item);
  }

  const categories = [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      categoryId: normalizeCategoryId(category),
      label: formatCategoryLabel(category),
      themeCategory: category,
      items: sortPaletteItems(items),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));

  if (codeItems.length > 0) {
    categories.push({
      category: "Code",
      categoryId: "code",
      label: "code",
      themeCategory: "Groups",
      items: sortPaletteItems(codeItems),
    });
  }

  return categories;
}

function getCategoryTagStyle(category, config) {
  const theme = resolveNodeTheme({
    category,
    color: null,
    config,
  });

  return `background:${escapeHtml(theme.menuChip)}; color:${escapeHtml(theme.icon)}; border-color:${escapeHtml(
    theme.menuChip,
  )};`;
}

function getControlPortDescription(item) {
  switch (item.type) {
    case "pulse":
      return "Sets the pulse rate.";
    case "switch":
      return "Sets which output receives the pulse.";
    case "block":
      return "Sets the gate parity; odd passes pulses and even blocks them.";
    case "add":
      return "Sets the amount added to each pulse value.";
    case "sub":
      return "Sets the amount subtracted from each pulse value.";
    case "set":
      return "Sets the replacement output value.";
    case "speed":
      return "Sets the pulse speed.";
    case "pitch":
      return "Sets the pitch amount written to pulse params.";
    case "decay":
      return "Sets the decay amount written to pulse params.";
    case "crush":
      return "Sets the bit-crush amount written to pulse params.";
    case "hpf":
      return "Sets the high-pass cutoff written to pulse params.";
    case "lpf":
      return "Sets the low-pass cutoff written to pulse params.";
    case "every":
      return "Sets N, so only every Nth pulse passes.";
    case "drop":
      return "Sets N, so every (N + 1)th pulse is dropped.";
    case "random":
      return "Sets the maximum random output value.";
    case "count":
      return "Sets the wrap limit.";
    case "step":
      return "Sets the stride amount added on each pulse.";
    case "gtp":
    case "ltp":
    case "gtep":
    case "ltep":
    case "match":
      return "Sets the comparison threshold.";
    case "code":
      return "Defined by the code inside the node.";
    default:
      if ((item.controlPorts ?? 0) <= 0) {
        return "None.";
      }

      if (item.hasParam) {
        return "Sets the node parameter.";
      }

      return "Consumes control pulses.";
  }
}

function renderDocsTag(
  categoryId,
  label,
  config,
  { testId = null, compact = false, themeCategory = categoryId } = {},
) {
  return `
    <button
      class="ping-editor__docs-tag ${compact ? "is-compact" : ""}"
      type="button"
      data-action="jump-docs-category"
      data-docs-category="${escapeHtml(categoryId)}"
      style="${getCategoryTagStyle(themeCategory, config)}"
      ${testId ? `data-testid="${escapeHtml(testId)}"` : ""}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderAllDocsTag() {
  return `
    <button
      class="ping-editor__docs-tag is-all"
      type="button"
      data-action="jump-docs-category"
      data-docs-category="all"
      data-testid="docs-tag-all"
    >
      all
    </button>
  `;
}

export function renderDocsPanel({ palette, config }) {
  const categories = buildDocsCategories(palette);

  return `
    <section class="ping-editor__panel-section ping-editor__docs-panel" data-testid="docs-panel">
      <div class="ping-editor__docs-tags" data-testid="docs-tag-bank">
        ${renderAllDocsTag()}
        ${categories
          .map((entry) =>
            renderDocsTag(entry.categoryId, entry.label, config, {
              themeCategory: entry.themeCategory,
              testId: `docs-tag-${entry.categoryId}`,
            }),
          )
          .join("")}
      </div>
      <div class="ping-editor__docs-sections">
        ${categories
          .map(
            (entry) => `
              <section
                class="ping-editor__docs-section"
                data-docs-category-id="${escapeHtml(entry.categoryId)}"
                data-testid="docs-section-${escapeHtml(entry.categoryId)}"
              >
                <h2 class="ping-editor__docs-section-title">${escapeHtml(entry.label)}</h2>
                <div class="ping-editor__docs-list">
                  ${entry.items
                    .map(
                      (item) => `
                        <article class="ping-editor__docs-entry" data-testid="docs-entry-${escapeHtml(item.type)}">
                          <div class="ping-editor__docs-entry-header">
                            <h3 class="ping-editor__docs-entry-title">${escapeHtml(item.label)}</h3>
                            ${renderDocsTag(entry.categoryId, entry.label, config, {
                              compact: true,
                              themeCategory: entry.themeCategory,
                            })}
                          </div>
                          <p class="ping-editor__docs-entry-copy">${escapeHtml(item.description)}</p>
                          <p class="ping-editor__docs-entry-copy">
                            <strong>Ctrl:</strong> ${escapeHtml(getControlPortDescription(item))}
                          </p>
                        </article>
                      `,
                    )
                    .join("")}
                </div>
              </section>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}
