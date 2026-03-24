import { clampDiscreteNodeValue } from "../nodes/behaviors/shared.js";
import { createRuntimeWarning, RUNTIME_WARNING_CODES } from "./errors.js";
import {
  cloneRuntimeState,
  createInternalPulseSeedEventAtPhase,
  createOutputEvent,
  PULSE_SOURCE_PHASE_UNITS,
  createScheduledEvent,
  createNodeRng,
  createInternalPulseEdgeId,
  hashNodeSeed,
  isInternalPulseEdgeId,
  sanitizeNodeOutput,
  sanitizeRuntimeEvent,
} from "./events.js";
import { createRuntimeMetrics, resetRuntimeMetrics, snapshotRuntimeMetrics } from "./metrics.js";
import { applyGraphPatch, cloneCompiledGraph } from "./patching.js";
import { projectNodePulseState, projectRuntimeActivity, projectThumbState } from "./presentation.js";
import { createRingBufferScheduler, SchedulerOverflowError } from "./scheduler/index.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createEmptyCompiledGraph() {
  return {
    nodes: [],
    edges: [],
    edgesByNodeId: new Map(),
    edgesByPortId: new Map(),
    nodeIndex: new Map(),
    edgeIndex: new Map(),
  };
}

function compareNodeBatches(left, right) {
  if (left.nodeIndex !== right.nodeIndex) {
    return left.nodeIndex - right.nodeIndex;
  }

  if (left.firstSequence !== right.firstSequence) {
    return left.firstSequence - right.firstSequence;
  }

  return left.nodeId.localeCompare(right.nodeId);
}

const PULSE_PHASE_EPSILON = 1e-9;

function getPulseRate(node) {
  return clampDiscreteNodeValue(node?.param, 1);
}

function getPulseStepUnits(node) {
  return PULSE_SOURCE_PHASE_UNITS / getPulseRate(node);
}

function createCompiledOutputPortId(nodeId, portSlot) {
  return `${nodeId}:out:${portSlot}`;
}

