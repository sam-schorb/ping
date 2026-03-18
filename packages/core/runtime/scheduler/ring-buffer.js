import { RUNTIME_WARNING_CODES } from "../errors.js";

function compareEvents(a, b) {
  if (a.tick !== b.tick) {
    return a.tick - b.tick;
  }

  return (a.__seq ?? 0) - (b.__seq ?? 0);
}

function insertSorted(list, event) {
  let low = 0;
  let high = list.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (compareEvents(list[mid], event) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  list.splice(low, 0, event);
}

function insertBucketKey(bucketKeys, bucketKey) {
  if (bucketKeys.includes(bucketKey)) {
    return;
  }

  let low = 0;
  let high = bucketKeys.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (bucketKeys[mid] < bucketKey) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  bucketKeys.splice(low, 0, bucketKey);
}

function removeBucketKey(bucketKeys, bucketKey) {
  const index = bucketKeys.indexOf(bucketKey);

  if (index >= 0) {
    bucketKeys.splice(index, 1);
  }
}

export class SchedulerOverflowError extends Error {
  constructor(message = "Scheduler capacity exceeded.") {
    super(message);
    this.name = "SchedulerOverflowError";
    this.code = RUNTIME_WARNING_CODES.QUEUE_OVERFLOW;
  }
}

export function createRingBufferScheduler(options = {}) {
  const maxEvents =
    Number.isInteger(options.maxEvents) && options.maxEvents > 0
      ? options.maxEvents
      : 16384;
  const buckets = new Map();
  const bucketKeys = [];
  let size = 0;

  function getBucket(bucketKey) {
    let bucket = buckets.get(bucketKey);

    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
      insertBucketKey(bucketKeys, bucketKey);
    }

    return bucket;
  }

  function cleanupBucket(bucketKey, bucket) {
    if (bucket.length === 0) {
      buckets.delete(bucketKey);
      removeBucketKey(bucketKeys, bucketKey);
    }
  }

  function filterBuckets(predicate) {
    for (const bucketKey of [...bucketKeys]) {
      const bucket = buckets.get(bucketKey);

      if (!bucket) {
        continue;
      }

      const nextBucket = bucket.filter(predicate);
      size -= bucket.length - nextBucket.length;

      if (nextBucket.length > 0) {
        buckets.set(bucketKey, nextBucket);
        continue;
      }

      buckets.delete(bucketKey);
      removeBucketKey(bucketKeys, bucketKey);
    }
  }

  return {
    enqueue(event) {
      if (size >= maxEvents) {
        throw new SchedulerOverflowError();
      }

      const bucketKey = Math.floor(event.tick);
      const bucket = getBucket(bucketKey);
      insertSorted(bucket, event);
      size += 1;
    },

    popUntil(tick) {
      const popped = [];

      for (const bucketKey of [...bucketKeys]) {
        if (bucketKey > Math.floor(tick)) {
          break;
        }

        const bucket = buckets.get(bucketKey);

        if (!bucket) {
          continue;
        }

        if (bucketKey < Math.floor(tick)) {
          popped.push(...bucket);
          size -= bucket.length;
          buckets.delete(bucketKey);
          removeBucketKey(bucketKeys, bucketKey);
          continue;
        }

        let splitIndex = 0;

        while (splitIndex < bucket.length && bucket[splitIndex].tick <= tick) {
          splitIndex += 1;
        }

        if (splitIndex > 0) {
          popped.push(...bucket.slice(0, splitIndex));
          size -= splitIndex;
          buckets.set(bucketKey, bucket.slice(splitIndex));
          cleanupBucket(bucketKey, buckets.get(bucketKey));
        }
      }

      return popped;
    },

    removeByNode(nodeId) {
      filterBuckets((event) => event.nodeId !== nodeId);
    },

    removeByEdge(edgeId) {
      filterBuckets((event) => event.edgeId !== edgeId);
    },

    peekMinTick() {
      const firstBucketKey = bucketKeys[0];

      if (firstBucketKey === undefined) {
        return null;
      }

      return buckets.get(firstBucketKey)?.[0]?.tick ?? null;
    },

    size() {
      return size;
    },

    clear() {
      buckets.clear();
      bucketKeys.length = 0;
      size = 0;
    },
  };
}
