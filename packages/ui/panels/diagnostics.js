function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isStaleIssue(issue, snapshot) {
  if (!issue.nodeId && !issue.edgeId) {
    return false;
  }

  if (issue.nodeId && !snapshot.nodes.some((node) => node.id === issue.nodeId)) {
    return true;
  }

  if (issue.edgeId && !snapshot.edges.some((edge) => edge.id === issue.edgeId)) {
    return true;
  }

  return false;
}

export function renderDiagnosticsPanel({ issues, snapshot }) {
  if (!issues.length) {
    return `
      <section class="ping-editor__panel-section">
        <p class="ping-editor__empty">No diagnostics.</p>
      </section>
    `;
  }

  return `
    <section class="ping-editor__panel-section">
      <ul class="ping-editor__diagnostics">
        ${issues
          .map((issue, index) => {
            const stale = isStaleIssue(issue, snapshot);
            return `
              <li
                class="ping-editor__diagnostic ${stale ? "is-stale" : ""}"
                data-action="focus-diagnostic"
                data-issue-index="${index}"
                data-testid="diagnostic-${index}"
              >
                <span class="ping-editor__diagnostic-code">${escapeHtml(issue.code)}</span>
                <span class="ping-editor__diagnostic-message">${escapeHtml(issue.message)}</span>
                ${stale ? '<span class="ping-editor__diagnostic-stale">stale</span>' : ""}
              </li>
            `;
          })
          .join("")}
      </ul>
    </section>
  `;
}
