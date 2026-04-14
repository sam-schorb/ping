import { getNodeRoutingBounds } from "../routing/anchors.js";
import { routeEdge } from "../routing/route-edge.js";
import {
  DSL_ERROR_CODES,
  createDslIssue,
} from "./errors.js";

const COLUMN_SPACING = 8;
const SCC_MEMBER_SPACING = 4;
const ROW_SPACING = 12;
const LANE_STEP = 2;
const CHANNEL_MARGIN = 4;
const MAX_CHANNEL_SEARCH = 96;

function ensureRegistryAccess(registry) {
  if (
    typeof registry?.getNodeDefinition !== "function" ||
    typeof registry?.getLayout !== "function"
  ) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LAYOUT_INVALID_REGISTRY,
        "DSL layout requires registry.getNodeDefinition() and registry.getLayout().",
      ),
    };
  }

  return {
    registry,
  };
}

function countPortsBySide(layout) {
  const counts = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };

  for (const port of [...layout.inputs, ...layout.outputs]) {
    counts[port.side] += 1;
  }

  return counts;
}

function getNodeSize(definition, registry) {
  const layout = registry.getLayout(
    definition.layout,
    definition.inputs,
    definition.outputs,
    definition.controlPorts,
  );
  const sideCounts = countPortsBySide(layout);

  return Math.max(1, ...Object.values(sideCounts)) + 1;
}

function buildNodeMeta(ir, registry) {
  const metas = new Map();

  for (let order = 0; order < ir.nodes.length; order += 1) {
    const node = ir.nodes[order];
    const definition = registry.getNodeDefinition(node.type);

    if (!definition) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LAYOUT_INTERNAL,
          `DSL layout cannot resolve node type "${node.type}".`,
          {
            nodeId: node.irNodeId,
          },
        ),
      };
    }

    metas.set(node.irNodeId, {
      node,
      order,
      definition,
      size: getNodeSize(definition, registry),
    });
  }

  return {
    nodeMetaById: metas,
  };
}

function computeStronglyConnectedComponents(nodeIds, signalEdges) {
  const outgoingByNode = new Map(nodeIds.map((nodeId) => [nodeId, []]));

  for (const edge of signalEdges) {
    outgoingByNode.get(edge.from.irNodeId)?.push(edge.to.irNodeId);
  }

  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const stack = [];
  const onStack = new Set();
  const componentIdByNode = new Map();
  const membersByComponent = new Map();
  let index = 0;
  let componentId = 0;

  function visit(nodeId) {
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetNodeId of outgoingByNode.get(nodeId) ?? []) {
      if (!indexByNode.has(targetNodeId)) {
        visit(targetNodeId);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId), lowLinkByNode.get(targetNodeId)),
        );
      } else if (onStack.has(targetNodeId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId), indexByNode.get(targetNodeId)),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) {
      return;
    }

    const members = [];

    while (stack.length > 0) {
      const memberNodeId = stack.pop();
      onStack.delete(memberNodeId);
      componentIdByNode.set(memberNodeId, componentId);
      members.push(memberNodeId);

      if (memberNodeId === nodeId) {
        break;
      }
    }

    membersByComponent.set(componentId, members);
    componentId += 1;
  }

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      visit(nodeId);
    }
  }

  return {
    componentIdByNode,
    membersByComponent,
    outgoingByNode,
  };
}

function computeSignalComponents(nodeIds, signalEdges) {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, new Set()]));

  for (const edge of signalEdges) {
    adjacency.get(edge.from.irNodeId)?.add(edge.to.irNodeId);
    adjacency.get(edge.to.irNodeId)?.add(edge.from.irNodeId);
  }

  const componentIdByNode = new Map();
  const membersByComponent = new Map();
  let componentId = 0;

  for (const nodeId of nodeIds) {
    if (componentIdByNode.has(nodeId)) {
      continue;
    }

    const stack = [nodeId];
    const members = [];
    componentIdByNode.set(nodeId, componentId);

    while (stack.length > 0) {
      const current = stack.pop();
      members.push(current);

      for (const neighbor of adjacency.get(current) ?? []) {
        if (componentIdByNode.has(neighbor)) {
          continue;
        }

        componentIdByNode.set(neighbor, componentId);
        stack.push(neighbor);
      }
    }

    membersByComponent.set(componentId, members);
    componentId += 1;
  }

  return {
    componentIdByNode,
    membersByComponent,
  };
}

