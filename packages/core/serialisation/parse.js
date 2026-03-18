import { cloneIssue } from "./errors.js";
import { migrateProjectJSON } from "./migrate.js";
import { validateProjectData } from "./validate.js";

export function parseProject(json) {
  let input = json;

  if (typeof json === "string") {
    try {
      input = JSON.parse(json);
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            code: "SERIAL_PARSE_ERROR",
            message: error.message,
            severity: "error",
          },
        ],
        warnings: [],
      };
    }
  }

  const migrated = migrateProjectJSON(input);

  if (migrated.errors.length > 0) {
    return {
      ok: false,
      errors: migrated.errors.map(cloneIssue),
      warnings: migrated.warnings.map(cloneIssue),
    };
  }

  const validation = validateProjectData(migrated.projectJSON, {
    allowSlotWarnings: true,
  });

  if (validation.errors.length > 0) {
    return {
      ok: false,
      errors: validation.errors.map(cloneIssue),
      warnings: [
        ...migrated.warnings.map(cloneIssue),
        ...validation.warnings.map(cloneIssue),
      ],
    };
  }

  return {
    ok: true,
    project: validation.project,
    errors: [],
    warnings: [
      ...migrated.warnings.map(cloneIssue),
      ...validation.warnings.map(cloneIssue),
    ],
  };
}
