import {
  DSL_ERROR_CODES,
  createDslIssue,
} from "./errors.js";
import { buildSemanticGroupIR } from "./ir.js";

const RESERVED_BINDING_NAMES = new Set([
  "pulse",
  "out",
  "mux",
  "demux",
  "switch",
  "block",
  "add",
  "sub",
  "set",
  "speed",
  "pitch",
  "decay",
  "crush",
  "hpf",
  "lpf",
  "every",
  "drop",
  "random",
  "counter",
  "gtp",
  "ltp",
  "gtep",
  "ltep",
  "match",
  "group",
  "outlet",
]);

function isValidBindingIdentifier(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function normalizeBindingIdentifier(value) {
  const normalized = String(value)
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^[^A-Za-z_]/, "_");

  return normalized.length > 0 ? normalized : "_";
}

function* bindingNameSequence() {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");

  for (const letter of letters) {
    yield letter;
  }

  let suffix = 2;

  while (true) {
    for (const letter of letters) {
      yield `${letter}_${suffix}`;
    }

    suffix += 1;
  }
}

function assignBindingNames(ir, mustBind) {
  const assigned = new Map();
  const used = new Set();
  const generator = bindingNameSequence();

  for (const node of ir.nodes) {
    if (!mustBind.has(node.irNodeId)) {
      continue;
    }

    const candidates = [];

    if (typeof node.bindingName === "string" && node.bindingName.trim() !== "") {
      candidates.push(node.bindingName);
      candidates.push(normalizeBindingIdentifier(node.bindingName));
    }

    let chosen = null;

    for (const candidate of candidates) {
      if (
        !candidate ||
        !isValidBindingIdentifier(candidate) ||
        RESERVED_BINDING_NAMES.has(candidate) ||
        used.has(candidate) ||
        candidate.startsWith("$")
      ) {
        continue;
      }

      chosen = candidate;
      break;
    }

    if (!chosen) {
      let generated = generator.next().value;

      while (
        RESERVED_BINDING_NAMES.has(generated) ||
        used.has(generated) ||
        generated.startsWith("$")
      ) {
        generated = generator.next().value;
      }

      chosen = generated;
    } else if (used.has(chosen) || RESERVED_BINDING_NAMES.has(chosen)) {
      let suffix = 2;

      while (
        used.has(`${chosen}_${suffix}`) ||
        RESERVED_BINDING_NAMES.has(`${chosen}_${suffix}`)
      ) {
        suffix += 1;
      }

      chosen = `${chosen}_${suffix}`;
    }

    used.add(chosen);
    assigned.set(node.irNodeId, chosen);
  }

  return assigned;
}

