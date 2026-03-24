import { normalizeGroupDefinition } from "../graph/snapshot.js";
import { CURRENT_GROUP_DSL_FORMAT_VERSION } from "./constants.js";
import { layoutFreshDslGroup } from "./layout.js";
import { computeGroupDslSemanticHash } from "./hash.js";
import { DSL_RESERVED_WORDS, parseGroupDsl } from "./parse.js";
import { reconcileDslGroup } from "./reconcile.js";
import {
  DSL_ERROR_CODES,
  createDslIssue,
} from "./errors.js";

function ensureRegistryAccess(registry) {
  if (typeof registry?.getNodeDefinition !== "function") {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_REGISTRY,
        "DSL lowering requires registry.getNodeDefinition().",
      ),
    };
  }

  return {
    registry,
  };
}

function cloneSourceRef(source) {
  if (source.kind === "boundary-inlet") {
    return {
      kind: "boundary-inlet",
      inletIndex: source.inletIndex,
    };
  }

  if (source.kind === "binding-output") {
    return {
      kind: "binding-output",
      bindingName: source.bindingName,
      outputSlot: source.outputSlot,
    };
  }

  return {
    kind: "node-output",
    irNodeId: source.irNodeId,
    outputSlot: source.outputSlot,
  };
}

function cloneSignalTarget(target) {
  if (target.kind === "binding-target") {
    return {
      kind: "binding-target",
      bindingName: target.bindingName,
      signalSlot: target.signalSlot,
    };
  }

  return {
    irNodeId: target.irNodeId,
    signalSlot: target.signalSlot,
  };
}

function getSimpleNodePosition(index) {
  const column = index % 6;
  const row = Math.floor(index / 6);

  return {
    x: column * 8,
    y: row * 6,
  };
}

function createLoweringContext(ast, registry, options = {}) {
  const bindingTable = new Map();

  for (const statement of ast.statements) {
    if (statement.type !== "binding-statement") {
      continue;
    }

    if (DSL_RESERVED_WORDS.has(statement.name)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_RESERVED_BINDING,
          `Binding "${statement.name}" uses a reserved DSL word.`,
          {
            line: statement.line,
            bindingName: statement.name,
          },
        ),
      };
    }

    if (bindingTable.has(statement.name)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_DUPLICATE_BINDING,
          `Binding "${statement.name}" is declared more than once.`,
          {
            line: statement.line,
            bindingName: statement.name,
          },
        ),
      };
    }

    bindingTable.set(statement.name, {
      name: statement.name,
      line: statement.line,
      statement,
      irNodeId: null,
    });
  }

  return {
    registry,
    options,
    ast,
    bindings: bindingTable,
    nodes: [],
    signalEdges: [],
    controlEdges: [],
    boundaryInputs: [],
    boundaryOutputs: [],
    nextNodeId: 1,
    nextEdgeId: 1,
  };
}

function createNodeRecord(context, nodeCall) {
  const definition = context.registry.getNodeDefinition(nodeCall.name);

  if (!definition) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_UNKNOWN_NODE,
        `Unknown DSL node "${nodeCall.name}".`,
      ),
    };
  }

  if (nodeCall.param !== null) {
    if (definition.hasParam !== true) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_PARAM_BLOCK,
          `Node "${nodeCall.name}" does not accept a stored param clause.`,
        ),
      };
    }

    if (!Number.isInteger(nodeCall.param) || nodeCall.param < 1 || nodeCall.param > 8) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_PARAM_BLOCK,
          `Node "${nodeCall.name}" param clause must be an integer in 1..8.`,
        ),
      };
    }
  }

  if (nodeCall.args.length > definition.controlPorts) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_CONTROL_ARITY,
          `Node "${nodeCall.name}" accepts ${definition.controlPorts} control clause input(s), got ${nodeCall.args.length}.`,
        ),
      };
    }

  const irNodeId = `node-${context.nextNodeId++}`;

  context.nodes.push({
    irNodeId,
    type: definition.type,
    ...(definition.hasParam === true
      ? {
          storedParam:
            nodeCall.param !== null ? nodeCall.param : definition.defaultParam,
        }
      : {}),
  });

  return {
    node: context.nodes[context.nodes.length - 1],
    definition,
  };
}

