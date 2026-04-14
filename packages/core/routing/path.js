import { ROUTING_BEND_PREFERENCES } from "./constants.js";

const DIRECTION_VECTORS = Object.freeze([
  { key: "right", x: 1, y: 0 },
  { key: "left", x: -1, y: 0 },
  { key: "down", x: 0, y: 1 },
  { key: "up", x: 0, y: -1 },
]);

function samePoint(a, b) {
  return a.x === b.x && a.y === b.y;
}

function translate(point, vector, amount) {
  return {
    x: point.x + vector.x * amount,
    y: point.y + vector.y * amount,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function resolveSegmentPreference(start, end, bendPreference) {
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);

  if (dx > dy) {
    return ROUTING_BEND_PREFERENCES.HORIZONTAL_FIRST;
  }

  if (dy > dx) {
    return ROUTING_BEND_PREFERENCES.VERTICAL_FIRST;
  }

  return bendPreference;
}

function createPointKey(point) {
  return `${point.x},${point.y}`;
}

function createStateKey(point, directionKey) {
  return `${createPointKey(point)}|${directionKey ?? "*"}`;
}

function createSegmentKey(a, b) {
  if (a.x === b.x) {
    return a.y <= b.y
      ? `${a.x},${a.y}|${b.x},${b.y}`
      : `${b.x},${b.y}|${a.x},${a.y}`;
  }

  return a.x <= b.x
    ? `${a.x},${a.y}|${b.x},${b.y}`
    : `${b.x},${b.y}|${a.x},${a.y}`;
}

function getDirectionKey(vector) {
  const match = DIRECTION_VECTORS.find(
    (candidate) => candidate.x === vector.x && candidate.y === vector.y,
  );

  return match?.key ?? null;
}

function getDirectionVector(directionKey) {
  return DIRECTION_VECTORS.find((candidate) => candidate.key === directionKey) ?? null;
}

function getAxisDirections(preference, current, target) {
  const horizontalDirections =
    target.x >= current.x ? ["right", "left"] : ["left", "right"];
  const verticalDirections =
    target.y >= current.y ? ["down", "up"] : ["up", "down"];

  return preference === ROUTING_BEND_PREFERENCES.VERTICAL_FIRST
    ? [...verticalDirections, ...horizontalDirections]
    : [...horizontalDirections, ...verticalDirections];
}

function getNeighborOrder(current, target, bendPreference, currentDirectionKey) {
  const preference = resolveSegmentPreference(current, target, bendPreference);
  const ordered = getAxisDirections(preference, current, target);

  if (!currentDirectionKey) {
    return ordered;
  }

  return [
    currentDirectionKey,
    ...ordered.filter((directionKey) => directionKey !== currentDirectionKey),
  ];
}

function selectFrontierIndex(frontier) {
  let bestIndex = 0;

  for (let index = 1; index < frontier.length; index += 1) {
    const candidate = frontier[index];
    const best = frontier[bestIndex];

    if (candidate.priority < best.priority) {
      bestIndex = index;
      continue;
    }

    if (candidate.priority > best.priority) {
      continue;
    }

    if (candidate.bends < best.bends) {
      bestIndex = index;
      continue;
    }

    if (candidate.bends > best.bends) {
      continue;
    }

    if (candidate.length < best.length) {
      bestIndex = index;
      continue;
    }

    if (candidate.length > best.length) {
      continue;
    }

    if (candidate.insertionOrder < best.insertionOrder) {
      bestIndex = index;
    }
  }

  return bestIndex;
}

function createPathEntry(point, { locked = false } = {}) {
  return {
    point,
    locked,
  };
}

function appendPathEntry(entries, point, { locked = false } = {}) {
  if (!Array.isArray(entries)) {
    return;
  }

  const lastEntry = entries.at(-1);

  if (lastEntry && samePoint(lastEntry.point, point)) {
    lastEntry.locked = lastEntry.locked || locked;
    return;
  }

  entries.push(createPathEntry(point, { locked }));
}

function simplifyOrthogonalEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 3) {
    return entries ?? [];
  }

  const simplified = [entries[0]];

  for (let index = 1; index < entries.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = entries[index];
    const next = entries[index + 1];

    if (current.locked) {
      simplified.push(current);
      continue;
    }

    const sameHorizontal =
      previous.point.y === current.point.y &&
      current.point.y === next.point.y;
    const sameVertical =
      previous.point.x === current.point.x &&
      current.point.x === next.point.x;

    if (sameHorizontal || sameVertical) {
      continue;
    }

    simplified.push(current);
  }

  simplified.push(entries.at(-1));
  return simplified;
}

