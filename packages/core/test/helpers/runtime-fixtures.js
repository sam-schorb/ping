import { readFile } from "node:fs/promises";

import { Runtime, createRingBufferScheduler, getNodeDefinition } from "../../src/index.js";

const FIXTURE_ROOT = new URL("../fixtures/runtime/", import.meta.url);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]),
    );
  }

  return value;
}

function cloneCompiledNode(node) {
  return {
    id: node.id,
    type: node.type,
    param: node.param,
    state: cloneValue(node.state),
    inputs: node.inputs,
    outputs: node.outputs,
    controlPorts: node.controlPorts,
  };
}

function cloneCompiledEdge(edge) {
  return {
    id: edge.id,
    from: { ...edge.from },
    to: { ...edge.to },
    role: edge.role,
    delay: edge.delay,
  };
}

function createGroupMeta(groupMeta) {
  if (!groupMeta?.groupsById) {
    return undefined;
  }

  return {
    groupsById: new Map(
      groupMeta.groupsById.map(([groupId, meta]) => [
        groupId,
        {
          nodeIds: [...meta.nodeIds],
          edgeIds: [...(meta.edgeIds ?? [])],
          externalInputs: meta.externalInputs.map((entry) => ({ ...entry })),
          externalOutputs: meta.externalOutputs.map((entry) => ({ ...entry })),
          controls: meta.controls.map((entry) => ({ ...entry })),
        },
      ]),
    ),
  };
}

function createDebugMaps(debug) {
  if (!debug) {
    return undefined;
  }

  return {
    nodeIdToSourceId: new Map(debug.nodeIdToSourceId ?? []),
    edgeIdToSourceId: new Map(debug.edgeIdToSourceId ?? []),
  };
}

function createPresentationMaps(presentation) {
  if (!presentation) {
    return undefined;
  }

  return {
    visibleNodeIdByCompiledNodeId: new Map(
      presentation.visibleNodeIdByCompiledNodeId ?? [],
    ),
    visibleEdgeIdByCompiledEdgeId: new Map(
      presentation.visibleEdgeIdByCompiledEdgeId ?? [],
    ),
    collapsedOwnerNodeIdByCompiledEdgeId: new Map(
      presentation.collapsedOwnerNodeIdByCompiledEdgeId ?? [],
    ),
  };
}

export function createCompiledGraph(data) {
  const nodes = data.nodes.map(cloneCompiledNode);
  const edges = data.edges.map(cloneCompiledEdge);
  const edgesByNodeId = new Map(nodes.map((node) => [node.id, []]));
  const edgesByPortId = new Map();

  for (const edge of edges) {
    edgesByNodeId.get(edge.from.nodeId)?.push(edge.id);
    edgesByNodeId.get(edge.to.nodeId)?.push(edge.id);
    edgesByPortId.set(`${edge.from.nodeId}:out:${edge.from.portSlot}`, edge.id);
    edgesByPortId.set(`${edge.to.nodeId}:in:${edge.to.portSlot}`, edge.id);
  }

  return {
    nodes,
    edges,
    edgesByNodeId,
    edgesByPortId,
    nodeIndex: new Map(nodes.map((node, index) => [node.id, index])),
    edgeIndex: new Map(edges.map((edge, index) => [edge.id, index])),
    ...(createGroupMeta(data.groupMeta) ? { groupMeta: createGroupMeta(data.groupMeta) } : {}),
    ...(createPresentationMaps(data.presentation)
      ? { presentation: createPresentationMaps(data.presentation) }
      : {}),
    ...(createDebugMaps(data.debug) ? { debug: createDebugMaps(data.debug) } : {}),
  };
}

export async function loadRuntimeFixture(name) {
  const fixtureText = await readFile(new URL(name, FIXTURE_ROOT), "utf8");
  return createCompiledGraph(JSON.parse(fixtureText));
}

export function createRuntime(graph, options = {}) {
  const runtime = new Runtime({
    registry: { getNodeDefinition },
    scheduler:
      options.scheduler ??
      createRingBufferScheduler(options.schedulerOptions),
    minDelayTicks: options.minDelayTicks,
    rngSeed: options.rngSeed,
  });

  runtime.setGraph(graph);
  return runtime;
}

export function enqueueRuntimeEvent(runtime, event) {
  runtime.enqueueEvent({
    ...event,
    __seq: runtime.nextSequence(),
  });
}