function recordBoundaryInput(context, inletIndex, kind, target) {
  const existing = context.boundaryInputs.find((entry) => entry.inletIndex === inletIndex);

  if (existing) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_INLET_USAGE,
        `Boundary inlet $${inletIndex} is used more than once.`,
        {
          inletIndex,
        },
      ),
    };
  }

  context.boundaryInputs.push({
    inletIndex,
    kind,
    target,
  });

  return {
    ok: true,
  };
}

function connectSignal(context, source, target, distance) {
  if (distance !== null && (!Number.isInteger(distance) || distance <= 0)) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
        `Signal edge distance must be a positive integer.`,
      ),
    };
  }

  if (source.kind === "boundary-inlet") {
    if (distance !== null) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
          `Boundary inlet $${source.inletIndex} cannot carry a <distance> annotation.`,
          {
            inletIndex: source.inletIndex,
          },
        ),
      };
    }

    return recordBoundaryInput(context, source.inletIndex, "signal", cloneSignalTarget(target));
  }

  context.signalEdges.push({
    id: `edge-${context.nextEdgeId++}`,
    from: cloneSourceRef(source),
    to: cloneSignalTarget(target),
    ...(distance !== null ? { distance } : {}),
  });

  return {
    ok: true,
  };
}

function connectControl(context, source, target, distance) {
  if (distance !== null && (!Number.isInteger(distance) || distance <= 0)) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
        `Control edge distance must be a positive integer.`,
      ),
    };
  }

  if (source.kind === "boundary-inlet") {
    if (distance !== null) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
          `Boundary inlet $${source.inletIndex} cannot carry a <distance> annotation.`,
          {
            inletIndex: source.inletIndex,
          },
        ),
      };
    }

    return recordBoundaryInput(context, source.inletIndex, "control", {
      irNodeId: target.irNodeId,
      controlSlot: target.controlSlot,
    });
  }

  context.controlEdges.push({
    id: `edge-${context.nextEdgeId++}`,
    from: cloneSourceRef(source),
    to: {
      irNodeId: target.irNodeId,
      controlSlot: target.controlSlot,
    },
    ...(distance !== null ? { distance } : {}),
  });

  return {
    ok: true,
  };
}

function lowerNodeCall(context, nodeCall) {
  const created = createNodeRecord(context, nodeCall);

  if (created.issue) {
    return created;
  }

  for (let controlSlot = 0; controlSlot < nodeCall.args.length; controlSlot += 1) {
    const loweredArg = lowerExpression(context, nodeCall.args[controlSlot], {
      statementLine: null,
    });

    if (loweredArg.issue) {
      return loweredArg;
    }

    const controlConnect = connectControl(
      context,
      loweredArg.result.source,
      {
        irNodeId: created.node.irNodeId,
        controlSlot,
      },
      loweredArg.result.pendingDistance,
    );

    if (controlConnect.issue) {
      return controlConnect;
    }
  }

  return {
    result: {
      source: {
        kind: "node-output",
        irNodeId: created.node.irNodeId,
        outputSlot: 0,
      },
      terminalApplied: false,
      pendingDistance: null,
      finalNodeId: created.node.irNodeId,
    },
  };
}

function lowerSourceAtom(context, atom) {
  if (atom.type === "inlet-ref") {
    return {
      result: {
        source: {
          kind: "boundary-inlet",
          inletIndex: atom.index,
        },
        terminalApplied: false,
        pendingDistance: null,
        finalNodeId: null,
      },
    };
  }

  if (atom.type === "ref") {
    if (!context.bindings.has(atom.name)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_UNKNOWN_BINDING,
          `Unknown binding "${atom.name}".`,
          {
            bindingName: atom.name,
          },
        ),
      };
    }

    return {
      result: {
        source: {
          kind: "binding-output",
          bindingName: atom.name,
          outputSlot: atom.index ?? 0,
        },
        terminalApplied: false,
        pendingDistance: null,
        finalNodeId: null,
      },
    };
  }

  return lowerNodeCall(context, atom);
}

