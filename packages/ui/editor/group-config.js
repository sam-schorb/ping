import { isGroupBackedNodeType } from "@ping/core";

import { getResolvedNodeDefinition } from "./geometry.js";
import { buildGroupCandidates } from "./ops.js";
import { createDeterministicId, escapeHtml } from "./utils.js";

function buildGroupConnectionView(candidates) {
  if (!candidates.edges.length) {
    return '<p class="ping-editor__empty">No internal connections.</p>';
  }

  return `
    <ul class="ping-editor__mapping-list">
      ${candidates.edges
        .map(
          (edge) => `
            <li class="ping-editor__mapping-item">
              ${escapeHtml(edge.from.nodeId)}:${edge.from.portSlot + 1}
              <span class="ping-editor__mapping-arrow">→</span>
              ${escapeHtml(edge.to.nodeId)}:${edge.to.portSlot + 1}
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function createGroupMappingId(kind, entry) {
  if (kind === "controls") {
    return `control:${entry.nodeId}:slot:${entry.controlSlot}`;
  }

  return `${kind.slice(0, -1)}:${entry.nodeId}:${entry.portSlot}`;
}

function createGroupTargetPortKey(nodeId, targetPortSlot) {
  return `${nodeId}:${targetPortSlot}`;
}

function createGroupControlLabel(label, definition, controlSlot) {
  if (definition.hasParam && (definition.controlPorts ?? 0) === 1 && controlSlot === 0) {
    return `${label} param`;
  }

  return `${label} control ${controlSlot + 1}`;
}

function getGroupDraftNodeLabel(node, registry, groupLibrary) {
  const definition = registry.getNodeDefinition(node.type);
  const groupLabel =
    node.type === "group" && typeof node.groupRef === "string"
      ? groupLibrary?.[node.groupRef]?.name
      : undefined;

  return node.name || groupLabel || definition?.label || node.type;
}

function createFallbackGroupMappingEntry(kind, entry) {
  return {
    ...(entry.label !== undefined
      ? { label: entry.label }
      : kind === "controls"
        ? {
            label:
              entry.controlSlot !== undefined
                ? `${entry.nodeId} control ${entry.controlSlot + 1}`
                : `${entry.nodeId} control 1`,
          }
        : { label: `${entry.nodeId} ${kind.slice(0, -1)} ${(entry.portSlot ?? 0) + 1}` }),
    id: createGroupMappingId(kind, entry),
    nodeId: entry.nodeId,
    ...(kind === "controls"
      ? {
          controlSlot: entry.controlSlot ?? 0,
        }
      : { portSlot: entry.portSlot }),
  };
}

function buildGroupControlCandidateEntries(groupLibrary, node, definition, registry) {
  const label = getGroupDraftNodeLabel(node, registry, groupLibrary);

  if (isGroupBackedNodeType(node.type) && typeof node.groupRef === "string") {
    const childGroup = groupLibrary?.[node.groupRef];
    const signalInputs = definition.inputs ?? 0;

    return (childGroup?.controls ?? []).map((mapping, controlSlot) => ({
      id: createGroupMappingId("controls", { nodeId: node.id, controlSlot }),
      label: mapping.label ? `${label} ${mapping.label}` : `${label} control ${controlSlot + 1}`,
      nodeId: node.id,
      controlSlot,
      targetPortSlot: signalInputs + controlSlot,
    }));
  }

  if ((definition.controlPorts ?? 0) > 0) {
    return Array.from({ length: definition.controlPorts }, (_, controlSlot) => ({
      id: createGroupMappingId("controls", { nodeId: node.id, controlSlot }),
      label: createGroupControlLabel(label, definition, controlSlot),
      nodeId: node.id,
      controlSlot,
      targetPortSlot: (definition.inputs ?? 0) + controlSlot,
    }));
  }

  return [];
}

function classifyDraftControlCandidates(groupLibrary, snapshot, node, definition, registry, internalControlEdgeByKey) {
  const available = [];
  const unavailable = [];

  for (const entry of buildGroupControlCandidateEntries(groupLibrary, node, definition, registry)) {
    const blockingEdge = internalControlEdgeByKey.get(
      createGroupTargetPortKey(entry.nodeId, entry.targetPortSlot),
    );

    if (blockingEdge) {
      unavailable.push({
        ...entry,
        unavailableReason: "already driven internally",
        displaceInternalEdgeId: blockingEdge.id,
        restoreBucket: "unavailable",
      });
      continue;
    }

    available.push({
      ...entry,
      restoreBucket: "available",
    });
  }

  return {
    available,
    unavailable,
  };
}

function buildGroupDefinitionCandidates(group, registry, groupLibrary) {
  const graph = group?.graph ?? { nodes: [], edges: [] };
  const snapshot = {
    nodes: graph.nodes,
    edges: graph.edges,
    groups: groupLibrary,
  };
  const candidates = {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      from: { ...edge.from },
      to: { ...edge.to },
      manualCorners: (edge.manualCorners ?? []).map((point) => ({ ...point })),
    })),
    inputs: [],
    outputs: [],
    controls: [],
    unavailable: {
      controls: [],
    },
  };
  const internalControlEdgeByKey = new Map(
    graph.edges.map((edge) => [`${edge.to.nodeId}:${edge.to.portSlot}`, edge]),
  );

  for (const node of graph.nodes) {
    const definition = getResolvedNodeDefinition(snapshot, node, registry);

    if (!definition) {
      continue;
    }

    for (let portSlot = 0; portSlot < (definition.inputs ?? 0); portSlot += 1) {
      candidates.inputs.push({
        id: createGroupMappingId("inputs", { nodeId: node.id, portSlot }),
        label: `${getGroupDraftNodeLabel(node, registry, groupLibrary)} input ${portSlot + 1}`,
        nodeId: node.id,
        portSlot,
      });
    }

    for (let portSlot = 0; portSlot < (definition.outputs ?? 0); portSlot += 1) {
      candidates.outputs.push({
        id: createGroupMappingId("outputs", { nodeId: node.id, portSlot }),
        label: `${getGroupDraftNodeLabel(node, registry, groupLibrary)} output ${portSlot + 1}`,
        nodeId: node.id,
        portSlot,
      });
    }

    const controlCandidates = classifyDraftControlCandidates(
      groupLibrary,
      snapshot,
      node,
      definition,
      registry,
      internalControlEdgeByKey,
    );

    candidates.controls.push(...controlCandidates.available);
    candidates.unavailable.controls.push(...controlCandidates.unavailable);
  }

  return candidates;
}