function createMaps(ir, registry) {
  const nodesById = new Map();
  const signalIncomingByNode = new Map();
  const controlIncomingByNode = new Map();
  const signalOutgoingByNode = new Map();
  const outputUseByNode = new Map();
  const dependenciesByNode = new Map();

  for (const node of ir.nodes) {
    const definition = registry.getNodeDefinition(node.type);

    if (!definition) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_INVALID_GROUP,
          `DSL export cannot resolve node type "${node.type}".`,
          {
            nodeId: node.irNodeId,
          },
        ),
      };
    }

    nodesById.set(node.irNodeId, {
      ...node,
      definition,
    });
    signalIncomingByNode.set(node.irNodeId, []);
    controlIncomingByNode.set(node.irNodeId, []);
    signalOutgoingByNode.set(node.irNodeId, []);
    outputUseByNode.set(node.irNodeId, []);
    dependenciesByNode.set(node.irNodeId, []);
  }

  for (const edge of ir.signalEdges) {
    signalIncomingByNode.get(edge.to.irNodeId)?.push(edge);

    if (edge.from.kind === "node-output") {
      signalOutgoingByNode.get(edge.from.irNodeId)?.push(edge);
      outputUseByNode.get(edge.from.irNodeId)?.push({
        kind: "signal-edge",
        outputSlot: edge.from.outputSlot,
      });
      dependenciesByNode.get(edge.from.irNodeId);
      dependenciesByNode.get(edge.to.irNodeId)?.push(edge.from.irNodeId);
    }
  }

  for (const edge of ir.controlEdges) {
    controlIncomingByNode.get(edge.to.irNodeId)?.push(edge);

    if (edge.from.kind === "node-output") {
      outputUseByNode.get(edge.from.irNodeId)?.push({
        kind: "control-edge",
        outputSlot: edge.from.outputSlot,
      });
      dependenciesByNode.get(edge.to.irNodeId)?.push(edge.from.irNodeId);
    }
  }

  for (const outlet of ir.boundaryOutputs) {
    if (outlet.source.kind === "node-output") {
      outputUseByNode.get(outlet.source.irNodeId)?.push({
        kind: "outlet",
        outputSlot: outlet.source.outputSlot,
      });
    }
  }

  for (const inlet of ir.boundaryInputs) {
    const edge = {
      id: `boundary-inlet:${inlet.inletIndex}`,
      from: {
        kind: "boundary-inlet",
        inletIndex: inlet.inletIndex,
      },
      to: inlet.target,
      boundary: true,
    };

    if (inlet.kind === "signal") {
      signalIncomingByNode.get(inlet.target.irNodeId)?.push(edge);
      continue;
    }

    controlIncomingByNode.get(inlet.target.irNodeId)?.push(edge);
  }

  for (const edges of signalIncomingByNode.values()) {
    edges.sort((left, right) => left.to.signalSlot - right.to.signalSlot);
  }

  for (const edges of controlIncomingByNode.values()) {
    edges.sort((left, right) => left.to.controlSlot - right.to.controlSlot);
  }

  for (const [nodeId, edges] of controlIncomingByNode.entries()) {
    const node = nodesById.get(nodeId);
    const seenControlSlots = new Set();

    for (const edge of edges) {
      if (edge.to.controlSlot >= node.definition.controlPorts) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_UNSUPPORTED_GRAPH,
            `DSL export cannot render control slot ${edge.to.controlSlot} on node "${node.type}" because it exceeds the node's declared control inputs.`,
            {
              nodeId,
              edgeId: edge.id,
            },
          ),
        };
      }

      if (seenControlSlots.has(edge.to.controlSlot)) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_UNSUPPORTED_GRAPH,
            `DSL export cannot render node "${node.type}" because control slot ${edge.to.controlSlot} has multiple incoming sources.`,
            {
              nodeId,
              edgeId: edge.id,
            },
          ),
        };
      }

      seenControlSlots.add(edge.to.controlSlot);
    }

    if (edges.length > node.definition.controlPorts) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.EXPORT_UNSUPPORTED_GRAPH,
          `DSL export cannot render node "${node.type}" because it has ${edges.length} incoming control sources but only ${node.definition.controlPorts} control input(s).`,
          {
            nodeId,
          },
        ),
      };
    }

    for (let controlSlot = 0; controlSlot < edges.length; controlSlot += 1) {
      if (edges[controlSlot].to.controlSlot !== controlSlot) {
        return {
          issue: createDslIssue(
            DSL_ERROR_CODES.EXPORT_UNSUPPORTED_GRAPH,
            `DSL export cannot render node "${node.type}" because its incoming control slots are not contiguous from slot 0.`,
            {
              nodeId,
            },
          ),
        };
      }
    }
  }

  return {
    nodesById,
    signalIncomingByNode,
    controlIncomingByNode,
    signalOutgoingByNode,
    outputUseByNode,
    dependenciesByNode,
  };
}

function computeStronglyConnectedComponents(nodeIds, dependenciesByNode) {
  const indexByNode = new Map();
  const lowLinkByNode = new Map();
  const onStack = new Set();
  const stack = [];
  const componentIdByNode = new Map();
  const componentSizes = new Map();
  let index = 0;
  let componentId = 0;

  function visit(nodeId) {
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const dependencyNodeId of dependenciesByNode.get(nodeId) ?? []) {
      if (!indexByNode.has(dependencyNodeId)) {
        visit(dependencyNodeId);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId), lowLinkByNode.get(dependencyNodeId)),
        );
      } else if (onStack.has(dependencyNodeId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId), indexByNode.get(dependencyNodeId)),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) !== indexByNode.get(nodeId)) {
      return;
    }

    let size = 0;

    while (stack.length > 0) {
      const memberNodeId = stack.pop();
      onStack.delete(memberNodeId);
      componentIdByNode.set(memberNodeId, componentId);
      size += 1;

      if (memberNodeId === nodeId) {
        break;
      }
    }

    componentSizes.set(componentId, size);
    componentId += 1;
  }

  for (const nodeId of nodeIds) {
    if (!indexByNode.has(nodeId)) {
      visit(nodeId);
    }
  }

  return {
    componentIdByNode,
    componentSizes,
  };
}