function lowerExpression(context, expr, options = {}) {
  const loweredHead = lowerSourceAtom(context, expr.head);

  if (loweredHead.issue) {
    return loweredHead;
  }

  let current = loweredHead.result;

  for (const segment of expr.segments) {
    const loweredCall = lowerNodeCall(context, segment.call);

    if (loweredCall.issue) {
      return loweredCall;
    }

    const signalConnect = connectSignal(
      context,
      current.source,
      {
        irNodeId: loweredCall.result.finalNodeId,
        signalSlot: 0,
      },
      segment.distance,
    );

    if (signalConnect.issue) {
      return signalConnect;
    }

    current = loweredCall.result;
  }

  current = {
    ...current,
    pendingDistance: expr.pendingDistance,
  };

  if (!expr.terminal) {
    return {
      result: current,
    };
  }

  if (current.pendingDistance !== null) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
        "A <distance> annotation cannot appear immediately before a terminal.",
        {
          line: options.statementLine ?? undefined,
        },
      ),
    };
  }

  if (expr.terminal.type === "out-terminal") {
    const loweredOut = lowerNodeCall(context, {
      type: "node-call",
      name: "out",
      param: null,
      args: [],
    });

    if (loweredOut.issue) {
      return loweredOut;
    }

    const outConnect = connectSignal(
      context,
      current.source,
      {
        irNodeId: loweredOut.result.finalNodeId,
        signalSlot: 0,
      },
      null,
    );

    if (outConnect.issue) {
      return outConnect;
    }

    return {
      result: {
        source: null,
        terminalApplied: true,
        pendingDistance: null,
        finalNodeId: loweredOut.result.finalNodeId,
      },
    };
  }

  context.boundaryOutputs.push({
    outletIndex: expr.terminal.index,
    source: cloneSourceRef(current.source),
  });

  return {
    result: {
      ...current,
      terminalApplied: true,
      pendingDistance: null,
    },
  };
}

function setBindingName(context, irNodeId, bindingName) {
  const node = context.nodes.find((entry) => entry.irNodeId === irNodeId);

  if (node) {
    node.bindingName = bindingName;
  }
}

function lowerStatement(context, statement) {
  if (statement.type === "binding-statement") {
    const loweredBinding = lowerExpression(context, statement.expr, {
      statementLine: statement.line,
    });

    if (loweredBinding.issue) {
      return loweredBinding;
    }

    if (loweredBinding.result.terminalApplied === true) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_BINDING,
          `Binding "${statement.name}" cannot terminate with .out() or .outlet(n).`,
          {
            line: statement.line,
            bindingName: statement.name,
          },
        ),
      };
    }

    if (loweredBinding.result.pendingDistance !== null) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
          `Binding "${statement.name}" ends with a dangling <distance> annotation.`,
          {
            line: statement.line,
            bindingName: statement.name,
          },
        ),
      };
    }

    if (!loweredBinding.result.finalNodeId) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_BINDING,
          `Binding "${statement.name}" must resolve to a real node result, not a bare inlet or alias.`,
          {
            line: statement.line,
            bindingName: statement.name,
          },
        ),
      };
    }

    const binding = context.bindings.get(statement.name);
    binding.irNodeId = loweredBinding.result.finalNodeId;
    setBindingName(context, loweredBinding.result.finalNodeId, statement.name);

    return {
      ok: true,
    };
  }

  if (statement.type === "wire-statement") {
    const source =
      statement.source.type === "inlet-ref"
        ? {
            kind: "boundary-inlet",
            inletIndex: statement.source.index,
          }
        : {
            kind: "binding-output",
            bindingName: statement.source.name,
            outputSlot: statement.source.index ?? 0,
          };

    if (source.kind === "binding-output" && !context.bindings.has(source.bindingName)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_UNKNOWN_BINDING,
          `Unknown binding "${source.bindingName}".`,
          {
            line: statement.line,
            bindingName: source.bindingName,
          },
        ),
      };
    }

    if (!context.bindings.has(statement.target.name)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_UNKNOWN_BINDING,
          `Unknown binding "${statement.target.name}".`,
          {
            line: statement.line,
            bindingName: statement.target.name,
          },
        ),
      };
    }

    return connectSignal(
      context,
      source,
      {
        kind: "binding-target",
        bindingName: statement.target.name,
        signalSlot: statement.target.index ?? 0,
      },
      statement.distance,
    );
  }

  const loweredExpr = lowerExpression(context, statement.expr, {
    statementLine: statement.line,
  });

  if (loweredExpr.issue) {
    return loweredExpr;
  }

  if (loweredExpr.result.pendingDistance !== null) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_DISTANCE,
        "Top-level expression ends with a dangling <distance> annotation.",
        {
          line: statement.line,
        },
      ),
    };
  }

  if (!loweredExpr.result.terminalApplied && !loweredExpr.result.finalNodeId) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_BINDING,
        "Top-level expression must create a node or terminate with .out()/.outlet(n).",
        {
          line: statement.line,
        },
      ),
    };
  }

  return {
    ok: true,
  };
}