function renderGroupMappingSection(kind, title, active, available, selectedId = "", unavailable = []) {
  return `
    <section class="ping-editor__group-section">
      <h3>${escapeHtml(title)}</h3>
      <ul class="ping-editor__mapping-list">
        ${
          active.length > 0
            ? active
                .map(
                  (entry, index) => `
                    <li class="ping-editor__mapping-item" data-testid="group-${kind}-${index}">
                      <span>${escapeHtml(entry.label ?? entry.id)}</span>
                      <div class="ping-editor__mapping-actions">
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-move"
                          data-group-kind="${kind}"
                          data-group-index="${index}"
                          data-group-direction="-1"
                          ${index === 0 ? "disabled" : ""}
                        >
                          ↑
                        </button>
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-move"
                          data-group-kind="${kind}"
                          data-group-index="${index}"
                          data-group-direction="1"
                          ${index === active.length - 1 ? "disabled" : ""}
                        >
                          ↓
                        </button>
                        <button
                          class="ping-editor__mini-button"
                          type="button"
                          data-action="group-remove-mapping"
                          data-group-kind="${kind}"
                          data-group-id="${escapeHtml(entry.id)}"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  `,
                )
                .join("")
            : '<li class="ping-editor__empty">No exposed entries.</li>'
        }
      </ul>
      ${
        available.length > 0
          ? `
            <label class="ping-editor__field">
              <span>Add</span>
              <select class="ping-editor__input" name="group-${kind}" data-action="group-restore-select" data-group-kind="${kind}">
                ${available
                  .map(
                    (entry) => `
                      <option value="${escapeHtml(entry.id)}" ${selectedId === entry.id ? "selected" : ""}>${escapeHtml(entry.label ?? entry.id)}</option>
                    `,
                  )
                  .join("")}
              </select>
            </label>
            <button class="ping-editor__panel-button" type="button" data-action="group-restore" data-group-kind="${kind}">
              Add ${escapeHtml(title.slice(0, -1))}
            </button>
          `
          : ""
      }
      ${
        unavailable.length > 0
          ? `
            <div class="ping-editor__group-unavailable">
              <h4 class="ping-editor__group-unavailable-title">Unavailable</h4>
              <ul class="ping-editor__mapping-list">
                ${unavailable
                  .map(
                    (entry, index) => `
                      <li class="ping-editor__mapping-item" data-testid="group-${kind}-unavailable-${index}">
                        <div class="ping-editor__mapping-copy">
                          <span>${escapeHtml(entry.label ?? entry.id)}</span>
                          <span class="ping-editor__mapping-note">${escapeHtml(entry.unavailableReason ?? "Unavailable")}</span>
                        </div>
                        <div class="ping-editor__mapping-actions">
                          <button
                            class="ping-editor__mini-button"
                            type="button"
                            data-action="group-expose-instead"
                            data-group-kind="${kind}"
                            data-group-id="${escapeHtml(entry.id)}"
                          >
                            Expose Instead…
                          </button>
                        </div>
                      </li>
                    `,
                  )
                  .join("")}
              </ul>
            </div>
          `
          : ""
      }
    </section>
  `;
}

