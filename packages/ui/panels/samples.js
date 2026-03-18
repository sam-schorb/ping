function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isDataUrlPath(path) {
  return typeof path === "string" && path.startsWith("data:");
}

function getPathBasename(path) {
  const normalizedPath = String(path)
    .split(/[?#]/u, 1)[0]
    .replace(/[\\/]+$/u, "");

  if (!normalizedPath) {
    return "";
  }

  const segments = normalizedPath.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? normalizedPath;
}

function getSamplePresentation(slot, sampleFileLabels) {
  const path = typeof slot.path === "string" ? slot.path.trim() : "";
  const uploadedLabel = sampleFileLabels?.get?.(slot.id)?.trim();

  if (path === "") {
    return {
      actionLabel: "Add",
      isEmpty: true,
      title: "No sample loaded",
    };
  }

  if (isDataUrlPath(path)) {
    return {
      actionLabel: "Replace",
      isEmpty: false,
      title: uploadedLabel || "Imported audio sample",
    };
  }

  const fileName = getPathBasename(path) || path;

  return {
    actionLabel: "Replace",
    isEmpty: false,
    title: fileName,
  };
}

export function renderSamplesPanel({ slots, sampleFileLabels }) {
  return `
    <section class="ping-editor__panel-section">
      <div class="ping-editor__samples">
        ${slots
          .map((slot, index) => {
            const presentation = getSamplePresentation(slot, sampleFileLabels);

            return `
              <section class="ping-editor__sample-slot${presentation.isEmpty ? " is-empty" : ""}" data-testid="sample-slot-${index + 1}">
                <div class="ping-editor__sample-header">
                  <span class="ping-editor__sample-label">Slot ${index + 1}</span>
                  <button
                    class="ping-editor__panel-button ping-editor__sample-button"
                    type="button"
                    data-action="open-sample-picker"
                    data-slot-id="${escapeHtml(slot.id)}"
                    data-testid="sample-trigger-${index + 1}"
                  >
                    ${presentation.actionLabel}
                  </button>
                </div>
                <span class="ping-editor__sample-name" data-testid="sample-title-${index + 1}">${escapeHtml(presentation.title)}</span>
                <input
                  class="ping-editor__sample-file-input"
                  type="file"
                  accept="audio/*"
                  name="sample-file"
                  data-action="sample-file"
                  data-slot-id="${escapeHtml(slot.id)}"
                  data-testid="sample-input-${index + 1}"
                  aria-label="${presentation.isEmpty ? "Add" : "Replace"} sample slot ${index + 1}"
                  tabindex="-1"
                />
              </section>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}
