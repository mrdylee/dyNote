import { rewriteLinks } from "./links.mjs";

const record = (v) => v && typeof v === "object" && !Array.isArray(v);
const localPath = (v) =>
  typeof v === "string" &&
  v.length > 0 &&
  !/[\\\0]/.test(v) &&
  !/^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(v) &&
  v.split("/").every((p) => p && !p.startsWith("."));
function displayValues(item) {
  if (item.label !== undefined && typeof item.label !== "string")
    throw new Error("카드·연결 이름은 문자열이어야 합니다.");
  if (
    item.color !== undefined &&
    (typeof item.color !== "string" ||
      !/^(?:[1-6]|#[a-f0-9]{6})$/i.test(item.color))
  )
    throw new Error("잘못된 Canvas 색상입니다.");
}

export function parseCanvas(source) {
  const data = JSON.parse(source.replace(/^\uFEFF/, ""));
  if (!record(data)) throw new Error("Canvas는 JSON 객체여야 합니다.");
  const nodes = data.nodes ?? [],
    edges = data.edges ?? [];
  if (
    !Array.isArray(nodes) ||
    !Array.isArray(edges) ||
    nodes.length > 5000 ||
    edges.length > 10000
  )
    throw new Error("Canvas의 카드·연결 목록이 잘못되었거나 너무 큽니다.");
  const ids = new Set();
  let readOnly = false;
  for (const n of nodes) {
    displayValues(n);
    if (
      !record(n) ||
      typeof n.id !== "string" ||
      !n.id ||
      ids.has(n.id) ||
      ![n.x, n.y, n.width, n.height].every(Number.isFinite) ||
      Math.abs(n.x) > 1e7 ||
      Math.abs(n.y) > 1e7 ||
      n.width <= 0 ||
      n.height <= 0 ||
      n.width > 1e5 ||
      n.height > 1e5
    )
      throw new Error("Canvas 카드의 ID·위치·크기가 잘못되었습니다.");
    ids.add(n.id);
    if (!["text", "file", "link", "group"].includes(n.type)) readOnly = true;
    if (n.type === "text" && typeof n.text !== "string")
      throw new Error("텍스트 카드의 내용이 없습니다.");
    if (n.type === "file" && !localPath(n.file))
      throw new Error("Canvas 파일 경로는 보관함 안이어야 합니다.");
    if (
      n.type === "group" &&
      n.background !== undefined &&
      !localPath(n.background)
    )
      throw new Error("잘못된 그룹 배경 경로입니다.");
    if (n.type === "link" && typeof n.url !== "string")
      throw new Error("링크 카드의 주소가 없습니다.");
  }
  const edgeIds = new Set();
  for (const e of edges) {
    displayValues(e);
    if (
      !record(e) ||
      typeof e.id !== "string" ||
      !e.id ||
      edgeIds.has(e.id) ||
      !ids.has(e.fromNode) ||
      !ids.has(e.toNode)
    )
      throw new Error("Canvas 연결의 ID 또는 대상 카드가 잘못되었습니다.");
    for (const key of ["fromSide", "toSide"])
      if (
        e[key] !== undefined &&
        !["top", "right", "bottom", "left"].includes(e[key])
      )
        throw new Error("Canvas 연결 방향이 잘못되었습니다.");
    for (const key of ["fromEnd", "toEnd"])
      if (e[key] !== undefined && !["none", "arrow"].includes(e[key]))
        throw new Error("Canvas 화살표 형식이 잘못되었습니다.");
    edgeIds.add(e.id);
  }
  return {
    data,
    readOnly,
    warnings: readOnly
      ? ["지원하지 않는 카드 형식이 있어 읽기 전용입니다."]
      : [],
  };
}

export function rewriteCanvas(source, from, oldPath, newPath, files) {
  const { data } = parseCanvas(source);
  let changed = false;
  const nodes = (data.nodes ?? []).map((n) => {
    const next = { ...n };
    for (const key of ["file", "background"])
      if (n[key] === oldPath) {
        next[key] = newPath;
        changed = true;
      }
    if (n.type === "text") {
      next.text = rewriteLinks(n.text, from, oldPath, newPath, files);
      changed ||= next.text !== n.text;
    }
    return next;
  });
  return changed ? JSON.stringify({ ...data, nodes }, null, 2) + "\n" : source;
}