function formatCall(node, controlArgs) {
  const hasStoredParam = typeof node.storedParam === "number";
  const paramClause = hasStoredParam ? `(${node.storedParam})` : "";
  const controlClause = controlArgs.length > 0 ? `{${controlArgs.join(", ")}}` : "";

  if (controlArgs.length === 0) {
    return hasStoredParam ? `${node.type}${paramClause}` : `${node.type}()`;
  }

  return `${node.type}${paramClause}${controlClause}`;
}

function createRenderState(ir, registry, options = {}) {
  const maps = createMaps(ir, registry);

  if (maps.issue) {
    return maps;
  }

  const {
    nodesById,
    signalIncomingByNode,
    controlIncomingByNode,
    outputUseByNode,
    dependenciesByNode,
  } = maps;
  const nodeIds = ir.nodes.map((node) => node.irNodeId);
  const { componentIdByNode, componentSizes } = computeStronglyConnectedComponents(
    nodeIds,
    dependenciesByNode,
  );
  const explicitWireTargets = new Set();
  const explicitWireEdges = new Map();
  const mustBind = new Set();

  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    const incomingSignalEdges = signalIncomingByNode.get(nodeId) ?? [];
    const hasNonPrimaryInput = incomingSignalEdges.some((edge) => edge.to.signalSlot !== 0);
    const needsExplicitSignalWires =
      node.type !== "out" &&
      (node.definition.inputs > 1 ||
        incomingSignalEdges.length > 1 ||
        hasNonPrimaryInput);

    if (needsExplicitSignalWires) {
      explicitWireTargets.add(nodeId);

      for (const edge of incomingSignalEdges) {
        explicitWireEdges.set(edge.id, edge);

        if (edge.from.kind === "node-output") {
          mustBind.add(edge.from.irNodeId);
        }
      }

      mustBind.add(nodeId);
    }
  }

  for (const nodeId of nodeIds) {
    const node = nodesById.get(nodeId);
    const outputUses = outputUseByNode.get(nodeId) ?? [];
    const hasIndexedUse = outputUses.some(({ outputSlot }) => outputSlot !== 0);
    const componentId = componentIdByNode.get(nodeId);
    const componentSize = componentSizes.get(componentId) ?? 1;
    const hasSelfLoop = (dependenciesByNode.get(nodeId) ?? []).includes(nodeId);

    if (node.type === "out") {
      continue;
    }

    if (node.definition.outputs > 1 && outputUses.length > 0) {
      mustBind.add(nodeId);
    }

    if (hasIndexedUse) {
      mustBind.add(nodeId);
    }

    if (componentSize > 1 || hasSelfLoop) {
      mustBind.add(nodeId);
    }
  }

  const bindingNames = assignBindingNames(ir, mustBind);

  return {
    ir,
    registry,
    options,
    nodesById,
    signalIncomingByNode,
    controlIncomingByNode,
    explicitWireTargets,
    explicitWireEdges,
    mustBind,
    bindingNames,
    componentIdByNode,
    nodeOrder: nodeIds,
  };
}