function normalizeRouteEntries(entries) {
  const normalized = [];

  for (const entry of entries) {
    appendPathEntry(normalized, entry.point, { locked: entry.locked });
  }

  return simplifyOrthogonalEntries(normalized);
}

function normalizeRoutePoints(entries) {
  return normalizeRouteEntries(entries).map((entry) => entry.point);
}

function isPointOnOrthogonalSegment(point, start, end) {
  if (start.x === end.x) {
    return (
      point.x === start.x &&
      point.y >= Math.min(start.y, end.y) &&
      point.y <= Math.max(start.y, end.y)
    );
  }

  if (start.y === end.y) {
    return (
      point.y === start.y &&
      point.x >= Math.min(start.x, end.x) &&
      point.x <= Math.max(start.x, end.x)
    );
  }

  return false;
}

function getOrthogonalSegmentLength(start, end) {
  return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
}

function getDistanceFromSegmentStart(start, point) {
  return Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
}

export function getOrthogonalRouteDistanceAtPoint(
  points,
  point,
  { minimumDistance = -Infinity } = {},
) {
  if (
    !Array.isArray(points) ||
    points.length < 2 ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return null;
  }

  let traversed = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];

    if (isPointOnOrthogonalSegment(point, start, end)) {
      const distance = traversed + getDistanceFromSegmentStart(start, point);

      if (distance >= minimumDistance) {
        return {
          distance,
          segmentIndex: index - 1,
        };
      }
    }

    traversed += getOrthogonalSegmentLength(start, end);
  }

  return null;
}

function createRoutingBounds(obstacles, points, margin) {
  const xs = [];
  const ys = [];

  for (const point of points) {
    xs.push(point.x);
    ys.push(point.y);
  }

  for (const obstacle of obstacles) {
    xs.push(obstacle.x0, obstacle.x1);
    ys.push(obstacle.y0, obstacle.y1);
  }

  return {
    minX: Math.min(...xs) - margin,
    maxX: Math.max(...xs) + margin,
    minY: Math.min(...ys) - margin,
    maxY: Math.max(...ys) + margin,
  };
}

function createObstacleGrid(obstacles) {
  const invalidPoints = new Set();
  const blockedSegments = new Set();

  for (const obstacle of obstacles) {
    for (let x = obstacle.x0; x <= obstacle.x1; x += 1) {
      for (let y = obstacle.y0; y <= obstacle.y1; y += 1) {
        invalidPoints.add(`${x},${y}`);
      }
    }

    for (let x = obstacle.x0; x < obstacle.x1; x += 1) {
      for (let y = obstacle.y0; y <= obstacle.y1; y += 1) {
        blockedSegments.add(createSegmentKey({ x, y }, { x: x + 1, y }));
      }
    }

    for (let x = obstacle.x0; x <= obstacle.x1; x += 1) {
      for (let y = obstacle.y0; y < obstacle.y1; y += 1) {
        blockedSegments.add(createSegmentKey({ x, y }, { x, y: y + 1 }));
      }
    }
  }

  return {
    invalidPoints,
    blockedSegments,
  };
}

function isAllowedFixedPoint(point, allowedAnchors) {
  return allowedAnchors.some((anchor) => samePoint(anchor, point));
}

