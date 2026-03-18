function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderGroupsPanel({ groups, snapshot }) {
  const groupItems = Object.values(groups ?? {})
    .map((group) => {
      const inUse = snapshot.nodes.some((node) => node.type === "group" && node.groupRef === group.id);
      return `
        <div class="ping-editor__group-item" data-testid="group-library-${escapeHtml(group.id)}">
          <div>
            <div class="ping-editor__group-name">${escapeHtml(group.name ?? group.id)}</div>
            <div class="ping-editor__group-meta">
              ${escapeHtml(group.id)}${inUse ? " · in use" : ""}
            </div>
          </div>
          <div class="ping-editor__mapping-actions">
            <button
              class="ping-editor__panel-button"
              type="button"
              data-action="edit-group"
              data-group-id="${escapeHtml(group.id)}"
            >
              Edit
            </button>
            ${
              inUse
                ? ""
                : `
                  <button
                    class="ping-editor__panel-button"
                    type="button"
                    data-action="remove-group"
                    data-group-id="${escapeHtml(group.id)}"
                  >
                    Remove
                  </button>
                `
            }
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <section class="ping-editor__panel-section">
      ${groupItems || '<p class="ping-editor__empty">No groups saved yet.</p>'}
    </section>
  `;
}