function renderSemanticGroupDsl(ir, registry, options = {}) {
  const state = createRenderState(ir, registry, options);

  if (state.issue) {
    return {
      ok: false,
      errors: [state.issue],
    };
  }

  const renderedBindings = new Set();
  const renderedWireEdges = new Set();
  const renderedSinks = new Set();
  const renderedStandalone = new Set();
  const renderingBindings = new Set();
  const statements = [];
  const expressionCache = new Map();

  function renderSourceRef(source, consumerNodeId = null) {
    if (source.kind === "boundary-inlet") {
      return `$${source.inletIndex}`;
    }

    const sourceNode = state.nodesById.get(source.irNodeId);

    if (!sourceNode) {
      throw createDslIssue(
        DSL_ERROR_CODES.EXPORT_INTERNAL,
        `DSL export cannot resolve source node "${source.irNodeId}".`,
        {
          nodeId: source.irNodeId,
        },
      );
    }

    if (state.mustBind.has(source.irNodeId)) {
      return `${state.bindingNames.get(source.irNodeId)}${
        sourceNode.definition.outputs > 1 || source.outputSlot !== 0
          ? `[${source.outputSlot}]`
          : ""
      }`;
    }

    if (source.outputSlot !== 0) {
      throw createDslIssue(
        DSL_ERROR_CODES.EXPORT_UNSUPPORTED_GRAPH,
        `DSL export requires a binding for indexed output ${source.outputSlot} on node "${source.irNodeId}".`,
        {
          nodeId: source.irNodeId,
        },
      );
    }

    if (renderingBindings.has(source.irNodeId) && consumerNodeId !== source.irNodeId) {
      return state.bindingNames.get(source.irNodeId);
    }

    return renderNodeExpression(source.irNodeId);
  }

  function formatDistance(edge) {
    if (
      options.annotated !== true ||
      typeof edge.distance !== "number" ||
      edge.distance <= 0 ||
      edge.from.kind === "boundary-inlet"
    ) {
      return "";
    }

    return `<${Math.round(edge.distance)}>`;
  }

  function renderSourceWithDistance(edge, consumerNodeId = null) {
    return `${renderSourceRef(edge.from, consumerNodeId)}${formatDistance(edge)}`;
  }

  function renderNodeExpression(nodeId) {
    if (expressionCache.has(nodeId)) {
      return expressionCache.get(nodeId);
    }

    const node = state.nodesById.get(nodeId);

    if (!node) {
      throw createDslIssue(
        DSL_ERROR_CODES.EXPORT_INTERNAL,
        `DSL export cannot resolve node "${nodeId}".`,
        { nodeId },
      );
    }

    const signalInputs = state.signalIncomingByNode.get(nodeId) ?? [];
    const controlInputs = state.controlIncomingByNode.get(nodeId) ?? [];
    const controlArgs = controlInputs.map((edge) => renderSourceWithDistance(edge, nodeId));

    if (node.type === "out") {
      const terminal =
        signalInputs.length === 1 && signalInputs[0].to.signalSlot === 0
          ? `${renderSourceWithDistance(signalInputs[0], nodeId)}.out()`
          : "out()";

      expressionCache.set(nodeId, terminal);
      return terminal;
    }

    const call = formatCall(node, controlArgs);
    const canChainSignal =
      node.definition.inputs === 1 &&
      signalInputs.length === 1 &&
      signalInputs[0].to.signalSlot === 0 &&
      !state.explicitWireTargets.has(nodeId);
    const expression = canChainSignal
      ? `${renderSourceWithDistance(signalInputs[0], nodeId)}.${call}`
      : call;

    expressionCache.set(nodeId, expression);
    return expression;
  }

  function getBindingDependencyRefs(nodeId) {
    const node = state.nodesById.get(nodeId);
    const signalInputs = state.signalIncomingByNode.get(nodeId) ?? [];
    const controlInputs = state.controlIncomingByNode.get(nodeId) ?? [];
    const refs = [];

    if (
      node.type !== "out" &&
      node.definition.inputs === 1 &&
      signalInputs.length === 1 &&
      signalInputs[0].to.signalSlot === 0 &&
      !state.explicitWireTargets.has(nodeId)
    ) {
      refs.push(signalInputs[0].from);
    }

    for (const edge of controlInputs) {
      refs.push(edge.from);
    }

    return refs;
  }

  function emitBinding(nodeId) {
    if (!state.mustBind.has(nodeId) || renderedBindings.has(nodeId)) {
      return;
    }

    if (renderingBindings.has(nodeId)) {
      return;
    }

    renderingBindings.add(nodeId);

    for (const source of getBindingDependencyRefs(nodeId)) {
      if (source.kind !== "node-output") {
        continue;
      }

      if (
        state.componentIdByNode.get(source.irNodeId) === state.componentIdByNode.get(nodeId) &&
        !renderedBindings.has(source.irNodeId)
      ) {
        continue;
      }

      emitBinding(source.irNodeId);
    }

    statements.push(`${state.bindingNames.get(nodeId)} = ${renderNodeExpression(nodeId)}`);
    renderedBindings.add(nodeId);
    renderingBindings.delete(nodeId);
  }

  function renderTargetRef(edge) {
    const targetNode = state.nodesById.get(edge.to.irNodeId);
    const bindingName = state.bindingNames.get(edge.to.irNodeId);

    return `${bindingName}${
      targetNode.definition.inputs > 1 || edge.to.signalSlot !== 0
        ? `[${edge.to.signalSlot}]`
        : ""
    }`;
  }

  function emitIncomingSignalWires(nodeId) {
    const incomingEdges = state.signalIncomingByNode.get(nodeId) ?? [];

    for (const edge of incomingEdges) {
      if (!state.explicitWireEdges.has(edge.id) || renderedWireEdges.has(edge.id)) {
        continue;
      }

      statements.push(`${renderSourceWithDistance(edge, nodeId)}.${renderTargetRef(edge)}`);
      renderedWireEdges.add(edge.id);
    }
  }

  function emitOutlet(outlet) {
    if (
      outlet.source.kind === "node-output" &&
      state.explicitWireTargets.has(outlet.source.irNodeId)
    ) {
      emitIncomingSignalWires(outlet.source.irNodeId);
    }

    statements.push(
      `${renderSourceRef(outlet.source)}.outlet(${outlet.outletIndex})`,
    );
  }

  function emitOutSink(nodeId) {
    if (renderedSinks.has(nodeId)) {
      return;
    }

    const signalInputs = state.signalIncomingByNode.get(nodeId) ?? [];

    if (
      signalInputs.length === 1 &&
      signalInputs[0].from.kind === "node-output" &&
      state.explicitWireTargets.has(signalInputs[0].from.irNodeId)
    ) {
      emitIncomingSignalWires(signalInputs[0].from.irNodeId);
    }

    statements.push(renderNodeExpression(nodeId));
    renderedSinks.add(nodeId);
  }

  const commentLines =
    options.annotated === true
      ? ir.comments.map((comment) => `// ${comment.text}`)
      : [];

  for (const line of commentLines) {
    statements.push(line);
  }

  for (const nodeId of state.nodeOrder) {
    emitBinding(nodeId);
  }

  for (const outlet of ir.boundaryOutputs
    .slice()
    .sort((left, right) => left.outletIndex - right.outletIndex)) {
    emitOutlet(outlet);
  }

  for (const nodeId of state.nodeOrder) {
    const node = state.nodesById.get(nodeId);

    if (node.type === "out") {
      emitOutSink(nodeId);
    }
  }

  for (const nodeId of state.nodeOrder) {
    if (state.explicitWireTargets.has(nodeId)) {
      emitIncomingSignalWires(nodeId);
    }
  }

  for (const nodeId of state.nodeOrder) {
    if (state.mustBind.has(nodeId) || renderedStandalone.has(nodeId)) {
      continue;
    }

    const node = state.nodesById.get(nodeId);

    if (node.type === "out") {
      continue;
    }

    const signalInputs = state.signalIncomingByNode.get(nodeId)?.length ?? 0;
    const controlInputs = state.controlIncomingByNode.get(nodeId)?.length ?? 0;
    const outputUses = state.explicitWireTargets.has(nodeId)
      ? 1
      : 0;
    const hasOutlet = ir.boundaryOutputs.some(
      (outlet) =>
        outlet.source.kind === "node-output" && outlet.source.irNodeId === nodeId,
    );
    const isSourceForAnyEdge =
      ir.signalEdges.some(
        (edge) => edge.from.kind === "node-output" && edge.from.irNodeId === nodeId,
      ) ||
      ir.controlEdges.some(
        (edge) => edge.from.kind === "node-output" && edge.from.irNodeId === nodeId,
      );

    if (signalInputs > 0 || controlInputs > 0 || outputUses > 0 || hasOutlet || isSourceForAnyEdge) {
      continue;
    }

    statements.push(renderNodeExpression(nodeId));
    renderedStandalone.add(nodeId);
  }

  return {
    ok: true,
    text: statements.join("\n"),
    ir: {
      ...ir,
      bindingNames: Object.fromEntries(state.bindingNames.entries()),
    },
  };
}

export function exportGroupDsl(groupDefinition, registry, options = {}) {
  const irResult = buildSemanticGroupIR(groupDefinition, registry, options);

  if (!irResult.ok) {
    return irResult;
  }

  try {
    return renderSemanticGroupDsl(irResult.ir, registry, options);
  } catch (error) {
    const issue =
      error?.code && String(error.code).startsWith("DSL_")
        ? error
        : createDslIssue(
            DSL_ERROR_CODES.EXPORT_INTERNAL,
            error instanceof Error ? error.message : "Unknown DSL export failure.",
          );

    return {
      ok: false,
      errors: [issue],
    };
  }
}
