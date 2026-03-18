export function computeRouteLength(points) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    total +=
      Math.abs(points[index].x - points[index - 1].x) +
      Math.abs(points[index].y - points[index - 1].y);
  }

  return total;
}

export function createSvgPath(points) {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
    )
    .join(" ");
}
