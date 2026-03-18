import { cloneGraphSnapshot } from "../graph/index.js";
import {
  CURRENT_SCHEMA_VERSION,
  createSerialisationError,
} from "./errors.js";
import { validateProjectData } from "./validate.js";

export function serialiseProject(input) {
  const validation = validateProjectData(input, {
    allowSlotWarnings: false,
  });

  if (validation.errors.length > 0) {
    throw createSerialisationError(validation.errors);
  }

  const { graph, samples, settings, project } = validation.project;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    graph: cloneGraphSnapshot(graph),
    samples: samples.map((slot) => ({ ...slot })),
    settings: { ...settings },
    ...(project !== undefined ? { project: { ...project } } : {}),
  };
}
