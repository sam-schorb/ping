import { buildGraphIndexes, normalizeGraphSnapshot } from "../graph/index.js";
import { getNodeDefinition } from "../nodes/index.js";
import {
  SERIAL_ERROR_CODES,
  createDefaultProjectSettings,
  createDefaultSampleSlots,
  createSerialIssue,
} from "./errors.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGroupPath(path) {
  return typeof path === "string" && path.includes("/groups/");
}

function findGraphEntityPath(graph, entityId, basePath = "/graph") {
  if (!entityId || !isPlainObject(graph)) {
    return undefined;
  }

  const nodeIndex = Array.isArray(graph.nodes)
    ? graph.nodes.findIndex((node) => node?.id === entityId)
    : -1;

  if (nodeIndex >= 0) {
    return `${basePath}/nodes/${nodeIndex}`;
  }

  const edgeIndex = Array.isArray(graph.edges)
    ? graph.edges.findIndex((edge) => edge?.id === entityId)
    : -1;

  if (edgeIndex >= 0) {
    return `${basePath}/edges/${edgeIndex}`;
  }

  if (isPlainObject(graph.groups)) {
    for (const [groupId, group] of Object.entries(graph.groups)) {
      if (groupId === entityId || group?.id === entityId) {
        return `${basePath}/groups/${groupId}`;
      }

      const nestedPath = findGraphEntityPath(
        group?.graph,
        entityId,
        `${basePath}/groups/${groupId}/graph`,
      );

      if (nestedPath) {
        return nestedPath;
      }
    }
  }

  return undefined;
}

function mapModelIssueToSerialIssue(issue, rawGraph) {
  const path = findGraphEntityPath(rawGraph, issue.entityId) ?? "/graph";

  if (issue.code === "MODEL_UNKNOWN_NODE_TYPE") {
    return createSerialIssue(
      SERIAL_ERROR_CODES.UNKNOWN_NODE_TYPE,
      issue.message,
      "error",
      path,
    );
  }

  if (
    issue.code === "MODEL_EDGE_DIRECTION_INVALID" ||
    issue.code === "MODEL_EDGE_DANGLING_ENDPOINT" ||
    issue.code === "MODEL_PORT_INVALID" ||
    issue.code === "MODEL_PORT_ALREADY_CONNECTED"
  ) {
    return createSerialIssue(
      isGroupPath(path)
        ? SERIAL_ERROR_CODES.INVALID_GROUP
        : SERIAL_ERROR_CODES.INVALID_EDGE,
      issue.message,
      "error",
      path,
    );
  }

  if (
    issue.code === "MODEL_GROUP_NOT_FOUND" ||
    issue.code === "MODEL_GROUP_REF_INVALID"
  ) {
    return createSerialIssue(
      SERIAL_ERROR_CODES.INVALID_GROUP,
      issue.message,
      "error",
      path,
    );
  }

  if (
    issue.code === "MODEL_INVALID_OPERATION" &&
    typeof issue.message === "string" &&
    issue.message.includes("must include nodes[] and edges[] arrays")
  ) {
    return createSerialIssue(
      SERIAL_ERROR_CODES.MISSING_FIELD,
      issue.message,
      "error",
      path,
    );
  }

  return createSerialIssue(
    isGroupPath(path)
      ? SERIAL_ERROR_CODES.INVALID_GROUP
      : SERIAL_ERROR_CODES.INVALID_SCHEMA,
    issue.message,
    "error",
    path,
  );
}

function validateProjectMeta(meta) {
  if (meta === undefined) {
    return {};
  }

  if (!isPlainObject(meta)) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SCHEMA,
        "project metadata must be an object when provided.",
        "error",
        "/project",
      ),
    };
  }

  const normalized = {};

  for (const key of ["name", "createdAt", "updatedAt"]) {
    if (meta[key] !== undefined) {
      if (typeof meta[key] !== "string") {
        return {
          error: createSerialIssue(
            SERIAL_ERROR_CODES.INVALID_SCHEMA,
            `project.${key} must be a string when provided.`,
            "error",
            `/project/${key}`,
          ),
        };
      }

      normalized[key] = meta[key];
    }
  }

  return {
    project:
      Object.keys(normalized).length > 0
        ? normalized
        : undefined,
  };
}

function validateProjectSettings(settings) {
  if (settings === undefined) {
    return {
      settings: createDefaultProjectSettings(),
    };
  }

  if (!isPlainObject(settings)) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SCHEMA,
        "settings must be an object when provided.",
        "error",
        "/settings",
      ),
    };
  }

  if (settings.tempo === undefined) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.MISSING_FIELD,
        "settings.tempo is required when settings are provided.",
        "error",
        "/settings/tempo",
      ),
    };
  }

  if (typeof settings.tempo !== "number" || !Number.isFinite(settings.tempo) || settings.tempo <= 0) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SCHEMA,
        "settings.tempo must be a finite number greater than 0.",
        "error",
        "/settings/tempo",
      ),
    };
  }

  return {
    settings: {
      tempo: settings.tempo,
    },
  };
}

