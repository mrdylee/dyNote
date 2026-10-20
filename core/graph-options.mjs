import { DEFAULT_FORCES } from "./graph-kernel.mjs";
// Keep the previous default fade curve; increasing the threshold delays labels.
export function graphLabelAlpha(zoom, threshold) {
  return Math.max(0, Math.min(1, (zoom * 2 ** -threshold - 0.28) * 2));
}
export const GRAPH_RANGES = [
  ["center", "중심 장력", 0, 5, 0.1], ["repel", "반발력", 0, 10000, 100],
  ["link", "링크 장력", 0, 2, 0.05], ["distance", "링크 거리", 10, 1000, 10],
  ["labelThreshold", "텍스트 표시 시작점", -3, 3, 0.1], ["nodeSize", "노드 크기", 0.1, 5, 0.1], ["lineWidth", "링크 두께", 0.1, 5, 0.1],
];
export const GRAPH_DEFAULTS = Object.freeze({
  ...DEFAULT_FORCES, nodeSize: 1, lineWidth: 1, labelThreshold: 0, arrows: false,
  local: false, depth: 1, incoming: true, outgoing: true, neighborLinks: true,
  showTags: false, showAttachments: false, existingOnly: false, showOrphans: true,
  query: "", path: "", tag: "", groups: [], panelOpen: true,
  filtersOpen: true, groupsOpen: false, displayOpen: true, forcesOpen: true,
});
export function normalizeGraphSettings(saved) {
  const result = { ...GRAPH_DEFAULTS, groups: [] };
  for (const [name, , min, max] of [...GRAPH_RANGES, ["depth", "", 1, 4]])
    if (Number.isFinite(saved?.[name])) result[name] = Math.max(min, Math.min(max, saved[name]));
  for (const [name, value] of Object.entries(GRAPH_DEFAULTS)) {
    if (typeof value === "boolean" && typeof saved?.[name] === "boolean") result[name] = saved[name];
    if (typeof value === "string" && typeof saved?.[name] === "string") result[name] = saved[name].slice(0, 1000);
  }
  if (!Number.isFinite(saved?.labelThreshold) && Number.isFinite(saved?.labels))
    result.labelThreshold = Math.max(-3, Math.min(3, saved.labels > 0 ? -Math.log2(saved.labels) : 3));
  if (Array.isArray(saved?.groups)) result.groups = saved.groups.filter((g) => g && typeof g.query === "string" && /^#[0-9a-f]{6}$/i.test(g.color)).slice(0, 64).map((g) => ({ query: g.query.slice(0, 1000), color: g.color }));
  return result;
}