function resolveBindingSource(context, source) {
  if (source.kind !== "binding-output") {
    return {
      source,
    };
  }

  const binding = context.bindings.get(source.bindingName);

  if (!binding?.irNodeId) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_UNKNOWN_BINDING,
        `Binding "${source.bindingName}" does not resolve to a node.`,
        {
          bindingName: source.bindingName,
        },
      ),
    };
  }

  return {
    source: {
      kind: "node-output",
      irNodeId: binding.irNodeId,
      outputSlot: source.outputSlot,
    },
  };
}

function resolveBindingTarget(context, target) {
  if (target.kind !== "binding-target") {
    return {
      target,
    };
  }

  const binding = context.bindings.get(target.bindingName);

  if (!binding?.irNodeId) {
    return {
      issue: createDslIssue(
        DSL_ERROR_CODES.LOWER_UNKNOWN_BINDING,
        `Binding "${target.bindingName}" does not resolve to a node.`,
        {
          bindingName: target.bindingName,
        },
      ),
    };
  }

  return {
    target: {
      irNodeId: binding.irNodeId,
      signalSlot: target.signalSlot,
    },
  };
}

function validateResolvedPortUsage(context) {
  const nodeById = new Map(context.nodes.map((node) => [node.irNodeId, node]));
  const outputUsage = new Map();
  const signalTargetUsage = new Map();
  const controlTargetUsage = new Map();

  function getDefinition(irNodeId) {
    const node = nodeById.get(irNodeId);
    return node ? context.registry.getNodeDefinition(node.type) : null;
  }

  function claimOutput(source, consumerLabel) {
    if (source.kind !== "node-output") {
      return null;
    }

    const definition = getDefinition(source.irNodeId);

    if (!definition || source.outputSlot < 0 || source.outputSlot >= definition.outputs) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_PORT_INDEX,
        `Output slot ${source.outputSlot} is invalid on node "${source.irNodeId}".`,
        {
          nodeId: source.irNodeId,
        },
      );
    }

    const key = `${source.irNodeId}:${source.outputSlot}`;

    if (outputUsage.has(key)) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_DUPLICATE_OUTPUT_SOURCE,
        `Output slot ${source.outputSlot} on node "${source.irNodeId}" is connected more than once.`,
        {
          nodeId: source.irNodeId,
        },
      );
    }

    outputUsage.set(key, consumerLabel);
    return null;
  }

  function claimSignalTarget(target) {
    const definition = getDefinition(target.irNodeId);

    if (!definition || target.signalSlot < 0 || target.signalSlot >= definition.inputs) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_PORT_INDEX,
        `Signal input slot ${target.signalSlot} is invalid on node "${target.irNodeId}".`,
        {
          nodeId: target.irNodeId,
        },
      );
    }

    const key = `${target.irNodeId}:${target.signalSlot}`;

    if (signalTargetUsage.has(key)) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_DUPLICATE_SIGNAL_TARGET,
        `Signal input slot ${target.signalSlot} on node "${target.irNodeId}" is connected more than once.`,
        {
          nodeId: target.irNodeId,
        },
      );
    }

    signalTargetUsage.set(key, true);
    return null;
  }

  function claimControlTarget(target) {
    const definition = getDefinition(target.irNodeId);

    if (
      !definition ||
      target.controlSlot < 0 ||
      target.controlSlot >= definition.controlPorts
    ) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_INVALID_PORT_INDEX,
        `Control slot ${target.controlSlot} is invalid on node "${target.irNodeId}".`,
        {
          nodeId: target.irNodeId,
        },
      );
    }

    const key = `${target.irNodeId}:${target.controlSlot}`;

    if (controlTargetUsage.has(key)) {
      return createDslIssue(
        DSL_ERROR_CODES.LOWER_DUPLICATE_CONTROL_TARGET,
        `Control slot ${target.controlSlot} on node "${target.irNodeId}" is connected more than once.`,
        {
          nodeId: target.irNodeId,
        },
      );
    }

    controlTargetUsage.set(key, true);
    return null;
  }

  for (const edge of context.signalEdges) {
    const sourceIssue = claimOutput(edge.from, edge.id);

    if (sourceIssue) {
      return { issue: sourceIssue };
    }

    const targetIssue = claimSignalTarget(edge.to);

    if (targetIssue) {
      return { issue: targetIssue };
    }
  }

  for (const edge of context.controlEdges) {
    const sourceIssue = claimOutput(edge.from, edge.id);

    if (sourceIssue) {
      return { issue: sourceIssue };
    }

    const targetIssue = claimControlTarget(edge.to);

    if (targetIssue) {
      return { issue: targetIssue };
    }
  }

  for (const outlet of context.boundaryOutputs) {
    if (outlet.source.kind !== "node-output") {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_GROUP,
          `Outlet ${outlet.outletIndex} must expose a real node output.`,
          {
            outletIndex: outlet.outletIndex,
          },
        ),
      };
    }

    const definition = getDefinition(outlet.source.irNodeId);

    if (
      !definition ||
      outlet.source.outputSlot < 0 ||
      outlet.source.outputSlot >= definition.outputs
    ) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_PORT_INDEX,
          `Outlet ${outlet.outletIndex} references invalid output slot ${outlet.source.outputSlot} on node "${outlet.source.irNodeId}".`,
          {
            nodeId: outlet.source.irNodeId,
            outletIndex: outlet.outletIndex,
          },
        ),
      };
    }
  }

  for (const inlet of context.boundaryInputs) {
    const issue =
      inlet.kind === "signal"
        ? claimSignalTarget(inlet.target)
        : claimControlTarget(inlet.target);

    if (issue) {
      return { issue };
    }
  }

  return {
    ok: true,
  };
}

