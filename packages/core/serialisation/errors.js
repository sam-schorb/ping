export const SERIAL_ERROR_CODES = {
  PARSE_ERROR: "SERIAL_PARSE_ERROR",
  MISSING_FIELD: "SERIAL_MISSING_FIELD",
  INVALID_SCHEMA: "SERIAL_INVALID_SCHEMA",
  UNKNOWN_NODE_TYPE: "SERIAL_UNKNOWN_NODE_TYPE",
  INVALID_EDGE: "SERIAL_INVALID_EDGE",
  INVALID_GROUP: "SERIAL_INVALID_GROUP",
  INVALID_SLOT: "SERIAL_INVALID_SLOT",
  VERSION_MIGRATED: "SERIAL_VERSION_MIGRATED",
  VERSION_UNSUPPORTED: "SERIAL_VERSION_UNSUPPORTED",
};

export const CURRENT_SCHEMA_VERSION = 1;
export const DEFAULT_TEMPO_BPM = 100;
export const SAMPLE_SLOT_COUNT = 8;
export const DEFAULT_SAMPLE_FILES = Object.freeze([
  "kick1.mp3",
  "snare1.mp3",
  "tom1.mp3",
  "clap1.mp3",
  "rim1.mp3",
  "chirp1.mp3",
  "c-hat1.mp3",
  "o-hat1.mp3",
]);

// Canonical fallback slots point at the bundled public kit served by the web app.
export function createDefaultSampleSlots() {
  return Array.from({ length: SAMPLE_SLOT_COUNT }, (_, index) => ({
    id: String(index + 1),
    path: `/samples/${DEFAULT_SAMPLE_FILES[index]}`,
  }));
}

export function createDefaultProjectSettings() {
  return {
    tempo: DEFAULT_TEMPO_BPM,
  };
}

export function createSerialIssue(code, message, severity = "error", path) {
  return {
    code,
    message,
    severity,
    ...(path !== undefined ? { path } : {}),
  };
}

export function cloneIssue(issue) {
  return {
    ...issue,
  };
}

export function createSerialisationError(issues) {
  const error = new Error(
    issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n"),
  );

  error.name = "SerialisationError";
  error.code = issues[0]?.code ?? SERIAL_ERROR_CODES.INVALID_SCHEMA;
  error.issues = issues.map(cloneIssue);

  return error;
}