export function renderGroupConfigPanel(groupDraft, { sidebarCollapsed = false } = {}) {
  if (!groupDraft?.open) {
    return "";
  }

  const isEdit = groupDraft.mode === "edit";

  return `
    <div
      class="ping-editor__group-dialog ${sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-open"}"
      data-testid="group-config"
    >
      <header class="ping-editor__group-header">
        <div>
          <h2>${isEdit ? "Edit Group" : "New Group"}</h2>
          <p class="ping-editor__group-subtitle">${
            isEdit ? `Group ${escapeHtml(groupDraft.groupId)}` : "Selected nodes"
          }: ${groupDraft.selectedNodeIds
            .map((nodeId) => escapeHtml(nodeId))
            .join(", ")}</p>
        </div>
        <button class="ping-editor__panel-button" type="button" data-action="close-group-config">Close</button>
      </header>
      <label class="ping-editor__field">
        <span>Name</span>
        <input
          class="ping-editor__input"
          type="text"
          name="group-name"
          value="${escapeHtml(groupDraft.name)}"
          data-action="group-name"
          data-testid="group-name"
        />
      </label>
      <label class="ping-editor__group-checkbox" data-testid="group-preserve-delays-field">
        <input
          class="ping-editor__group-checkbox-input"
          type="checkbox"
          name="group-preserve-delays"
          data-action="group-preserve-delays"
          data-testid="group-preserve-delays"
          ${groupDraft.preserveInternalCableDelays ? "checked" : ""}
        />
        <span class="ping-editor__group-checkbox-copy">
          <span class="ping-editor__group-checkbox-label">Preserve Internal Cable Delays</span>
          <span class="ping-editor__group-checkbox-note">
            When off, internal cables keep their saved shape but use the minimum possible delay.
          </span>
        </span>
      </label>
      <section class="ping-editor__group-section">
        <h3>Connection View</h3>
        ${buildGroupConnectionView(groupDraft.candidates)}
      </section>
      ${renderGroupMappingSection(
        "inputs",
        "Signal Inputs",
        groupDraft.mappings.inputs,
        groupDraft.available.inputs,
        groupDraft.restoreSelection.inputs,
        groupDraft.unavailable.inputs ?? [],
      )}
      ${renderGroupMappingSection(
        "outputs",
        "Signal Outputs",
        groupDraft.mappings.outputs,
        groupDraft.available.outputs,
        groupDraft.restoreSelection.outputs,
        groupDraft.unavailable.outputs ?? [],
      )}
      ${renderGroupMappingSection(
        "controls",
        "Control Inputs",
        groupDraft.mappings.controls,
        groupDraft.available.controls,
        groupDraft.restoreSelection.controls,
        groupDraft.unavailable.controls ?? [],
      )}
      <div class="ping-editor__action-row">
        <button class="ping-editor__panel-button" type="button" data-action="close-group-config">
          Cancel
        </button>
        <button class="ping-editor__panel-button is-primary" type="button" data-action="commit-group" data-testid="group-confirm">
          ${isEdit ? "Save Changes" : "Save"}
        </button>
      </div>
    </div>
  `;
}

