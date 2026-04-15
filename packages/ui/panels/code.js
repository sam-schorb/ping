function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CODE_GUIDE_SECTIONS = Object.freeze([
  {
    id: "overview",
    label: "overview",
    title: "Start",
    paragraphs: [
      "Ping DSL is a compact text format for describing the inside of a group-like node.",
      "Read it left to right: bring signals in with $n, build a patch with node calls, then expose the result with .out() or .outlet(n).",
    ],
    examples: [
      {
        label: "Simple chain",
        code: "$0.every(2).count(4).outlet(0)",
      },
    ],
  },
  {
    id: "inputs",
    label: "inputs",
    title: "Inputs",
    paragraphs: [
      "Boundary inputs use $n. Signal inlets start at $0 and must be contiguous. Control inlets come after the final signal inlet.",
    ],
    bullets: [
      "Control inputs follow the last signal input without gaps.",
      "The same inlet index cannot be used as both signal and control.",
    ],
    examples: [
      {
        label: "One signal inlet and one control inlet",
        code: ["sw = $0.switch(2){$1}", "sw[0].outlet(0)"].join("\n"),
      },
    ],
  },
  {
    id: "calls",
    label: "calls",
    title: "Calls",
    paragraphs: [
      "Node calls come in four forms: node(), node(param), node{control}, and node(param){control}.",
      "Params are integers in 1..8. If a node has no param and no control clause, you still need ().",
    ],
    examples: [
      {
        label: "Common call forms",
        code: ["pulse(3)", "block{$1}", "mux()", "demux()"].join("\n"),
      },
    ],
  },
  {
    id: "chains",
    label: "chains",
    title: "Chains",
    paragraphs: [
      "Single-stream nodes chain with a dot. The output of one node becomes the signal input of the next node.",
      "Control inputs go in braces on the node they modulate.",
    ],
    examples: [
      {
        label: "Chain with control",
        code: "pulse(3).every(2){$0}.out()",
      },
    ],
  },
  {
    id: "bindings",
    label: "bindings",
    title: "Bindings",
    paragraphs: [
      "Bindings name a node result so you can reuse it later, index its outputs, or build a cycle.",
    ],
    examples: [
      {
        label: "Reuse and feedback",
        code: ["a = $0.every(3){b}", "b = a.count(4)", "b.outlet(0)"].join("\n"),
      },
    ],
  },
  {
    id: "mux",
    label: "mux",
    title: "Mux",
    paragraphs: [
      "mux() takes one input and gives you six indexed outputs. Use [n] to choose which output you want.",
    ],
    examples: [
      {
        label: "Mux outputs",
        code: ["m = $0.mux()", "m[0].outlet(0)", "m[1].outlet(1)"].join("\n"),
      },
    ],
  },
  {
    id: "demux",
    label: "demux",
    title: "Demux",
    paragraphs: [
      "demux() takes up to six indexed inputs and produces one output. Feed each input with a standalone wire statement.",
    ],
    examples: [
      {
        label: "Demux inputs",
        code: ["d = demux()", "$0.d[0]", "$1.d[1]", "d.outlet(0)"].join("\n"),
      },
    ],
  },
  {
    id: "outputs",
    label: "outputs",
    title: "Outputs",
    paragraphs: [
      "Use .out() to terminate in a real internal out node. Use .outlet(n) to expose a group output.",
      "Outlet indices are 0-based, contiguous, and cannot repeat.",
    ],
    examples: [
      {
        label: "Sink and outlet",
        code: ["$0.every(2).out()", "$0.every(2).outlet(0)"].join("\n"),
      },
    ],
  },
]);

function renderCodeGuideTag(section) {
  return `
    <button
      class="ping-editor__code-tag"
      type="button"
      data-action="jump-docs-category"
      data-docs-category="${escapeHtml(section.id)}"
      data-testid="code-tag-${escapeHtml(section.id)}"
    >
      ${escapeHtml(section.label)}
    </button>
  `;
}

function renderCodeGuideExample(example, index) {
  return `
    <div class="ping-editor__code-example" data-testid="code-example-${index}">
      <div class="ping-editor__code-example-label">${escapeHtml(example.label)}</div>
      <pre class="ping-editor__code-block"><code>${escapeHtml(example.code)}</code></pre>
    </div>
  `;
}

function renderCodeGuideSection(section) {
  return `
    <section
      class="ping-editor__code-section"
      data-docs-category-id="${escapeHtml(section.id)}"
      data-testid="code-section-${escapeHtml(section.id)}"
    >
      <h2 class="ping-editor__code-section-title">${escapeHtml(section.title)}</h2>
      <div class="ping-editor__code-copy">
        ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
        ${
          Array.isArray(section.bullets) && section.bullets.length > 0
            ? `
              <ul class="ping-editor__code-list">
                ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
              </ul>
            `
            : ""
        }
      </div>
      <div class="ping-editor__code-examples">
        ${section.examples.map((example, index) => renderCodeGuideExample(example, `${section.id}-${index}`)).join("")}
      </div>
    </section>
  `;
}

export function renderCodePanel() {
  return `
    <section class="ping-editor__panel-section ping-editor__code-panel" data-testid="code-panel">
      <div class="ping-editor__code-tags" data-testid="code-tag-bank">
        <button
          class="ping-editor__code-tag is-all"
          type="button"
          data-action="jump-docs-category"
          data-docs-category="all"
          data-testid="code-tag-all"
        >
          all
        </button>
        ${CODE_GUIDE_SECTIONS.map((section) => renderCodeGuideTag(section)).join("")}
      </div>
      <div class="ping-editor__code-sections">
        ${CODE_GUIDE_SECTIONS.map((section) => renderCodeGuideSection(section)).join("")}
      </div>
    </section>
  `;
}
