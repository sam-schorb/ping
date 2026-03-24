import { computeGroupDslSemanticHash } from "../dsl/hash.js";
import { CURRENT_GROUP_DSL_FORMAT_VERSION } from "../dsl/constants.js";
import { createCodeNodeGroupId } from "./constants.js";
import { MODEL_ERROR_CODES, createModelIssue } from "./errors.js";
import { normalizeGroupDefinition } from "./snapshot.js";

export function createCodeNodeGroupName(nodeId) {
  return `Code ${nodeId}`;
}

export function normalizeCodeNodeGroupRef(nodeId, groupRef) {
  const expectedGroupId = createCodeNodeGroupId(nodeId);

  if (groupRef === undefined) {
    return { groupRef: expectedGroupId };
  }

  if (groupRef !== expectedGroupId) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.GROUP_REF_INVALID,
        `Code node "${nodeId}" must use private backing group "${expectedGroupId}".`,
        nodeId,
      ),
    };
  }

  return { groupRef: expectedGroupId };
}

export function createCodeNodeBackingGroup(nodeId, getNodeDefinition) {
  const normalizedGroup = normalizeGroupDefinition(
    {
      id: createCodeNodeGroupId(nodeId),
      name: createCodeNodeGroupName(nodeId),
      preserveInternalCableDelays: false,
      graph: {
        nodes: [],
        edges: [],
      },
      inputs: [],
      outputs: [],
      controls: [],
      dsl: {
        source: "",
        formatVersion: CURRENT_GROUP_DSL_FORMAT_VERSION,
        mode: "authored",
        syncStatus: "in-sync",
        lastAppliedSemanticHash: "",
      },
    },
    getNodeDefinition,
    {
      source: "create",
      groups: {},
      validateGroupRef: true,
    },
  );

  if (normalizedGroup.issue) {
    return normalizedGroup;
  }

  const hashResult = computeGroupDslSemanticHash(
    normalizedGroup.group,
    { getNodeDefinition },
    { groups: {} },
  );

  if (!hashResult.ok) {
    return {
      issue: createModelIssue(
        MODEL_ERROR_CODES.INVALID_OPERATION,
        hashResult.errors?.[0]?.message ??
          `Code node "${nodeId}" backing group could not be initialized.`,
        nodeId,
      ),
    };
  }

  return {
    group: {
      ...normalizedGroup.group,
      dsl: {
        ...normalizedGroup.group.dsl,
        lastAppliedSemanticHash: hashResult.hash,
        syncStatus: "in-sync",
      },
    },
  };
}