function validateFixedSegment(start, end, grid, allowedAnchors) {
  if (samePoint(start, end)) {
    return !isPointBlocked(start, grid, createPointKey(start), createPointKey(start));
  }

  const step = {
    x: Math.sign(end.x - start.x),
    y: Math.sign(end.y - start.y),
  };
  let current = start;

  while (!samePoint(current, end)) {
    const next = {
      x: current.x + step.x,
      y: current.y + step.y,
    };

    if (isSegmentBlocked(current, next, grid)) {
      return false;
    }

    if (grid.invalidPoints.has(createPointKey(next)) && !isAllowedFixedPoint(next, allowedAnchors)) {
      return false;
    }

    current = next;
  }

  return true;
}

function isPointBlocked(point, grid, startKey, endKey) {
  const pointKey = createPointKey(point);

  if (pointKey === startKey || pointKey === endKey) {
    return false;
  }

  return grid.invalidPoints.has(pointKey);
}

function isSegmentBlocked(start, end, grid) {
  return grid.blockedSegments.has(createSegmentKey(start, end));
}

function reconstructPath(previousStateByKey, terminalState) {
  const points = [];
  let state = terminalState;

  while (state) {
    points.push(state.point);
    state = previousStateByKey.get(state.stateKey) ?? null;
  }

  points.reverse();
  return points;
}

function findOrthogonalSegmentPath({
  start,
  end,
  initialDirectionKey,
  bendPreference,
  bounds,
  grid,
}) {
  if (samePoint(start, end)) {
    return [start];
  }

  const startKey = createPointKey(start);
  const endKey = createPointKey(end);
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const bendWeight = width * height + 1;
  const bestCostByState = new Map();
  const previousStateByKey = new Map();
  const frontier = [];
  let insertionOrder = 0;
  const startStateKey = createStateKey(start, initialDirectionKey);

  frontier.push({
    point: start,
    directionKey: initialDirectionKey,
    bends: 0,
    length: 0,
    priority: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
    insertionOrder,
    stateKey: startStateKey,
  });
  bestCostByState.set(startStateKey, { bends: 0, length: 0 });
  previousStateByKey.set(startStateKey, null);

  while (frontier.length > 0) {
    const frontierIndex = selectFrontierIndex(frontier);
    const current = frontier.splice(frontierIndex, 1)[0];
    const currentBest = bestCostByState.get(current.stateKey);

    if (
      !currentBest ||
      currentBest.bends !== current.bends ||
      currentBest.length !== current.length
    ) {
      continue;
    }

    if (samePoint(current.point, end)) {
      return reconstructPath(previousStateByKey, current);
    }

    const neighborOrder = getNeighborOrder(
      current.point,
      end,
      bendPreference,
      current.directionKey,
    );

    for (const directionKey of neighborOrder) {
      const directionVector = getDirectionVector(directionKey);
      const nextPoint = {
        x: current.point.x + directionVector.x,
        y: current.point.y + directionVector.y,
      };

      if (
        nextPoint.x < bounds.minX ||
        nextPoint.x > bounds.maxX ||
        nextPoint.y < bounds.minY ||
        nextPoint.y > bounds.maxY
      ) {
        continue;
      }

      if (isPointBlocked(nextPoint, grid, startKey, endKey)) {
        continue;
      }

      if (isSegmentBlocked(current.point, nextPoint, grid)) {
        continue;
      }

      const bends =
        current.bends +
        (current.directionKey && current.directionKey !== directionKey ? 1 : 0);
      const length = current.length + 1;
      const stateKey = createStateKey(nextPoint, directionKey);
      const previousBest = bestCostByState.get(stateKey);
      const isBetter =
        !previousBest ||
        bends < previousBest.bends ||
        (bends === previousBest.bends && length < previousBest.length);

      if (!isBetter) {
        continue;
      }

      bestCostByState.set(stateKey, { bends, length });
      previousStateByKey.set(stateKey, current);
      insertionOrder += 1;
      frontier.push({
        point: nextPoint,
        directionKey,
        bends,
        length,
        priority:
          bends * bendWeight +
          length +
          Math.abs(end.x - nextPoint.x) +
          Math.abs(end.y - nextPoint.y),
        insertionOrder,
        stateKey,
      });
    }
  }

  return null;
}

