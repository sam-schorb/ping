import {
  ARCHETYPES,
  getLayout,
  isControlPortsAllowed,
  isValidLayoutCounts,
} from "./archetypes.js";
import { NODE_MAX_VALUE, NODE_MIN_VALUE } from "./behaviors/shared.js";

const REQUIRED_FIELDS = [
  "type",
  "label",
  "description",
  "category",
  "icon",
  "color",
  "layout",
  "inputs",
  "outputs",
  "controlPorts",
  "hasParam",
];

const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function createIssue(code, message, options = {}) {
  return {
    code,
    message,
    nodeType: options.nodeType,
    field: options.field,
    severity: options.severity ?? "error",
  };
}

function hasMissingField(definition, field) {
  const value = definition[field];

  if (value === undefined || value === null) {
    return true;
  }

  return typeof value === "string" && value.trim() === "";
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isParamMetaValid(paramMeta) {
  return (
    paramMeta &&
    typeof paramMeta === "object" &&
    typeof paramMeta.target === "string" &&
    paramMeta.target.trim() !== "" &&
    typeof paramMeta.mapping === "string" &&
    paramMeta.mapping.trim() !== "" &&
    (paramMeta.unit === undefined ||
      (typeof paramMeta.unit === "string" && paramMeta.unit.trim() !== ""))
  );
}

function validateParamMeta(definition, errors) {
  if (!definition.paramMap) {
    return;
  }

  if (
    typeof definition.paramMap !== "object" ||
    Array.isArray(definition.paramMap)
  ) {
    errors.push(
      createIssue("REG_PARAM_META_INVALID", "paramMap must be an object.", {
        nodeType: definition.type,
        field: "paramMap",
      }),
    );

    return;
  }

  for (const [paramKey, paramMeta] of Object.entries(definition.paramMap)) {
    if (!isParamMetaValid(paramMeta)) {
      errors.push(
        createIssue(
          "REG_PARAM_META_INVALID",
          `paramMap entry "${paramKey}" must include target and mapping strings.`,
          {
            nodeType: definition.type,
            field: `paramMap.${paramKey}`,
          },
        ),
      );
    }
  }
}

function validateRequiredFields(definition, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (hasMissingField(definition, field)) {
      errors.push(
        createIssue(
          "REG_MISSING_FIELD",
          `Node "${definition.type ?? "<unknown>"}" is missing required field "${field}".`,
          {
            nodeType: definition.type,
            field,
          },
        ),
      );
    }
  }
}

function validateType(definition, errors) {
  if (typeof definition.type !== "string" || definition.type.trim() === "") {
    return;
  }

  if (!TYPE_PATTERN.test(definition.type)) {
    errors.push(
      createIssue(
        "REG_INVALID_TYPE_FORMAT",
        `Node type "${definition.type}" must be kebab-case.`,
        {
          nodeType: definition.type,
          field: "type",
        },
      ),
    );
  }
}

function validatePortCounts(definition, errors) {
  if (
    !isNonNegativeInteger(definition.inputs) ||
    !isNonNegativeInteger(definition.outputs) ||
    !isNonNegativeInteger(definition.controlPorts)
  ) {
    errors.push(
      createIssue(
        "REG_INVALID_PORT_COUNTS",
        `Node "${definition.type}" must use non-negative integer port counts.`,
        {
          nodeType: definition.type,
          field: "inputs",
        },
      ),
    );

    return false;
  }

  return true;
}