function normalizeSlot(slot, index, options) {
  if (!isPlainObject(slot)) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SLOT,
        `Sample slot ${index + 1} must be an object.`,
        "error",
        `/samples/${index}`,
      ),
    };
  }

  if (typeof slot.id !== "string" || slot.id.trim() === "") {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SLOT,
        `Sample slot ${index + 1} must include a non-empty id.`,
        "error",
        `/samples/${index}/id`,
      ),
    };
  }

  if (typeof slot.path !== "string") {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SLOT,
        `Sample slot "${slot.id}" must include a string path.`,
        "error",
        `/samples/${index}/path`,
      ),
    };
  }

  if (slot.path.trim() === "") {
    const fallback = createDefaultSampleSlots()[index];

    return {
      slot: {
        id: slot.id,
        path: fallback.path,
      },
      warning:
        options.allowSlotWarnings !== false
          ? createSerialIssue(
              SERIAL_ERROR_CODES.INVALID_SLOT,
              `Sample slot "${slot.id}" is missing an asset path; using the default sample path instead.`,
              "warning",
              `/samples/${index}/path`,
            )
          : undefined,
    };
  }

  return {
    slot: {
      id: slot.id,
      path: slot.path,
    },
  };
}

function validateSamples(samples, options = {}) {
  if (samples === undefined) {
    return {
      samples: createDefaultSampleSlots(),
      warnings: [],
    };
  }

  if (!Array.isArray(samples) || samples.length !== 8) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SLOT,
        "samples must be an array of exactly 8 slots.",
        "error",
        "/samples",
      ),
    };
  }

  const normalized = [];
  const warnings = [];

  for (let index = 0; index < samples.length; index += 1) {
    const slotResult = normalizeSlot(samples[index], index, options);

    if (slotResult.error) {
      return slotResult;
    }

    normalized.push(slotResult.slot);

    if (slotResult.warning) {
      warnings.push(slotResult.warning);
    }
  }

  return {
    samples: normalized,
    warnings,
  };
}

function validateProjectGraph(graph) {
  if (graph === undefined) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.MISSING_FIELD,
        'Project JSON must include a top-level "graph" object.',
        "error",
        "/graph",
      ),
    };
  }

  if (!isPlainObject(graph)) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.INVALID_SCHEMA,
        "graph must be an object.",
        "error",
        "/graph",
      ),
    };
  }

  if (graph.nodes === undefined) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.MISSING_FIELD,
        'graph must include a "nodes" array.',
        "error",
        "/graph/nodes",
      ),
    };
  }

  if (graph.edges === undefined) {
    return {
      error: createSerialIssue(
        SERIAL_ERROR_CODES.MISSING_FIELD,
        'graph must include an "edges" array.',
        "error",
        "/graph/edges",
      ),
    };
  }

  const normalized = normalizeGraphSnapshot(graph, getNodeDefinition, {
    source: "load",
  });

  if (normalized.issue) {
    return {
      error: mapModelIssueToSerialIssue(normalized.issue, graph),
    };
  }

  const indexes = buildGraphIndexes(normalized.snapshot, getNodeDefinition);

  if (indexes.issue) {
    return {
      error: mapModelIssueToSerialIssue(indexes.issue, graph),
    };
  }

  return {
    graph: normalized.snapshot,
  };
}

export function validateProjectData(input, options = {}) {
  if (!isPlainObject(input)) {
    return {
      project: undefined,
      errors: [
        createSerialIssue(
          SERIAL_ERROR_CODES.INVALID_SCHEMA,
          "Project data must be an object.",
          "error",
        ),
      ],
      warnings: [],
    };
  }

  const errors = [];
  const warnings = [];

  const graphResult = validateProjectGraph(input.graph);

  if (graphResult.error) {
    errors.push(graphResult.error);
  }

  const samplesResult = validateSamples(input.samples, options);

  if (samplesResult.error) {
    errors.push(samplesResult.error);
  } else {
    warnings.push(...samplesResult.warnings);
  }

  const settingsResult = validateProjectSettings(input.settings);

  if (settingsResult.error) {
    errors.push(settingsResult.error);
  }

  const metaResult = validateProjectMeta(input.project);

  if (metaResult.error) {
    errors.push(metaResult.error);
  }

  if (errors.length > 0) {
    return {
      project: undefined,
      errors,
      warnings,
    };
  }

  return {
    project: {
      graph: graphResult.graph,
      samples: samplesResult.samples,
      settings: settingsResult.settings,
      ...(metaResult.project !== undefined ? { project: metaResult.project } : {}),
    },
    errors,
    warnings,
  };
}