function validateInterfaceNumbering(context) {
  const signalIndices = context.boundaryInputs
    .filter((entry) => entry.kind === "signal")
    .map((entry) => entry.inletIndex)
    .sort((left, right) => left - right);
  const controlIndices = context.boundaryInputs
    .filter((entry) => entry.kind === "control")
    .map((entry) => entry.inletIndex)
    .sort((left, right) => left - right);
  const outletIndices = context.boundaryOutputs
    .map((entry) => entry.outletIndex)
    .sort((left, right) => left - right);

  for (let index = 0; index < signalIndices.length; index += 1) {
    if (signalIndices[index] !== index) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_INLET_USAGE,
          "Signal boundary inlet indices must form a contiguous range starting at 0.",
          {
            inletIndex: signalIndices[index],
          },
        ),
      };
    }
  }

  for (let index = 0; index < controlIndices.length; index += 1) {
    const expected = signalIndices.length + index;

    if (controlIndices[index] !== expected) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_INLET_USAGE,
          "Control boundary inlet indices must follow the final signal inlet without gaps.",
          {
            inletIndex: controlIndices[index],
          },
        ),
      };
    }
  }

  const seenOutlets = new Set();

  for (const outletIndex of outletIndices) {
    if (seenOutlets.has(outletIndex)) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_DUPLICATE_OUTLET,
          `Outlet ${outletIndex} is declared more than once.`,
          {
            outletIndex,
          },
        ),
      };
    }

    seenOutlets.add(outletIndex);
  }

  for (let index = 0; index < outletIndices.length; index += 1) {
    if (outletIndices[index] !== index) {
      return {
        issue: createDslIssue(
          DSL_ERROR_CODES.LOWER_GAPPED_OUTLET,
          "Outlet indices must form a contiguous range starting at 0.",
          {
            outletIndex: outletIndices[index],
          },
        ),
      };
    }
  }

  return {
    ok: true,
  };
}

