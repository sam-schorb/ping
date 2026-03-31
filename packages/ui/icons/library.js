export const DEFAULT_ICON_LIBRARY = Object.freeze({
  default: { viewBox: "0 0 24 24", path: "M5 5h14v14H5z" },
  unknown: { viewBox: "0 0 24 24", path: "M12 5a5 5 0 0 1 5 5c0 3-3 3-3 6m-2 3h0" },
  pulse: { viewBox: "0 0 24 24", path: "M3 12h4l2-5 4 10 2-5h6" },
  out: { viewBox: "0 0 24 24", path: "M5 12h10m0 0-4-4m4 4-4 4" },
  output: { viewBox: "0 0 24 24", path: "M5 12h10m0 0-4-4m4 4-4 4" },
  group: { viewBox: "0 0 24 24", path: "M4 6h7v7H4zM13 11h7v7h-7z" },
  mux: { viewBox: "0 0 24 24", path: "M5 6h4v4h6v4h4v4h-4v-4H9V6H5z" },
  demux: { viewBox: "0 0 24 24", path: "M19 6h-4v4H9v4H5v4h4v-4h6V6h4z" },
  add: { viewBox: "0 0 24 24", path: "M11 5h2v14h-2zM5 11h14v2H5z" },
  sub: { viewBox: "0 0 24 24", path: "M5 11h14v2H5z" },
  set: { viewBox: "0 0 24 24", path: "M5 5h14v14H5zM11 11h2v2h-2z" },
  speed: { viewBox: "0 0 24 24", path: "M6 6l6 6-6 6V6zm6 0l6 6-6 6V6z" },
  pitch: { viewBox: "0 0 24 24", path: "M8 18V6l8 3v9M8 12h8" },
  decay: { viewBox: "0 0 24 24", path: "M5 6h2v12h12v2H5z" },
  crush: { viewBox: "0 0 24 24", path: "M6 6h4v4H6zM14 6h4v4h-4zM6 14h4v4H6zM14 14h4v4h-4z" },
  hpf: { viewBox: "0 0 24 24", path: "M4 14h6l2-4 2 4h6v2H4z" },
  lpf: { viewBox: "0 0 24 24", path: "M4 10h6l2 4 2-4h6v2H4z" },
  switch: { viewBox: "0 0 24 24", path: "M4 7h16v10H4zM10 7v10" },
  block: { viewBox: "0 0 24 24", path: "M5 5h14v14H5zM7 7l10 10M17 7L7 17" },
  every: { viewBox: "0 0 24 24", path: "M5 6h14v2H5zM5 11h14v2H5zM5 16h14v2H5z" },
  drop: { viewBox: "0 0 24 24", path: "M5 6h14v2H5zM5 11h5m4 0h5M5 16h14v2H5z" },
  random: { viewBox: "0 0 24 24", path: "M6 6h12v12H6zM9 9h2v2H9zM13 9h2v2h-2zM9 13h2v2H9zM13 13h2v2h-2z" },
  counter: { viewBox: "0 0 24 24", path: "M6 6h4v12H6zM14 6h4v12h-4z" },
  gtp: { viewBox: "0 0 24 24", path: "M8 6l8 6-8 6v-3l4-3-4-3V6z" },
  ltp: { viewBox: "0 0 24 24", path: "M16 6l-8 6 8 6v-3l-4-3 4-3V6z" },
  gtep: { viewBox: "0 0 24 24", path: "M7 6h2v12H7zM10 6l8 6-8 6v-3l4-3-4-3V6z" },
  ltep: { viewBox: "0 0 24 24", path: "M15 6h2v12h-2zM14 6l-8 6 8 6v-3l-4-3 4-3V6z" },
  match: { viewBox: "0 0 24 24", path: "M6 9h12v2H6zM6 13h12v2H6z" },
});

export function resolveIcon(iconId, configIcons) {
  const library = configIcons?.library ?? DEFAULT_ICON_LIBRARY;
  const fallbackId = configIcons?.fallbackId ?? "default";

  return library[iconId] ?? library[fallbackId] ?? DEFAULT_ICON_LIBRARY.default;
}
