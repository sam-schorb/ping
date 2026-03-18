import { buildGraphIndexes, cloneGraphIndexes } from "./indexes.js";
import {
  createGraphModelLoadError,
  createGraphOpError,
} from "./errors.js";
import { applyGraphOp } from "./ops.js";
import {
  cloneGraphSnapshot,
  createEmptyGraphSnapshot,
  normalizeGraphSnapshot,
} from "./snapshot.js";

export class GraphModel {
  constructor(opts) {
    if (!opts || typeof opts.getNodeDefinition !== "function") {
      throw new Error("GraphModel requires getNodeDefinition(type).");
    }

    this.getNodeDefinition = opts.getNodeDefinition;
    this.listeners = new Set();

    const normalized = normalizeGraphSnapshot(
      opts.snapshot ?? createEmptyGraphSnapshot(),
      this.getNodeDefinition,
      { source: "load" },
    );

    if (normalized.issue) {
      throw createGraphModelLoadError([normalized.issue]);
    }

    const indexes = buildGraphIndexes(normalized.snapshot, this.getNodeDefinition);

    if (indexes.issue) {
      throw createGraphModelLoadError([indexes.issue]);
    }

    this.snapshot = normalized.snapshot;
    this.indexes = indexes.indexes;
  }

  applyOps(ops) {
    if (!Array.isArray(ops)) {
      return {
        ok: false,
        changed: false,
        errors: [
          createGraphOpError(
            {
              code: "MODEL_INVALID_OPERATION",
              message: "applyOps expects an array of ops.",
            },
            -1,
            "applyOps",
          ),
        ],
      };
    }

    if (ops.length === 0) {
      return {
        ok: true,
        changed: false,
      };
    }

    const draftSnapshot = cloneGraphSnapshot(this.snapshot);
    let changed = false;
    let latestIndexes = this.indexes;

    for (let opIndex = 0; opIndex < ops.length; opIndex += 1) {
      const op = ops[opIndex];
      const opResult = applyGraphOp(draftSnapshot, op, opIndex, {
        getNodeDefinition: this.getNodeDefinition,
      });

      if (opResult.error) {
        return {
          ok: false,
          changed: false,
          errors: [opResult.error],
        };
      }

      const indexResult = buildGraphIndexes(draftSnapshot, this.getNodeDefinition);

      if (indexResult.issue) {
        return {
          ok: false,
          changed: false,
          errors: [createGraphOpError(indexResult.issue, opIndex, op.type)],
        };
      }

      latestIndexes = indexResult.indexes;
      changed = changed || Boolean(opResult.changed);
    }

    if (!changed) {
      return {
        ok: true,
        changed: false,
      };
    }

    this.snapshot = draftSnapshot;
    this.indexes = latestIndexes;

    for (const listener of this.listeners) {
      listener({ ops });
    }

    return {
      ok: true,
      changed: true,
    };
  }

  getSnapshot() {
    return cloneGraphSnapshot(this.snapshot);
  }

  getIndexes() {
    return cloneGraphIndexes(this.indexes);
  }

  onChange(cb) {
    this.listeners.add(cb);

    return () => {
      this.listeners.delete(cb);
    };
  }
}
