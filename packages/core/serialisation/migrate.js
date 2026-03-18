import {
  CURRENT_SCHEMA_VERSION,
  SERIAL_ERROR_CODES,
  createSerialIssue,
} from "./errors.js";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJSONLike(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJSONLike(entry));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJSONLike(entry)]),
    );
  }

  return value;
}

function migrateV0ToV1(projectJSON) {
  const warnings = [
    createSerialIssue(
      SERIAL_ERROR_CODES.VERSION_MIGRATED,
      projectJSON.groups !== undefined
        ? 'Migrated project schema from v0 to v1 and moved top-level "groups" to "graph.groups".'
        : "Migrated project schema from v0 to v1.",
      "warning",
      "/schemaVersion",
    ),
  ];

  if (projectJSON.groups !== undefined) {
    if (!isPlainObject(projectJSON.graph)) {
      return {
        errors: [
          createSerialIssue(
            SERIAL_ERROR_CODES.MISSING_FIELD,
            'Legacy project includes top-level "groups" but is missing the required "graph" object.',
            "error",
            "/graph",
          ),
        ],
        warnings,
      };
    }

    if (projectJSON.graph.groups !== undefined) {
      return {
        errors: [
          createSerialIssue(
            SERIAL_ERROR_CODES.INVALID_SCHEMA,
            'Legacy project cannot define both top-level "groups" and "graph.groups".',
            "error",
            "/groups",
          ),
        ],
        warnings,
      };
    }

    projectJSON.graph = {
      ...projectJSON.graph,
      groups: cloneJSONLike(projectJSON.groups),
    };
    delete projectJSON.groups;
  }

  projectJSON.schemaVersion = 1;

  return {
    projectJSON,
    warnings,
    errors: [],
  };
}

export function migrateProjectJSON(input) {
  if (!isPlainObject(input)) {
    return {
      errors: [
        createSerialIssue(
          SERIAL_ERROR_CODES.INVALID_SCHEMA,
          "Project JSON must be an object.",
          "error",
        ),
      ],
      warnings: [],
    };
  }

  const projectJSON = cloneJSONLike(input);
  const sourceVersion =
    projectJSON.schemaVersion === undefined ? 0 : projectJSON.schemaVersion;

  if (!Number.isInteger(sourceVersion) || sourceVersion < 0) {
    return {
      errors: [
        createSerialIssue(
          SERIAL_ERROR_CODES.INVALID_SCHEMA,
          "schemaVersion must be a non-negative integer when provided.",
          "error",
          "/schemaVersion",
        ),
      ],
      warnings: [],
    };
  }

  if (sourceVersion > CURRENT_SCHEMA_VERSION) {
    return {
      errors: [
        createSerialIssue(
          SERIAL_ERROR_CODES.VERSION_UNSUPPORTED,
          `Project schema version ${sourceVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`,
          "error",
          "/schemaVersion",
        ),
      ],
      warnings: [],
    };
  }

  let cursor = projectJSON;
  let version = sourceVersion;
  const warnings = [];

  while (version < CURRENT_SCHEMA_VERSION) {
    if (version === 0) {
      const migrated = migrateV0ToV1(cursor);

      if (migrated.errors.length > 0) {
        return migrated;
      }

      cursor = migrated.projectJSON;
      warnings.push(...migrated.warnings);
      version = 1;
      continue;
    }

    return {
      errors: [
        createSerialIssue(
          SERIAL_ERROR_CODES.VERSION_UNSUPPORTED,
          `No migration path exists from schema version ${version} to ${CURRENT_SCHEMA_VERSION}.`,
          "error",
          "/schemaVersion",
        ),
      ],
      warnings,
    };
  }

  cursor.schemaVersion = CURRENT_SCHEMA_VERSION;

  return {
    projectJSON: cursor,
    warnings,
    errors: [],
  };
}