export function createGroupDraft(state) {
  const candidates = buildGroupCandidates(state.snapshot, state.groupSelection, state.registry);

  return {
    mode: "create",
    open: true,
    name: `Group ${createDeterministicId("group", state).replace("group-", "")}`,
    candidates,
    selectedNodeIds: [...state.groupSelection.nodeIds],
    mappings: {
      inputs: candidates.inputs.map((entry) => ({ ...entry })),
      outputs: candidates.outputs.map((entry) => ({ ...entry })),
      controls: candidates.controls.map((entry) => ({ ...entry })),
    },
    available: {
      inputs: [],
      outputs: [],
      controls: [],
    },
    unavailable: {
      inputs: candidates.unavailable?.inputs ?? [],
      outputs: candidates.unavailable?.outputs ?? [],
      controls: candidates.unavailable?.controls ?? [],
    },
    restoreSelection: {
      inputs: candidates.inputs[0]?.id ?? "",
      outputs: candidates.outputs[0]?.id ?? "",
      controls: candidates.controls[0]?.id ?? "",
    },
    preserveInternalCableDelays: false,
  };
}

export function createGroupEditDraft(state, group) {
  const candidates = buildGroupDefinitionCandidates(group, state.registry, state.snapshot.groups);
  const candidateMaps = {
    inputs: new Map(candidates.inputs.map((entry) => [entry.id, entry])),
    outputs: new Map(candidates.outputs.map((entry) => [entry.id, entry])),
    controls: new Map(candidates.controls.map((entry) => [entry.id, entry])),
  };
  const mappings = {
    inputs: group.inputs.map((entry) =>
      candidateMaps.inputs.get(createGroupMappingId("inputs", entry)) ??
      createFallbackGroupMappingEntry("inputs", entry),
    ),
    outputs: group.outputs.map((entry) =>
      candidateMaps.outputs.get(createGroupMappingId("outputs", entry)) ??
      createFallbackGroupMappingEntry("outputs", entry),
    ),
    controls: group.controls.map((entry) =>
      candidateMaps.controls.get(createGroupMappingId("controls", entry)) ??
      createFallbackGroupMappingEntry("controls", entry),
    ),
  };
  const activeIds = {
    inputs: new Set(mappings.inputs.map((entry) => entry.id)),
    outputs: new Set(mappings.outputs.map((entry) => entry.id)),
    controls: new Set(mappings.controls.map((entry) => entry.id)),
  };
  const available = {
    inputs: candidates.inputs.filter((entry) => !activeIds.inputs.has(entry.id)),
    outputs: candidates.outputs.filter((entry) => !activeIds.outputs.has(entry.id)),
    controls: candidates.controls.filter((entry) => !activeIds.controls.has(entry.id)),
  };
  const unavailable = {
    inputs: candidates.unavailable?.inputs ?? [],
    outputs: candidates.unavailable?.outputs ?? [],
    controls: (candidates.unavailable?.controls ?? []).filter(
      (entry) => !activeIds.controls.has(entry.id),
    ),
  };

  return {
    mode: "edit",
    open: true,
    groupId: group.id,
    name: group.name,
    candidates,
    selectedNodeIds: group.graph.nodes.map((node) => node.id),
    mappings,
    available,
    unavailable,
    restoreSelection: {
      inputs: available.inputs[0]?.id ?? "",
      outputs: available.outputs[0]?.id ?? "",
      controls: available.controls[0]?.id ?? "",
    },
    preserveInternalCableDelays: group.preserveInternalCableDelays === true,
  };
}
