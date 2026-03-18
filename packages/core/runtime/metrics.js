export function createRuntimeMetrics() {
  return {
    eventsProcessed: 0,
    eventsScheduled: 0,
    queueSize: 0,
    lastTickProcessed: 0,
  };
}

export function resetRuntimeMetrics() {
  return createRuntimeMetrics();
}

export function snapshotRuntimeMetrics(metrics, queueSize) {
  return {
    eventsProcessed: metrics.eventsProcessed,
    eventsScheduled: metrics.eventsScheduled,
    queueSize,
    lastTickProcessed: metrics.lastTickProcessed,
  };
}
