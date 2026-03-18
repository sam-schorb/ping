import { compileGraph } from "./compile.js";

export function validateGraph(snapshot, registry, delays) {
  const result = compileGraph(snapshot, registry, delays, {
    includeDebugMaps: true,
  });

  return {
    ok: result.ok,
    errors: result.errors,
    warnings: result.warnings,
  };
}