function collectPulseState(nowTick, durationTicks, pulseTicksByNodeId) {
  if (!Number.isFinite(nowTick) || !Number.isFinite(durationTicks) || durationTicks <= 0) {
    return [];
  }

  const pulses = [];

  for (const [nodeId, receivedTick] of pulseTicksByNodeId.entries()) {
    const progress = (nowTick - receivedTick) / durationTicks;

    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      continue;
    }

    pulses.push({
      nodeId,
      progress,
      receivedTick,
    });
  }

  return pulses.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export class Runtime {
  constructor(opts) {
    this.registry = opts.registry;
    this.scheduler = opts.scheduler ?? createRingBufferScheduler();
    this.minDelayTicks =
      Number.isFinite(opts.minDelayTicks) && opts.minDelayTicks > 0
        ? opts.minDelayTicks
        : 0.001;
    this.rngSeed = Number.isFinite(opts.rngSeed) ? Math.trunc(opts.rngSeed) : 0;
    this.graph = createEmptyCompiledGraph();
    this.metrics = createRuntimeMetrics();
    this.protectedUntilTick = 0;
    this.pulsePhaseOriginTick = 0;
    this.sequence = 0;
    this.warnings = [];
    this.nodeById = new Map();
    this.edgeById = new Map();
    this.outgoingEdgesByNodePort = new Map();
    this.nodeRngById = new Map();
    this.activeEvents = new Map();
    this.activeEventKeysByNodeId = new Map();
    this.activeEventKeysByEdgeId = new Map();
    this.nodePulseTicksByNodeId = new Map();
    this.presentedNodePulseTicksByNodeId = new Map();
    this.visibleNodeIds = new Set();
    this.visibleEdgeIdByCompiledEdgeId = new Map();
    this.collapsedOutputOwnerNodeIdByCompiledPortId = new Map();
    this.collapsedSinkOwnerNodeIdByCompiledNodeId = new Map();
  }

  setGraph(graph) {
    this.graph = graph ? cloneCompiledGraph(graph) : createEmptyCompiledGraph();
    this.metrics = resetRuntimeMetrics();
    this.warnings = [];
    this.protectedUntilTick = 0;
    this.pulsePhaseOriginTick = 0;
    this.sequence = 0;
    this.nodeRngById = new Map();
    this.clearSchedulerState();
    this.refreshGraphState();
    this.seedTickSources(this.protectedUntilTick);
    this.metrics.queueSize = this.getQueueSize();
  }

  resetPulses() {
    this.clearSchedulerState();
    this.sequence = 0;
    this.pulsePhaseOriginTick = this.protectedUntilTick;
    this.seedTickSources(this.protectedUntilTick);
    this.metrics.queueSize = this.getQueueSize();
  }

  queryWindow(t0Tick, t1Tick) {
    if (!Number.isFinite(t0Tick) || !Number.isFinite(t1Tick) || t1Tick <= t0Tick) {
      return [];
    }

    const outputs = [];

    while (true) {
      const nextTick = this.scheduler.peekMinTick();

      if (nextTick === null || nextTick >= t1Tick) {
        break;
      }

      const poppedEvents = this.scheduler.popUntil(nextTick);
      this.releaseActiveEvents(poppedEvents);

      const tickEvents = [];

      for (const rawEvent of poppedEvents) {
        const event = sanitizeRuntimeEvent(rawEvent, this.warnings);

        if (!event) {
          continue;
        }

        this.metrics.eventsProcessed += 1;

        if (event.tick < t0Tick && !event.__internal) {
          this.pushWarning(
            createRuntimeWarning(
              RUNTIME_WARNING_CODES.LATE_EVENT,
              `Encountered late event for node "${event.nodeId}" at tick ${event.tick}.`,
              {
                nodeId: event.nodeId,
                edgeId: event.edgeId,
              },
            ),
          );
        }

        tickEvents.push(event);
      }

      if (tickEvents.length > 0) {
        outputs.push(
          ...this.processTickEvents(tickEvents).filter((output) => output.tick >= t0Tick),
        );
      }
    }

    this.metrics.lastTickProcessed = t1Tick;
    this.protectedUntilTick = t1Tick;
    this.metrics.queueSize = this.getQueueSize();

    return outputs;
  }

  applyPatch(patch) {
    if (!patch || typeof patch !== "object") {
      return;
    }

    const { removedNodes, removedEdges, updatedEdges } = applyGraphPatch(this.graph, patch);
    const preservedActiveEdgeIds = new Set(patch.preservedActiveEdges ?? []);

    for (const nodeId of removedNodes) {
      this.scheduler.removeByNode(nodeId);
      this.dropActiveEventsForNode(nodeId);
      this.nodeRngById.delete(nodeId);
      this.nodePulseTicksByNodeId.delete(nodeId);
      this.presentedNodePulseTicksByNodeId.delete(nodeId);
    }

    for (const edgeId of removedEdges) {
      if (!preservedActiveEdgeIds.has(edgeId)) {
        this.scheduler.removeByEdge(edgeId);
        this.dropActiveEventsForEdge(edgeId);
      }
    }

    this.refreshGraphState();

    for (const [edgeId, delayChange] of updatedEdges.entries()) {
      this.reschedulePendingEdgeEvents(edgeId, delayChange.nextDelay);
    }

    for (const change of patch.updatedParams ?? []) {
      if (this.nodeById.get(change.nodeId)?.type === "pulse") {
        this.reschedulePulseSource(change.nodeId, this.protectedUntilTick, "future");
      }
    }

    if (Array.isArray(patch.addedNodes)) {
      for (const node of patch.addedNodes) {
        if (!this.nodeRngById.has(node.id)) {
          this.nodeRngById.set(node.id, createNodeRng(hashNodeSeed(this.rngSeed, node.id)));
        }
      }

      this.seedPulseSources(
        this.protectedUntilTick,
        patch.addedNodes.map((node) => node.id),
      );
    }

    this.metrics.queueSize = this.getQueueSize();
  }

  getThumbState(nowTick) {
    if (!Number.isFinite(nowTick)) {
      return [];
    }

    const thumbs = [];

    for (const event of this.activeEvents.values()) {
      if (event.__internal || isInternalPulseEdgeId(event.edgeId)) {
        continue;
      }

      const delay = event.tick - event.emitTime;

      if (!Number.isFinite(delay) || delay <= 0) {
        continue;
      }

      const progress = Math.min(1, Math.max(0, (nowTick - event.emitTime) / delay));

      thumbs.push({
        edgeId: event.edgeId,
        progress,
        speed: clampDiscreteNodeValue(event.speed),
        emitTick: event.emitTime,
      });
    }

    return thumbs.sort((left, right) => {
      if (left.edgeId !== right.edgeId) {
        return left.edgeId.localeCompare(right.edgeId);
      }

      return (left.emitTick ?? 0) - (right.emitTick ?? 0);
    });
  }

  getMetrics() {
    return snapshotRuntimeMetrics(this.metrics, this.getQueueSize());
  }

  getNodePulseState(nowTick, durationTicks) {
    return collectPulseState(nowTick, durationTicks, this.nodePulseTicksByNodeId);
  }

  getPresentedNodePulseState(nowTick, durationTicks) {
    return collectPulseState(nowTick, durationTicks, this.presentedNodePulseTicksByNodeId);
  }

  getProjectedNodePulseState(nowTick, durationTicks) {
    return projectNodePulseState(
      this.graph,
      this.getNodePulseState(nowTick, durationTicks),
    );
  }

  getProjectedThumbState(nowTick) {
    return projectThumbState(this.graph, this.getThumbState(nowTick));
  }

  getPresentedActivity(nowTick, durationTicks) {
    return projectRuntimeActivity(this.graph, {
      thumbs: this.getThumbState(nowTick),
      nodePulseStates: this.getPresentedNodePulseState(nowTick, durationTicks),
    });
  }

  clearSchedulerState() {
    if (typeof this.scheduler.clear === "function") {
      this.scheduler.clear();
    } else {
      while (this.scheduler.peekMinTick() !== null) {
        this.scheduler.popUntil(this.scheduler.peekMinTick());
      }
    }

    this.activeEvents.clear();
    this.activeEventKeysByNodeId.clear();
    this.activeEventKeysByEdgeId.clear();
    this.nodePulseTicksByNodeId.clear();
    this.presentedNodePulseTicksByNodeId.clear();
  }

  refreshGraphState() {
    this.nodeById = new Map(this.graph.nodes.map((node) => [node.id, node]));
    this.edgeById = new Map(this.graph.edges.map((edge) => [edge.id, edge]));
    this.outgoingEdgesByNodePort = new Map();
    this.visibleNodeIds = new Set(this.graph.nodes.map((node) => node.id));
    this.visibleEdgeIdByCompiledEdgeId = new Map(
      this.graph.presentation?.visibleEdgeIdByCompiledEdgeId instanceof Map
        ? this.graph.presentation.visibleEdgeIdByCompiledEdgeId
        : [],
    );
    this.collapsedOutputOwnerNodeIdByCompiledPortId = new Map();
    this.collapsedSinkOwnerNodeIdByCompiledNodeId = new Map();

    for (const edge of this.graph.edges) {
      const key = `${edge.from.nodeId}:${edge.from.portSlot}`;
      const list = this.outgoingEdgesByNodePort.get(key) ?? [];
      list.push(edge);
      this.outgoingEdgesByNodePort.set(key, list);
    }

    for (const node of this.graph.nodes) {
      if (!this.nodeRngById.has(node.id)) {
        this.nodeRngById.set(node.id, createNodeRng(hashNodeSeed(this.rngSeed, node.id)));
      }
    }

    const groupsById = this.graph.groupMeta?.groupsById;

    if (groupsById instanceof Map) {
      for (const [visibleNodeId, meta] of groupsById.entries()) {
        for (const compiledNodeId of meta?.nodeIds ?? []) {
          this.visibleNodeIds.delete(compiledNodeId);
        }

        this.visibleNodeIds.add(visibleNodeId);

        if ((meta?.externalOutputs?.length ?? 0) > 0) {
          for (const mapping of meta.externalOutputs) {
            this.collapsedOutputOwnerNodeIdByCompiledPortId.set(
              createCompiledOutputPortId(mapping.nodeId, mapping.portSlot),
              visibleNodeId,
            );
          }
          continue;
        }

        for (const compiledNodeId of meta?.nodeIds ?? []) {
          const node = this.nodeById.get(compiledNodeId);

          if (this.getNodeVisualPulseMode(node) !== "consume") {
            continue;
          }

          this.collapsedSinkOwnerNodeIdByCompiledNodeId.set(compiledNodeId, visibleNodeId);
        }
      }
    }

    for (const nodeId of Array.from(this.nodePulseTicksByNodeId.keys())) {
      if (!this.nodeById.has(nodeId)) {
        this.nodePulseTicksByNodeId.delete(nodeId);
      }
    }

    for (const nodeId of Array.from(this.presentedNodePulseTicksByNodeId.keys())) {
      if (!this.visibleNodeIds.has(nodeId)) {
        this.presentedNodePulseTicksByNodeId.delete(nodeId);
      }
    }
  }

  seedPulseSources(startTick, onlyNodeIds) {
    const targetNodeIds = onlyNodeIds ? new Set(onlyNodeIds) : null;

    for (const node of this.graph.nodes) {
      if (node.type !== "pulse") {
        continue;
      }

      if (targetNodeIds && !targetNodeIds.has(node.id)) {
        continue;
      }

      this.enqueuePulseSeedEvent(node.id, this.getPulsePhaseUnitsBeforeOrAt(node, startTick));
    }
  }

  getPulsePhaseOriginTick() {
    return Number.isFinite(this.pulsePhaseOriginTick) ? this.pulsePhaseOriginTick : 0;
  }

  pulseUnitsToTick(pulseUnits) {
    return this.getPulsePhaseOriginTick() + pulseUnits / PULSE_SOURCE_PHASE_UNITS;
  }

  getPulsePhaseUnitsBeforeOrAt(node, startTick) {
    if (!Number.isFinite(startTick)) {
      return 0;
    }

    const originTick = this.getPulsePhaseOriginTick();
    const stepUnits = getPulseStepUnits(node);

    if (startTick <= originTick) {
      return 0;
    }

    const periodsElapsed = Math.floor(
      ((startTick - originTick) * PULSE_SOURCE_PHASE_UNITS) / stepUnits + PULSE_PHASE_EPSILON,
    );

    return periodsElapsed * stepUnits;
  }

  getPulsePhaseUnitsAtOrAfter(node, startTick) {
    if (!Number.isFinite(startTick)) {
      return 0;
    }

    const originTick = this.getPulsePhaseOriginTick();
    const stepUnits = getPulseStepUnits(node);

    if (startTick <= originTick) {
      return 0;
    }

    const periodsElapsed = Math.ceil(
      ((startTick - originTick) * PULSE_SOURCE_PHASE_UNITS) / stepUnits - PULSE_PHASE_EPSILON,
    );

    return periodsElapsed * stepUnits;
  }

  getNextPulsePhaseUnits(node, startTick) {
    if (!Number.isFinite(startTick)) {
      return 0;
    }

    const originTick = this.getPulsePhaseOriginTick();
    const stepUnits = getPulseStepUnits(node);

    if (startTick < originTick) {
      return 0;
    }

    const periodsElapsed = Math.floor(
      ((startTick - originTick) * PULSE_SOURCE_PHASE_UNITS) / stepUnits + PULSE_PHASE_EPSILON,
    );

    return (periodsElapsed + 1) * stepUnits;
  }

  enqueuePulseSeedEvent(nodeId, pulseUnits) {
    this.enqueueEvent(
      createInternalPulseSeedEventAtPhase(
        nodeId,
        this.pulseUnitsToTick(pulseUnits),
        this.nextSequence(),
        pulseUnits,
      ),
    );
  }

  removePendingPulseSeedEvents(nodeId) {
    this.scheduler.removeByEdge(createInternalPulseEdgeId(nodeId));
  }

  reschedulePulseSource(nodeId, startTick, mode = "future") {
    const node = this.nodeById.get(nodeId);

    if (!node || node.type !== "pulse") {
      return;
    }

    this.removePendingPulseSeedEvents(nodeId);

    const pulseUnits =
      mode === "aligned"
        ? this.getPulsePhaseUnitsAtOrAfter(node, startTick)
        : this.getNextPulsePhaseUnits(node, startTick);

    this.enqueuePulseSeedEvent(nodeId, pulseUnits);
  }

  seedTickSources(startTick, onlyNodeIds) {
    this.seedPulseSources(startTick, onlyNodeIds);
  }

  nextSequence() {
    const sequence = this.sequence;
    this.sequence += 1;
    return sequence;
  }

  getQueueSize() {
    return typeof this.scheduler.size === "function"
      ? this.scheduler.size()
      : this.activeEvents.size;
  }

  pushWarning(warning) {
    this.warnings.push(warning);
  }

  getNodeVisualPulseMode(node) {
    if (!node) {
      return "emit";
    }

    if (node.visualPulseMode === "consume") {
      return "consume";
    }

    return node.outputs === 0 ? "consume" : "emit";
  }

  recordPresentedNodePulse(nodeId, tick) {
    if (!this.visibleNodeIds.has(nodeId)) {
      return;
    }

    this.presentedNodePulseTicksByNodeId.set(nodeId, tick);
  }

  enqueueEvent(event) {
    try {
      this.scheduler.enqueue(event);
      this.metrics.eventsScheduled += 1;

      if (!event.__internal) {
        this.trackActiveEvent(event);
      }
    } catch (error) {
      if (error instanceof SchedulerOverflowError) {
        this.pushWarning(
          createRuntimeWarning(
            RUNTIME_WARNING_CODES.QUEUE_OVERFLOW,
            "Scheduler capacity exceeded; dropped a runtime event.",
            {
              nodeId: event.nodeId,
              edgeId: event.edgeId,
            },
          ),
        );
        return;
      }

      throw error;
    }
  }

  trackActiveEvent(event) {
    this.activeEvents.set(event.__seq, event);

    const nodeSet = this.activeEventKeysByNodeId.get(event.nodeId) ?? new Set();
    nodeSet.add(event.__seq);
    this.activeEventKeysByNodeId.set(event.nodeId, nodeSet);

    const edgeSet = this.activeEventKeysByEdgeId.get(event.edgeId) ?? new Set();
    edgeSet.add(event.__seq);
    this.activeEventKeysByEdgeId.set(event.edgeId, edgeSet);
  }

  releaseActiveEvents(events) {
    for (const event of events) {
      if (event.__internal) {
        continue;
      }

      this.activeEvents.delete(event.__seq);
      const nodeSet = this.activeEventKeysByNodeId.get(event.nodeId);
      nodeSet?.delete(event.__seq);

      if (nodeSet?.size === 0) {
        this.activeEventKeysByNodeId.delete(event.nodeId);
      }

      const edgeSet = this.activeEventKeysByEdgeId.get(event.edgeId);
      edgeSet?.delete(event.__seq);

      if (edgeSet?.size === 0) {
        this.activeEventKeysByEdgeId.delete(event.edgeId);
      }
    }
  }

  dropActiveEventsForNode(nodeId) {
    const keys = this.activeEventKeysByNodeId.get(nodeId);

    if (!keys) {
      return;
    }

    for (const key of keys) {
      const event = this.activeEvents.get(key);

      if (!event) {
        continue;
      }

      this.activeEvents.delete(key);
      const edgeSet = this.activeEventKeysByEdgeId.get(event.edgeId);
      edgeSet?.delete(key);

      if (edgeSet?.size === 0) {
        this.activeEventKeysByEdgeId.delete(event.edgeId);
      }
    }

    this.activeEventKeysByNodeId.delete(nodeId);
  }

  dropActiveEventsForEdge(edgeId) {
    const keys = this.activeEventKeysByEdgeId.get(edgeId);

    if (!keys) {
      return;
    }

    for (const key of keys) {
      const event = this.activeEvents.get(key);

      if (!event) {
        continue;
      }

      this.activeEvents.delete(key);
      const nodeSet = this.activeEventKeysByNodeId.get(event.nodeId);
      nodeSet?.delete(key);

      if (nodeSet?.size === 0) {
        this.activeEventKeysByNodeId.delete(event.nodeId);
      }
    }

    this.activeEventKeysByEdgeId.delete(edgeId);
  }

  reschedulePendingEdgeEvents(edgeId, nextDelay) {
    const keys = this.activeEventKeysByEdgeId.get(edgeId);

    if (!keys || keys.size === 0) {
      return;
    }

    const pendingEvents = Array.from(keys)
      .map((key) => this.activeEvents.get(key))
      .filter(Boolean)
      .sort((left, right) => (left.__seq ?? 0) - (right.__seq ?? 0));

    this.scheduler.removeByEdge(edgeId);
    this.dropActiveEventsForEdge(edgeId);

    for (const event of pendingEvents) {
      const existingTick = event.tick;
      const candidateTick =
        event.emitTime +
        Math.max(
          Number.isFinite(nextDelay)
            ? nextDelay / clampDiscreteNodeValue(event.speed, 1)
            : nextDelay,
          this.minDelayTicks,
        );

      const nextTick =
        existingTick <= this.protectedUntilTick || candidateTick <= this.protectedUntilTick
          ? existingTick
          : candidateTick;

      this.enqueueEvent({
        ...event,
        tick: nextTick,
      });
    }
  }

  processTickEvents(events) {
    const byNodeId = new Map();

    for (const event of events) {
      const entry = byNodeId.get(event.nodeId);

      if (entry) {
        entry.events.push(event);
        continue;
      }

      byNodeId.set(event.nodeId, {
        nodeId: event.nodeId,
        nodeIndex: this.graph.nodeIndex.get(event.nodeId) ?? Number.POSITIVE_INFINITY,
        firstSequence: event.__seq ?? 0,
        events: [event],
      });
    }

    const outputs = [];

    for (const batch of Array.from(byNodeId.values()).sort(compareNodeBatches)) {
      outputs.push(...this.processNodeEventGroup(batch.nodeId, batch.events));
    }

    return outputs;
  }

  processNodeEventGroup(nodeId, events) {
    const node = this.nodeById.get(nodeId);

    if (!node) {
      for (const event of events) {
        this.pushWarning(
          createRuntimeWarning(
            RUNTIME_WARNING_CODES.MISSING_NODE,
            `Dropped event for missing node "${event.nodeId}".`,
            {
              nodeId: event.nodeId,
              edgeId: event.edgeId,
            },
          ),
        );
      }
      return [];
    }

    const definition = this.registry.getNodeDefinition(node.type);

    if (!definition) {
      for (const event of events) {
        this.pushWarning(
          createRuntimeWarning(
            RUNTIME_WARNING_CODES.MISSING_TYPE,
            `Dropped event for node "${event.nodeId}" with missing type "${node.type}".`,
            {
              nodeId: event.nodeId,
              edgeId: event.edgeId,
            },
          ),
        );
      }
      return [];
    }

    const outputs = [];
    const controls = [];
    const signals = [];

    for (const event of events) {
      if (event.role === "control") {
        controls.push(event);
      } else if (event.role === "signal") {
        signals.push(event);
      }
    }

    const previousPulseRate = node.type === "pulse" ? getPulseRate(node) : null;

    for (const controlEvent of controls) {
      this.applyControlEvent(node, definition, controlEvent);
    }

    if (
      node.type === "pulse" &&
      previousPulseRate !== getPulseRate(node) &&
      !signals.some((event) => isInternalPulseEdgeId(event.edgeId))
    ) {
      this.reschedulePulseSource(node.id, events[0]?.tick ?? this.protectedUntilTick, "future");
    }

    for (const signalEvent of signals) {
      outputs.push(...this.applySignalEvent(node, definition, signalEvent));
    }

    return outputs;
  }

  buildBehaviorContext(node, event, inPortIndex) {
    return {
      tick: event.tick,
      inPortIndex,
      param: clampDiscreteNodeValue(node.param),
      state: cloneRuntimeState(node.state),
      nodeId: node.id,
      rng: this.nodeRngById.get(node.id),
      pulse: {
        value: clampDiscreteNodeValue(event.value),
        speed: clampDiscreteNodeValue(event.speed, 1),
        ...(event.params ? { params: event.params } : {}),
      },
    };
  }

  getTargetPortSlot(event) {
    if (isInternalPulseEdgeId(event.edgeId)) {
      return 0;
    }

    const edge = this.edgeById.get(event.edgeId);

    if (!edge) {
      this.pushWarning(
        createRuntimeWarning(
          RUNTIME_WARNING_CODES.MISSING_EDGE,
          `Dropped event for missing edge "${event.edgeId}".`,
          {
            nodeId: event.nodeId,
            edgeId: event.edgeId,
          },
        ),
      );
      return null;
    }

    return edge.to.portSlot;
  }

  applyControlEvent(node, definition, event) {
    const targetPortSlot = this.getTargetPortSlot(event);

    if (targetPortSlot === null) {
      return;
    }

    if (typeof definition.onControl !== "function") {
      node.param = clampDiscreteNodeValue(event.value);
      return;
    }

    const result = definition.onControl(
      this.buildBehaviorContext(node, event, targetPortSlot),
    );

    if (isPlainObject(result?.state)) {
      node.state = cloneRuntimeState(result.state);
    }

    if (Number.isFinite(result?.param)) {
      node.param = clampDiscreteNodeValue(result.param);
    }

  }

  applySignalEvent(node, definition, event) {
    const targetPortSlot = this.getTargetPortSlot(event);

    if (targetPortSlot === null) {
      return [];
    }

    this.nodePulseTicksByNodeId.set(node.id, event.tick);

    if (this.getNodeVisualPulseMode(node) === "consume") {
      this.recordPresentedNodePulse(node.id, event.tick);
      const collapsedOwnerNodeId =
        this.collapsedSinkOwnerNodeIdByCompiledNodeId.get(node.id);

      if (collapsedOwnerNodeId) {
        this.recordPresentedNodePulse(collapsedOwnerNodeId, event.tick);
      }
    }

    if (node.type === "out") {
      return [createOutputEvent(event, node.id)];
    }

    const result = definition.onSignal(
      this.buildBehaviorContext(node, event, targetPortSlot),
    ) ?? { outputs: [] };

    if (isPlainObject(result.state)) {
      node.state = cloneRuntimeState(result.state);
    }

    const outputs = [];
    const emitted = Array.isArray(result.outputs) ? result.outputs : [];
    let didEmit = false;

    for (const rawOutput of emitted) {
      const output = sanitizeNodeOutput(rawOutput, event, this.warnings, {
        nodeId: node.id,
        edgeId: event.edgeId,
      });

      if (!output) {
        continue;
      }

      didEmit = true;
      this.scheduleNodeOutput(node, event, output);
    }

    if (didEmit && this.getNodeVisualPulseMode(node) === "emit") {
      this.recordPresentedNodePulse(node.id, event.tick);
    }

    if (isInternalPulseEdgeId(event.edgeId) && node.type === "pulse") {
      this.enqueuePulseSeedEvent(
        node.id,
        (Number.isInteger(event.__pulseUnits) ? event.__pulseUnits : 0) + getPulseStepUnits(node),
      );
    }

    return outputs;
  }

  scheduleNodeOutput(node, sourceEvent, output) {
    const portKey = `${node.id}:${output.outPortIndex}`;
    const outgoingEdges = this.outgoingEdgesByNodePort.get(portKey) ?? [];
    const collapsedOwnerNodeId =
      this.collapsedOutputOwnerNodeIdByCompiledPortId.get(
        createCompiledOutputPortId(node.id, output.outPortIndex),
      );
    const hasVisibleExternalEmission =
      collapsedOwnerNodeId &&
      outgoingEdges.some((edge) => this.visibleEdgeIdByCompiledEdgeId.has(edge.id));

    if (hasVisibleExternalEmission) {
      this.recordPresentedNodePulse(collapsedOwnerNodeId, sourceEvent.tick);
    }

    for (const edge of outgoingEdges) {
      const scheduledDelay = Math.max(
        edge.delay / clampDiscreteNodeValue(output.speed, 1),
        this.minDelayTicks,
      );

      this.enqueueEvent(
        createScheduledEvent({
          tick: sourceEvent.tick + scheduledDelay,
          nodeId: edge.to.nodeId,
          edgeId: edge.id,
          role: edge.role,
          value: output.value,
          speed: output.speed,
          params: output.params,
          emitTime: sourceEvent.tick,
          sequence: this.nextSequence(),
        }),
      );
    }
  }
}
