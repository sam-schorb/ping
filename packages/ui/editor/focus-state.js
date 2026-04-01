const GROUP_DIALOG_FOCUS_ATTRIBUTE_NAMES = [
  "data-action",
  "data-group-kind",
  "data-group-id",
  "data-group-index",
  "data-group-direction",
  "data-testid",
  "name",
  "type",
];

const MENU_FOCUS_ATTRIBUTE_NAMES = [
  "data-action",
  "data-menu-category",
  "data-palette-type",
  "data-group-ref",
  "data-testid",
  "name",
  "type",
];

const SIDEBAR_FOCUS_ATTRIBUTE_NAMES = [
  "data-action",
  "data-group-id",
  "data-group-kind",
  "data-group-index",
  "data-group-direction",
  "data-node-id",
  "data-node-type",
  "data-sidebar-action-id",
  "data-testid",
  "name",
  "type",
];

export function readSidebarTabsScrollLeft(root) {
  return root?.querySelector?.(".ping-editor__tabs")?.scrollLeft ?? 0;
}

export function restoreSidebarTabsScrollLeft(root, scrollLeft) {
  const tabs = root?.querySelector?.(".ping-editor__tabs");

  if (!tabs) {
    return;
  }

  tabs.scrollLeft = scrollLeft;
}

export function readMenuCategoriesScrollLeft(root) {
  return root?.querySelector?.(".ping-editor__menu-categories")?.scrollLeft ?? 0;
}

export function restoreMenuCategoriesScrollLeft(root, scrollLeft) {
  const categories = root?.querySelector?.(".ping-editor__menu-categories");

  if (!categories) {
    return;
  }

  categories.scrollLeft = scrollLeft;
}

export function readGroupDialogScrollTop(root) {
  return root?.querySelector?.(".ping-editor__group-dialog")?.scrollTop ?? 0;
}

export function restoreGroupDialogScrollTop(root, scrollTop) {
  const dialog = root?.querySelector?.(".ping-editor__group-dialog");

  if (!dialog) {
    return;
  }

  dialog.scrollTop = scrollTop;
}

export function focusElementWithoutScroll(element) {
  if (!element?.focus) {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

function readScopedFocusState(root, scopeSelector, attributeNames) {
  const activeElement = root?.ownerDocument?.activeElement;

  if (
    !activeElement ||
    typeof activeElement.matches !== "function" ||
    !root?.contains?.(activeElement) ||
    !activeElement.closest(scopeSelector)
  ) {
    return null;
  }

  return {
    tagName: activeElement.tagName.toLowerCase(),
    attributes: attributeNames
      .map((name) => [name, activeElement.getAttribute(name)])
      .filter(([, value]) => value !== null),
    selectionStart:
      typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
    selectionEnd:
      typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
  };
}

function restoreScopedFocus(root, scopeSelector, focusState) {
  if (!focusState) {
    return false;
  }

  const scope = root?.querySelector?.(scopeSelector);

  if (!scope) {
    return false;
  }

  const nextElement = Array.from(scope.querySelectorAll(focusState.tagName)).find((element) =>
    focusState.attributes.every(([name, value]) => element.getAttribute(name) === value),
  );

  if (!nextElement) {
    return false;
  }

  focusElementWithoutScroll(nextElement);

  if (
    focusState.selectionStart !== null &&
    focusState.selectionEnd !== null &&
    typeof nextElement.setSelectionRange === "function"
  ) {
    try {
      nextElement.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
    } catch {}
  }

  return true;
}

export function readGroupDialogFocusState(root) {
  return readScopedFocusState(root, ".ping-editor__group-dialog", GROUP_DIALOG_FOCUS_ATTRIBUTE_NAMES);
}

export function restoreGroupDialogFocus(root, focusState) {
  return restoreScopedFocus(root, ".ping-editor__group-dialog", focusState);
}

export function readMenuFocusState(root) {
  return readScopedFocusState(root, ".ping-editor__menu", MENU_FOCUS_ATTRIBUTE_NAMES);
}

export function restoreMenuFocus(root, focusState) {
  return restoreScopedFocus(root, ".ping-editor__menu", focusState);
}

export function readSidebarFocusState(root) {
  return readScopedFocusState(root, ".ping-editor__sidebar-content", SIDEBAR_FOCUS_ATTRIBUTE_NAMES);
}

export function restoreSidebarFocus(root, focusState) {
  return restoreScopedFocus(root, ".ping-editor__sidebar-content", focusState);
}