function centeredOffset(slot, count) {
  return slot * 2 - (count - 1);
}

function computeLaneOffsets(ir, nodeMetaById) {
  const suggestionsByNode = new Map(ir.nodes.map((node) => [node.irNodeId, []]));

  for (const edge of ir.signalEdges) {
    const sourceMeta = nodeMetaById.get(edge.from.irNodeId);
    const targetMeta = nodeMetaById.get(edge.to.irNodeId);

    if (sourceMeta && sourceMeta.definition.outputs > 1) {
      suggestionsByNode
        .get(edge.to.irNodeId)
        ?.push(centeredOffset(edge.from.outputSlot, sourceMeta.definition.outputs));
    }

    if (targetMeta && targetMeta.definition.inputs > 1) {
      suggestionsByNode
        .get(edge.from.irNodeId)
        ?.push(centeredOffset(edge.to.signalSlot, targetMeta.definition.inputs));
    }
  }

  const laneOffsetByNode = new Map();

  for (const node of ir.nodes) {
    const suggestions = suggestionsByNode.get(node.irNodeId) ?? [];

    if (suggestions.length === 0) {
      laneOffsetByNode.set(node.irNodeId, 0);
      continue;
    }

    const average =
      suggestions.reduce((sum, value) => sum + value, 0) / suggestions.length;
    laneOffsetByNode.set(node.irNodeId, Math.round(average));
  }

  return laneOffsetByNode;
}

function computeComponentDepths(ir, scc, boundarySignalNodes) {
  const componentIds = Array.from(scc.membersByComponent.keys());
  const outgoing = new Map(componentIds.map((id) => [id, new Set()]));
  const incomingCount = new Map(componentIds.map((id) => [id, 0]));

  for (const edge of ir.signalEdges) {
    const fromComponent = scc.componentIdByNode.get(edge.from.irNodeId);
    const toComponent = scc.componentIdByNode.get(edge.to.irNodeId);

    if (fromComponent === toComponent) {
      continue;
    }

    if (!outgoing.get(fromComponent).has(toComponent)) {
      outgoing.get(fromComponent).add(toComponent);
      incomingCount.set(toComponent, (incomingCount.get(toComponent) ?? 0) + 1);
    }
  }

  const depthByComponent = new Map(componentIds.map((id) => [id, 0]));
  const queue = componentIds.filter((id) => (incomingCount.get(id) ?? 0) === 0);

  while (queue.length > 0) {
    const componentId = queue.shift();
    const currentDepth = depthByComponent.get(componentId) ?? 0;

    for (const targetId of outgoing.get(componentId) ?? []) {
      depthByComponent.set(
        targetId,
        Math.max(depthByComponent.get(targetId) ?? 0, currentDepth + 1),
      );
      incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) - 1);

      if ((incomingCount.get(targetId) ?? 0) === 0) {
        queue.push(targetId);
      }
    }
  }

  for (const nodeId of boundarySignalNodes) {
    const componentId = scc.componentIdByNode.get(nodeId);
    depthByComponent.set(componentId, Math.max(depthByComponent.get(componentId) ?? 0, 0));
  }

  return depthByComponent;
}

function orderSignalComponents(ir, signalComponents, nodeMetaById) {
  const ordered = [];

  for (const [componentId, members] of signalComponents.membersByComponent.entries()) {
    const outletIndices = ir.boundaryOutputs
      .filter((outlet) => outlet.source.kind === "node-output" && members.includes(outlet.source.irNodeId))
      .map((outlet) => outlet.outletIndex)
      .sort((left, right) => left - right);
    const inletIndices = ir.boundaryInputs
      .filter(
        (inlet) =>
          inlet.kind === "signal" &&
          members.includes(inlet.target.irNodeId),
      )
      .map((inlet) => inlet.inletIndex)
      .sort((left, right) => left - right);
    const minOrder = Math.min(...members.map((nodeId) => nodeMetaById.get(nodeId).order));

    ordered.push({
      componentId,
      members,
      outletRank: outletIndices[0] ?? Number.POSITIVE_INFINITY,
      inletRank: inletIndices[0] ?? Number.POSITIVE_INFINITY,
      minOrder,
    });
  }

  ordered.sort((left, right) => {
    if (left.outletRank !== right.outletRank) {
      return left.outletRank - right.outletRank;
    }

    if (left.inletRank !== right.inletRank) {
      return left.inletRank - right.inletRank;
    }

    return left.minOrder - right.minOrder;
  });

  return ordered;
}

