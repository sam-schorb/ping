import { isGroupBackedNodeType } from "./constants.js";

function cloneNodeRecord(node) {
  return {
    ...node,
    pos: { ...node.pos },
    params: { ...node.params },
  };
}

function cloneEdgeRecord(edge) {
  return {
    ...edge,
    from: { ...edge.from },
    to: { ...edge.to },
    manualCorners: edge.manualCorners.map((point) => ({ ...point })),
  };
}

function cloneGroupDefinition(group) {
  return {
    ...group,
    graph: {
      nodes: group.graph.nodes.map(cloneNodeRecord),
      edges: group.graph.edges.map(cloneEdgeRecord),
    },
    inputs: group.inputs.map((mapping) => ({ ...mapping })),
    outputs: group.outputs.map((mapping) => ({ ...mapping })),
    controls: group.controls.map((mapping) => ({ ...mapping })),
    ...(group.dsl ? { dsl: { ...group.dsl } } : {}),
  };
}

export function cloneGroupsRecord(groups) {
  if (!groups || typeof groups !== "object") {
    return undefined;
  }

  const clone = {};

  for (const [groupId, group] of Object.entries(groups)) {
    clone[groupId] = cloneGroupDefinition(group);
  }

  return Object.keys(clone).length > 0 ? clone : undefined;
}

export function isGroupReferenced(nodes, groupId) {
  return nodes.some((node) => node.groupRef === groupId);
}

export function getDirectGroupReferences(group) {
  const references = new Set();

  for (const node of group?.graph?.nodes ?? []) {
    if (
      isGroupBackedNodeType(node?.type) &&
      typeof node.groupRef === "string" &&
      node.groupRef.trim() !== ""
    ) {
      references.add(node.groupRef);
    }
  }

  return references;
}

export function analyzeGroupDependencies(groups) {
  const groupRecord = groups && typeof groups === "object" ? groups : {};
  const dependenciesByGroup = new Map(
    Object.entries(groupRecord).map(([groupId, group]) => [groupId, getDirectGroupReferences(group)]),
  );
  const order = [];
  const visited = new Set();
  const visiting = new Set();
  let cycle = null;

  function visit(groupId, path = []) {
    if (visited.has(groupId) || cycle) {
      return;
    }

    if (visiting.has(groupId)) {
      const cycleStart = path.indexOf(groupId);
      cycle = cycleStart >= 0 ? [...path.slice(cycleStart), groupId] : [groupId, groupId];
      return;
    }

    visiting.add(groupId);
    path.push(groupId);

    for (const dependencyId of dependenciesByGroup.get(groupId) ?? []) {
      if (!groupRecord[dependencyId]) {
        continue;
      }

      visit(dependencyId, path);

      if (cycle) {
        return;
      }
    }

    path.pop();
    visiting.delete(groupId);
    visited.add(groupId);
    order.push(groupId);
  }

  for (const groupId of Object.keys(groupRecord)) {
    visit(groupId, []);

    if (cycle) {
      return {
        ok: false,
        cycle,
        dependenciesByGroup,
      };
    }
  }

  return {
    ok: true,
    order,
    dependenciesByGroup,
  };
}

export function collectReferencedGroupClosure(groups, rootGroupIds) {
  const groupRecord = groups && typeof groups === "object" ? groups : {};
  const pending = [...new Set((Array.isArray(rootGroupIds) ? rootGroupIds : []).filter(Boolean))];
  const collected = new Set();

  while (pending.length > 0) {
    const groupId = pending.pop();

    if (collected.has(groupId) || !groupRecord[groupId]) {
      continue;
    }

    collected.add(groupId);

    for (const dependencyId of getDirectGroupReferences(groupRecord[groupId])) {
      if (!collected.has(dependencyId)) {
        pending.push(dependencyId);
      }
    }
  }

  if (collected.size === 0) {
    return undefined;
  }

  const dependencyAnalysis = analyzeGroupDependencies(groupRecord);
  const orderedIds = dependencyAnalysis.ok
    ? dependencyAnalysis.order.filter((groupId) => collected.has(groupId))
    : Array.from(collected);
  const closure = {};

  for (const groupId of orderedIds) {
    closure[groupId] = cloneGroupDefinition(groupRecord[groupId]);
  }

  return closure;
}

export function rewriteGroupReferences(groups, groupIdMap) {
  if (!groups || typeof groups !== "object") {
    return undefined;
  }

  const rewritten = {};

  for (const [groupId, group] of Object.entries(groups)) {
    const nextGroupId = groupIdMap.get(groupId) ?? groupId;
    rewritten[nextGroupId] = {
      ...cloneGroupDefinition(group),
      id: groupIdMap.get(group.id) ?? nextGroupId,
      graph: {
        nodes: group.graph.nodes.map((node) => ({
          ...cloneNodeRecord(node),
          ...(node.groupRef ? { groupRef: groupIdMap.get(node.groupRef) ?? node.groupRef } : {}),
        })),
        edges: group.graph.edges.map(cloneEdgeRecord),
      },
    };
  }

  return Object.keys(rewritten).length > 0 ? rewritten : undefined;
}
