import { getLayout } from "./archetypes.js";

export function getGroupPortCounts(groupDefinition) {
  return {
    inputs: Array.isArray(groupDefinition?.inputs) ? groupDefinition.inputs.length : 0,
    outputs: Array.isArray(groupDefinition?.outputs)
      ? groupDefinition.outputs.length
      : 0,
    controlPorts: Array.isArray(groupDefinition?.controls)
      ? groupDefinition.controls.length
      : 0,
  };
}

export function getGroupLayout(groupDefinition) {
  const counts = getGroupPortCounts(groupDefinition);

  return getLayout("custom", counts.inputs, counts.outputs, counts.controlPorts);
}

export function createGroupedNodeDefinition(groupDefinition, baseDefinition = {}) {
  const counts = getGroupPortCounts(groupDefinition);

  return {
    ...baseDefinition,
    type: "group",
    label: groupDefinition?.name ?? baseDefinition.label ?? "Group",
    description:
      baseDefinition.description ??
      "A project-defined group node with a custom derived layout.",
    layout: "custom",
    inputs: counts.inputs,
    outputs: counts.outputs,
    controlPorts: counts.controlPorts,
  };
}