function assignNodePositions(ir, registry) {
  const nodeMetaResult = buildNodeMeta(ir, registry);

  if (nodeMetaResult.issue) {
    return nodeMetaResult;
  }

  const nodeMetaById = nodeMetaResult.nodeMetaById;
  const nodeIds = ir.nodes.map((node) => node.irNodeId);
  const signalComponents = computeSignalComponents(nodeIds, ir.signalEdges);
  const scc = computeStronglyConnectedComponents(nodeIds, ir.signalEdges);
  const boundarySignalNodes = ir.boundaryInputs
    .filter((inlet) => inlet.kind === "signal")
    .map((inlet) => inlet.target.irNodeId);
  const depthByScc = computeComponentDepths(ir, scc, boundarySignalNodes);
  const laneOffsetByNode = computeLaneOffsets(ir, nodeMetaById);
  const orderedSignalComponents = orderSignalComponents(ir, signalComponents, nodeMetaById);
  const signalRowByComponent = new Map();

  orderedSignalComponents.forEach((entry, index) => {
    signalRowByComponent.set(entry.componentId, index * ROW_SPACING);
  });

  const membersBySccOrdered = new Map(
    Array.from(scc.membersByComponent.entries(), ([componentId, members]) => [
      componentId,
      [...members].sort(
        (left, right) => nodeMetaById.get(left).order - nodeMetaById.get(right).order,
      ),
    ]),
  );
  const positionsByNode = new Map();
  const occupied = new Set();

  for (const node of ir.nodes) {
    const nodeId = node.irNodeId;
    const signalComponentId = signalComponents.componentIdByNode.get(nodeId);
    const sccId = scc.componentIdByNode.get(nodeId);
    const sccMembers = membersBySccOrdered.get(sccId) ?? [nodeId];
    const localIndex = sccMembers.indexOf(nodeId);
    const depth = depthByScc.get(sccId) ?? 0;
    const baseX = depth * COLUMN_SPACING + localIndex * SCC_MEMBER_SPACING;
    const baseY =
      (signalRowByComponent.get(signalComponentId) ?? 0) +
      (laneOffsetByNode.get(nodeId) ?? 0) * LANE_STEP;
    let x = baseX;
    let y = baseY;

    while (occupied.has(`${x}:${y}`)) {
      y += LANE_STEP;
    }

    occupied.add(`${x}:${y}`);
    positionsByNode.set(nodeId, { x, y });
  }

  return {
    nodeMetaById,
    positionsByNode,
  };
}

function cloneGroup(group) {
  return {
    ...group,
    graph: {
      nodes: group.graph.nodes.map((node) => ({
        ...node,
        pos: { ...node.pos },
        params: { ...node.params },
      })),
      edges: group.graph.edges.map((edge) => ({
        ...edge,
        from: { ...edge.from },
        to: { ...edge.to },
        manualCorners: edge.manualCorners.map((point) => ({ ...point })),
      })),
    },
  };
}

function buildBounds(snapshot, registry) {
  const graph = snapshot.graph ?? snapshot;
  const bounds = graph.nodes.map((node) =>
    getNodeRoutingBounds(node, graph, registry, "__dsl_layout__"),
  );

  return {
    minX: Math.min(...bounds.map((entry) => entry.x0)),
    maxX: Math.max(...bounds.map((entry) => entry.x1)),
    minY: Math.min(...bounds.map((entry) => entry.y0)),
    maxY: Math.max(...bounds.map((entry) => entry.y1)),
  };
}

function routeSnapshotEdge(snapshot, edgeId, registry) {
  try {
    return {
      route: routeEdge(edgeId, snapshot.graph ?? snapshot, registry),
    };
  } catch (error) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LAYOUT_ROUTE_FAIL,
        error?.message ?? `Edge "${edgeId}" could not be routed during DSL layout.`,
        {
          edgeId,
        },
      ),
    };
  }
}

function stepToward(start, end) {
  if (!start || !end) {
    return start ? { ...start } : end ? { ...end } : { x: 0, y: 0 };
  }

  if (start.x === end.x && start.y === end.y) {
    return { ...start };
  }

  return {
    x: start.x + Math.sign(end.x - start.x),
    y: start.y + Math.sign(end.y - start.y),
  };
}