function validateLayout(definition, errors) {
  if (typeof definition.layout !== "string" || definition.layout.trim() === "") {
    return;
  }

  if (!ARCHETYPES[definition.layout]) {
    errors.push(
      createIssue(
        "REG_INVALID_LAYOUT",
        `Node "${definition.type}" uses unknown layout "${definition.layout}".`,
        {
          nodeType: definition.type,
          field: "layout",
        },
      ),
    );

    return;
  }

  if (definition.controlPorts > 0 && !isControlPortsAllowed(definition.layout)) {
    errors.push(
      createIssue(
        "REG_CONTROL_PORTS_DISALLOWED",
        `Layout "${definition.layout}" does not allow control ports.`,
        {
          nodeType: definition.type,
          field: "controlPorts",
        },
      ),
    );

    return;
  }

  if (
    !isValidLayoutCounts(
      definition.layout,
      definition.inputs,
      definition.outputs,
      definition.controlPorts,
    )
  ) {
    errors.push(
      createIssue(
        "REG_LAYOUT_PORT_MISMATCH",
        `Node "${definition.type}" port counts do not match layout "${definition.layout}".`,
        {
          nodeType: definition.type,
          field: "layout",
        },
      ),
    );

    return;
  }

  const layout = getLayout(
    definition.layout,
    definition.inputs,
    definition.outputs,
    definition.controlPorts,
  );

  if (
    layout.inputs.length !== definition.inputs + definition.controlPorts ||
    layout.outputs.length !== definition.outputs
  ) {
    errors.push(
      createIssue(
        "REG_LAYOUT_PORT_MISMATCH",
        `Node "${definition.type}" derived layout does not match its port counts.`,
        {
          nodeType: definition.type,
          field: "layout",
        },
      ),
    );
  }
}

function validateDefaults(definition, errors) {
  if (definition.defaultParam === undefined || definition.defaultParam === null) {
    errors.push(
      createIssue(
        definition.hasParam
          ? "REG_HAS_PARAM_DEFAULT_MISSING"
          : "REG_MISSING_FIELD",
        definition.hasParam
          ? `Node "${definition.type}" must define defaultParam when hasParam is true.`
          : `Node "${definition.type ?? "<unknown>"}" is missing required field "defaultParam".`,
        {
          nodeType: definition.type,
          field: "defaultParam",
        },
      ),
    );

    return;
  }

  if (typeof definition.defaultParam !== "number") {
    errors.push(
      createIssue(
        "REG_DEFAULT_PARAM_OUT_OF_RANGE",
        `Node "${definition.type}" defaultParam must be numeric.`,
        {
          nodeType: definition.type,
          field: "defaultParam",
        },
      ),
    );

    return;
  }

  if (
    definition.defaultParam < NODE_MIN_VALUE ||
    definition.defaultParam > NODE_MAX_VALUE
  ) {
    errors.push(
      createIssue(
        "REG_DEFAULT_PARAM_OUT_OF_RANGE",
        `Node "${definition.type}" defaultParam must be within ${NODE_MIN_VALUE}..${NODE_MAX_VALUE}.`,
        {
          nodeType: definition.type,
          field: "defaultParam",
        },
      ),
    );
  }
}

function validateBehavior(definition, errors) {
  if (typeof definition.onSignal !== "function") {
    errors.push(
      createIssue(
        "REG_ONSIGNAL_MISSING",
        `Node "${definition.type}" must define an onSignal handler.`,
        {
          nodeType: definition.type,
          field: "onSignal",
        },
      ),
    );
  }
}

export function validateRegistry(registry) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(registry)) {
    return {
      ok: false,
      errors: [
        createIssue("REG_MISSING_FIELD", "Registry must be an array of nodes.", {
          field: "registry",
        }),
      ],
      warnings,
    };
  }

  const seenTypes = new Set();

  for (const definition of registry) {
    validateRequiredFields(definition, errors);
    validateType(definition, errors);

    if (typeof definition.type === "string") {
      if (seenTypes.has(definition.type)) {
        errors.push(
          createIssue(
            "REG_DUPLICATE_TYPE",
            `Duplicate node type "${definition.type}" found in registry.`,
            {
              nodeType: definition.type,
              field: "type",
            },
          ),
        );
      } else {
        seenTypes.add(definition.type);
      }
    }

    const countsAreValid = validatePortCounts(definition, errors);

    if (countsAreValid) {
      validateLayout(definition, errors);
    }

    validateDefaults(definition, errors);
    validateBehavior(definition, errors);
    validateParamMeta(definition, errors);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function createRegistryValidationError(result) {
  const error = new Error(
    result.errors.map((issue) => `${issue.code}: ${issue.message}`).join("\n"),
  );

  error.name = "RegistryValidationError";
  error.validationResult = result;
  error.code = result.errors[0]?.code ?? "REG_VALIDATION_FAILED";

  return error;
}
