const GROUP_DELAY_SOURCE_PREFIX = "__group_delay__:";

export function createGroupDelaySourceId(groupId, edgeId) {
  return `${GROUP_DELAY_SOURCE_PREFIX}${groupId}::${edgeId}`;
}

export function isGroupDelaySourceId(delaySourceId) {
  return (
    typeof delaySourceId === "string" &&
    delaySourceId.startsWith(GROUP_DELAY_SOURCE_PREFIX)
  );
}