function createChannelCandidates(snapshot, registry, route, offset) {
  const bounds = buildBounds(snapshot, registry);
  const startStub = stepToward(route.points[0], route.points[1] ?? route.points[0]);
  const endStub = stepToward(route.points.at(-1), route.points.at(-2) ?? route.points.at(-1));
  const topY = bounds.minY - CHANNEL_MARGIN - offset;
  const bottomY = bounds.maxY + CHANNEL_MARGIN + offset;
  const leftX = bounds.minX - CHANNEL_MARGIN - offset;
  const rightX = bounds.maxX + CHANNEL_MARGIN + offset;

  return [
    [
      { x: startStub.x, y: topY },
      { x: endStub.x, y: topY },
    ],
    [
      { x: startStub.x, y: bottomY },
      { x: endStub.x, y: bottomY },
    ],
    [
      { x: leftX, y: startStub.y },
      { x: leftX, y: endStub.y },
    ],
    [
      { x: rightX, y: startStub.y },
      { x: rightX, y: endStub.y },
    ],
  ];
}

function assignEdgeManualCorners(snapshot, edgeId, corners) {
  const cloned = cloneGroup(snapshot);
  const edge = cloned.graph.edges.find((entry) => entry.id === edgeId);
  edge.manualCorners = corners.map((point) => ({ ...point }));
  return cloned;
}

function satisfyDistanceConstraint(group, edge, registry, desiredLength) {
  const baseRoute = routeSnapshotEdge(group, edge.id, registry);

  if (baseRoute.issue) {
    return baseRoute;
  }

  if (baseRoute.route.totalLength > desiredLength) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LAYOUT_INFEASIBLE_DISTANCE,
        `Edge "${edge.id}" cannot satisfy requested distance <${desiredLength}> because the minimum feasible orthogonal route is ${baseRoute.route.totalLength}.`,
        {
          edgeId: edge.id,
        },
      ),
    };
  }

  if (baseRoute.route.totalLength === desiredLength) {
    return {
      manualCorners: [],
    };
  }

  for (let offset = 0; offset <= MAX_CHANNEL_SEARCH; offset += 1) {
    const candidates = createChannelCandidates(group, registry, baseRoute.route, offset);

    for (const candidate of candidates) {
      const candidateSnapshot = assignEdgeManualCorners(group, edge.id, candidate);
      const candidateRoute = routeSnapshotEdge(candidateSnapshot, edge.id, registry);

      if (candidateRoute.issue) {
        continue;
      }

      if (candidateRoute.route.totalLength === desiredLength) {
        return {
          manualCorners: candidate,
        };
      }
    }
  }

  return {
    issue: createDslIssue(
      DSL_ERROR_CODES.LAYOUT_INFEASIBLE_DISTANCE,
      `Edge "${edge.id}" cannot satisfy requested distance <${desiredLength}> with the current deterministic layout.`,
      {
        edgeId: edge.id,
      },
    ),
  };
}

export function layoutFreshDslGroup(group, ir, registry, options = {}) {
  const registryAccess = ensureRegistryAccess(registry);

  if (registryAccess.issue) {
    return {
      ok: false,
      errors: [registryAccess.issue],
    };
  }

  const placement = assignNodePositions(ir, registry);

  if (placement.issue) {
    return {
      ok: false,
      errors: [placement.issue],
    };
  }

  const laidOutGroup = cloneGroup(group);

  for (const node of laidOutGroup.graph.nodes) {
    const pos = placement.positionsByNode.get(node.id);

    node.pos = { ...pos };
    node.rot = 0;
  }

  const distancesByEdgeId = new Map(
    [...ir.signalEdges, ...ir.controlEdges]
      .filter((edge) => typeof edge.distance === "number" && edge.distance > 0)
      .map((edge) => [edge.id, edge.distance]),
  );

  for (const edge of laidOutGroup.graph.edges) {
    edge.manualCorners = [];
  }

  for (const edge of laidOutGroup.graph.edges) {
    const desiredLength = distancesByEdgeId.get(edge.id);

    if (desiredLength === undefined) {
      continue;
    }

    const constrained = satisfyDistanceConstraint(laidOutGroup, edge, registry, desiredLength);

    if (constrained.issue) {
      return {
        ok: false,
        errors: [constrained.issue],
      };
    }

    edge.manualCorners = constrained.manualCorners;
  }

  for (const edge of laidOutGroup.graph.edges) {
    const routed = routeSnapshotEdge(laidOutGroup, edge.id, registry);

    if (routed.issue) {
      return {
        ok: false,
        errors: [routed.issue],
      };
    }
  }

  return {
    ok: true,
    group: laidOutGroup,
  };
}