function resolveReferences(context) {
  for (const edge of context.signalEdges) {
    const resolvedSource = resolveBindingSource(context, edge.from);

    if (resolvedSource.issue) {
      return resolvedSource;
    }

    const resolvedTarget = resolveBindingTarget(context, edge.to);

    if (resolvedTarget.issue) {
      return resolvedTarget;
    }

    edge.from = resolvedSource.source;
    edge.to = resolvedTarget.target;
  }

  for (const edge of context.controlEdges) {
    const resolvedSource = resolveBindingSource(context, edge.from);

    if (resolvedSource.issue) {
      return resolvedSource;
    }

    edge.from = resolvedSource.source;
  }

  for (const inlet of context.boundaryInputs) {
    if (inlet.kind !== "signal") {
      continue;
    }

    const resolvedTarget = resolveBindingTarget(context, inlet.target);

    if (resolvedTarget.issue) {
      return resolvedTarget;
    }

    inlet.target = resolvedTarget.target;
  }

  for (const outlet of context.boundaryOutputs) {
    const resolvedSource = resolveBindingSource(context, outlet.source);

    if (resolvedSource.issue) {
      return resolvedSource;
    }

    outlet.source = resolvedSource.source;
  }

  return validateResolvedPortUsage(context);
}

function lowerAstToSemanticIr(ast, registry, options = {}) {
  const contextResult = createLoweringContext(ast, registry, options);

  if (contextResult.issue) {
    return {
      ok: false,
      errors: [contextResult.issue],
    };
  }

  const context = contextResult;

  for (const statement of ast.statements) {
    const lowered = lowerStatement(context, statement);

    if (lowered.issue) {
      return {
        ok: false,
        errors: [lowered.issue],
      };
    }
  }

  const interfaceValidation = validateInterfaceNumbering(context);

  if (interfaceValidation.issue) {
    return {
      ok: false,
      errors: [interfaceValidation.issue],
    };
  }

  const resolution = resolveReferences(context);

  if (resolution.issue) {
    return {
      ok: false,
      errors: [resolution.issue],
    };
  }

  return {
    ok: true,
    ir: {
      preserveInternalCableDelays: options.preserveInternalCableDelays === true,
      nodes: context.nodes,
      signalEdges: context.signalEdges,
      controlEdges: context.controlEdges,
      boundaryInputs: context.boundaryInputs.sort(
        (left, right) => left.inletIndex - right.inletIndex,
      ),
      boundaryOutputs: context.boundaryOutputs.sort(
        (left, right) => left.outletIndex - right.outletIndex,
      ),
      comments: ast.comments,
      bindingNames: Object.fromEntries(
        context.nodes.map((node) => [node.irNodeId, node.bindingName]),
      ),
    },
  };
}