export function clampStubLength(anchor, outward, target, desiredLength) {
  if (desiredLength === 0 || samePoint(anchor, target)) {
    return 0;
  }

  const available = dot(subtract(target, anchor), outward);

  return clamp(available, 0, desiredLength);
}

export function clampOpposingAlignedStubs(
  startAnchor,
  startOutward,
  startLength,
  endAnchor,
  endOutward,
  endLength,
) {
  const oppositeNormals =
    startOutward.x === -endOutward.x && startOutward.y === -endOutward.y;
  const horizontalAlignment = startAnchor.y === endAnchor.y && startOutward.y === 0;
  const verticalAlignment = startAnchor.x === endAnchor.x && startOutward.x === 0;

  if (!oppositeNormals || (!horizontalAlignment && !verticalAlignment)) {
    return {
      startLength,
      endLength,
    };
  }

  const gap =
    horizontalAlignment
      ? Math.abs(endAnchor.x - startAnchor.x)
      : Math.abs(endAnchor.y - startAnchor.y);
  const maxEach = Math.floor(gap / 2);

  return {
    startLength: Math.min(startLength, maxEach),
    endLength: Math.min(endLength, maxEach),
  };
}

export function buildOrthogonalRoute({
  startAnchor,
  startOutward,
  endAnchor,
  endOutward,
  manualCorners,
  stubLength,
  bendPreference,
  obstacles = [],
}) {
  const firstTarget = manualCorners[0] ?? endAnchor;
  const lastSource = manualCorners[manualCorners.length - 1] ?? startAnchor;
  let startLength = clampStubLength(
    startAnchor,
    startOutward,
    firstTarget,
    stubLength,
  );
  let endLength = clampStubLength(
    endAnchor,
    endOutward,
    lastSource,
    stubLength,
  );

  if (manualCorners.length === 0) {
    const clamped = clampOpposingAlignedStubs(
      startAnchor,
      startOutward,
      startLength,
      endAnchor,
      endOutward,
      endLength,
    );

    startLength = clamped.startLength;
    endLength = clamped.endLength;
  }

  const startStub = translate(startAnchor, startOutward, startLength);
  const endStub = translate(endAnchor, endOutward, endLength);
  const segmentTargets = [...manualCorners, endStub];
  const allPoints = [startAnchor, startStub, endStub, endAnchor, ...manualCorners];
  const bounds = createRoutingBounds(obstacles, allPoints, stubLength + 2);
  const grid = createObstacleGrid(obstacles);
  const path = [createPathEntry(startAnchor)];

  if (!validateFixedSegment(startAnchor, startStub, grid, [startAnchor])) {
    return null;
  }

  if (!validateFixedSegment(endStub, endAnchor, grid, [endAnchor])) {
    return null;
  }

  if (!samePoint(startStub, startAnchor)) {
    appendPathEntry(path, startStub);
  }

  let current = startStub;
  let currentDirectionKey = startLength > 0 ? getDirectionKey(startOutward) : null;

  for (let targetIndex = 0; targetIndex < segmentTargets.length; targetIndex += 1) {
    const target = segmentTargets[targetIndex];
    const targetIsManualCorner = targetIndex < manualCorners.length;
    const segment = findOrthogonalSegmentPath({
      start: current,
      end: target,
      initialDirectionKey: currentDirectionKey,
      bendPreference,
      bounds,
      grid,
    });

    if (!segment) {
      return null;
    }

    for (let segmentIndex = 1; segmentIndex < segment.length; segmentIndex += 1) {
      const point = segment[segmentIndex];
      appendPathEntry(path, point, {
        locked: targetIsManualCorner && segmentIndex === segment.length - 1,
      });
    }

    if (segment.length >= 2) {
      currentDirectionKey = getDirectionKey({
        x: segment.at(-1).x - segment.at(-2).x,
        y: segment.at(-1).y - segment.at(-2).y,
      });
    }

    current = target;
  }

  if (!samePoint(endStub, endAnchor)) {
    appendPathEntry(path, endAnchor);
  }

  return normalizeRoutePoints(path);
}
