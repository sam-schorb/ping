import { clampCamera, screenToWorld, zoomCameraAtPoint } from "../editor/geometry.js";

export function getViewportSize(element) {
  const rect = element?.getBoundingClientRect?.();

  return {
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
  };
}

export function getWorldCursorFromPointer(event, viewportElement, camera, config) {
  const rect = viewportElement.getBoundingClientRect();
  return screenToWorld(
    {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    },
    camera,
    config,
  );
}

export function getScreenCursorFromPointer(event, viewportElement) {
  const rect = viewportElement.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

export function applyWheelZoom(camera, event, viewportElement, config) {
  const cursor = getScreenCursorFromPointer(event, viewportElement);
  const direction = event.deltaY > 0 ? -1 : 1;
  const nextScale = camera.scale + config.interaction.zoomStep * direction;
  const zoomedCamera = zoomCameraAtPoint(camera, cursor, nextScale, config);

  return clampCamera(zoomedCamera, getViewportSize(viewportElement), config);
}

function normalizeWheelDelta(delta, deltaMode, pageStep) {
  if (deltaMode === 1) {
    return delta * 16;
  }

  if (deltaMode === 2) {
    return delta * pageStep;
  }

  return delta;
}

export function applyWheelPan(camera, event, viewportElement, config) {
  const viewportSize = getViewportSize(viewportElement);
  const deltaX =
    normalizeWheelDelta(event.deltaX, event.deltaMode, viewportSize.width || 1) *
    config.interaction.panSpeed;
  const deltaY =
    normalizeWheelDelta(event.deltaY, event.deltaMode, viewportSize.height || 1) *
    config.interaction.panSpeed;

  return clampCamera(
    {
      x: camera.x - deltaX,
      y: camera.y - deltaY,
      scale: camera.scale,
    },
    viewportSize,
    config,
  );
}

export function applyScreenDeltaPan(camera, delta, viewportElement, config) {
  const viewportSize = getViewportSize(viewportElement);

  return clampCamera(
    {
      x: camera.x + (Number(delta?.x) || 0),
      y: camera.y + (Number(delta?.y) || 0),
      scale: camera.scale,
    },
    viewportSize,
    config,
  );
}

export function applyPinchGesture(startCamera, gesture, viewportElement, config) {
  const safeStartDistance = Math.max(1, Number(gesture?.startDistance) || 0);
  const currentDistance = Math.max(1, Number(gesture?.currentDistance) || safeStartDistance);
  const startMidpoint = {
    x: Number(gesture?.startMidpoint?.x) || 0,
    y: Number(gesture?.startMidpoint?.y) || 0,
  };
  const currentMidpoint = {
    x: Number(gesture?.currentMidpoint?.x) || startMidpoint.x,
    y: Number(gesture?.currentMidpoint?.y) || startMidpoint.y,
  };
  const nextScale = startCamera.scale * (currentDistance / safeStartDistance);
  const zoomedCamera = zoomCameraAtPoint(startCamera, startMidpoint, nextScale, config);

  return clampCamera(
    {
      x: zoomedCamera.x + (currentMidpoint.x - startMidpoint.x),
      y: zoomedCamera.y + (currentMidpoint.y - startMidpoint.y),
      scale: zoomedCamera.scale,
    },
    getViewportSize(viewportElement),
    config,
  );
}