function convertIrToGroupDefinition(ir, registry, options = {}) {
  const nodeDefinitions = new Map(
    ir.nodes.map((node) => [node.irNodeId, registry.getNodeDefinition(node.type)]),
  );
  const nodes = ir.nodes.map((node, index) => ({
    id: node.irNodeId,
    type: node.type,
    pos: getSimpleNodePosition(index),
    rot: 0,
    params:
      typeof node.storedParam === "number"
        ? { param: node.storedParam }
        : {},
    ...(node.bindingName ? { name: node.bindingName } : {}),
  }));
  const edges = [
    ...ir.signalEdges.map((edge) => ({
      id: edge.id,
      from: {
        nodeId: edge.from.irNodeId,
        portSlot: edge.from.outputSlot,
      },
      to: {
        nodeId: edge.to.irNodeId,
        portSlot: edge.to.signalSlot,
      },
      manualCorners: [],
    })),
    ...ir.controlEdges.map((edge) => {
      const definition = nodeDefinitions.get(edge.to.irNodeId);

      return {
        id: edge.id,
        from: {
          nodeId: edge.from.irNodeId,
          portSlot: edge.from.outputSlot,
        },
        to: {
          nodeId: edge.to.irNodeId,
          portSlot: definition.inputs + edge.to.controlSlot,
        },
        manualCorners: [],
      };
    }),
  ];
  const inputs = ir.boundaryInputs
    .filter((entry) => entry.kind === "signal")
    .sort((left, right) => left.inletIndex - right.inletIndex)
    .map((entry) => ({
      nodeId: entry.target.irNodeId,
      portSlot: entry.target.signalSlot,
    }));
  const controls = ir.boundaryInputs
    .filter((entry) => entry.kind === "control")
    .sort((left, right) => left.inletIndex - right.inletIndex)
    .map((entry) => ({
      nodeId: entry.target.irNodeId,
      controlSlot: entry.target.controlSlot,
    }));
  const outputs = ir.boundaryOutputs
    .sort((left, right) => left.outletIndex - right.outletIndex)
    .map((entry) => ({
      nodeId: entry.source.irNodeId,
      portSlot: entry.source.outputSlot,
    }));
  const groupId = options.groupId ?? options.existingGroup?.id ?? "__dsl_group__";
  const group = {
    id: groupId,
    name: options.groupName ?? options.existingGroup?.name ?? groupId,
    preserveInternalCableDelays: ir.preserveInternalCableDelays === true,
    graph: {
      nodes,
      edges,
    },
    inputs,
    outputs,
    controls,
  };
  const normalized = normalizeGroupDefinition(group, registry.getNodeDefinition, {
    source: "create",
    groups: {},
    validateGroupRef: true,
  });

  if (normalized.issue) {
    return {
      ok: false,
      errors: [
        createDslIssue(
          DSL_ERROR_CODES.LOWER_INVALID_GROUP,
          normalized.issue.message ?? "Lowered DSL group definition is invalid.",
          {
            groupId,
          },
        ),
      ],
    };
  }

  const laidOut = layoutFreshDslGroup(normalized.group, ir, registry, options);

  if (!laidOut.ok) {
    return laidOut;
  }

  return {
    ok: true,
    group: laidOut.group,
  };
}

export function lowerGroupDsl(input, registry, options = {}) {
  const registryAccess = ensureRegistryAccess(registry);

  if (registryAccess.issue) {
    return {
      ok: false,
      errors: [registryAccess.issue],
    };
  }

  const parsed =
    typeof input === "string"
      ? parseGroupDsl(input, options)
      : input?.type === "dsl-file"
        ? { ok: true, ast: input }
        : { ok: false, errors: [createDslIssue(DSL_ERROR_CODES.PARSE_INVALID_SOURCE, "DSL input must be source text or a parsed DSL file AST.")] };

  if (!parsed.ok) {
    return parsed;
  }

  const loweredIr = lowerAstToSemanticIr(parsed.ast, registry, options);

  if (!loweredIr.ok) {
    return loweredIr;
  }

  const loweredGroup = convertIrToGroupDefinition(loweredIr.ir, registry, options);

  if (!loweredGroup.ok) {
    return loweredGroup;
  }

  const reconciledGroup = options.existingGroup
    ? reconcileDslGroup(loweredGroup.group, options.existingGroup, registry, options)
    : loweredGroup;

  if (!reconciledGroup.ok) {
    return reconciledGroup;
  }

  const sourceText =
    typeof parsed.ast?.source === "string" ? parsed.ast.source : null;

  if (sourceText !== null) {
    const hashResult = computeGroupDslSemanticHash(reconciledGroup.group, registry, {
      groups: options.groups ?? {},
    });

    if (!hashResult.ok) {
      return hashResult;
    }

    reconciledGroup.group = {
      ...reconciledGroup.group,
      dsl: {
        source: sourceText,
        formatVersion: CURRENT_GROUP_DSL_FORMAT_VERSION,
        mode: options.dslMode === "generated" ? "generated" : "authored",
        syncStatus: "in-sync",
        lastAppliedSemanticHash: hashResult.hash,
      },
    };
  }

  return {
    ok: true,
    ast: parsed.ast,
    ir: loweredIr.ir,
    group: reconciledGroup.group,
  };
}

export function lowerParsedGroupDsl(ast, registry, options = {}) {
  return lowerGroupDsl(ast, registry, options);
}
