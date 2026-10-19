import { useMemo, useRef, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";

export default function Graph({
  notes: allNotes,
  edges: allEdges,
  active,
  onOpen,
}) {
  const [pathFilter, setPathFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const neighborhood = new Set([active]);
  if (local)
    for (let i = 0; i < depth; i++) {
      const previous = new Set(neighborhood);
      for (const edge of allEdges)
        if (previous.has(edge.source) || previous.has(edge.target)) {
          neighborhood.add(edge.source);
          neighborhood.add(edge.target);
        }
    }
  const notes = allNotes.filter(
    (n) =>
      n.path.toLowerCase().includes(pathFilter.toLowerCase()) &&
      (!tagFilter || n.tags?.includes(tagFilter)) &&
      (!local || neighborhood.has(n.path)),
  );
  const included = new Set(notes.map((n) => n.path));
  const edges = allEdges.filter(
    (e) => included.has(e.source) && included.has(e.target),
  );
  const tags = [...new Set(allNotes.flatMap((n) => n.tags ?? []))].sort();
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const drag = useRef(null);
  const [hover, setHover] = useState(null);
  const nodes = useMemo(() => {
    const degrees = Object.fromEntries(
      notes.map((n) => [
        n.path,
        edges.filter((e) => e.source === n.path || e.target === n.path).length,
      ]),
    );
    const ordered = [...notes].sort(
      (a, b) => degrees[b.path] - degrees[a.path],
    );
    return ordered.map((note, i) => {
      const angle = (i - 1) * 2.39996;
      const radius = i === 0 ? 0 : 100 + Math.sqrt(i) * 65;
      return {
        ...note,
        x: 450 + Math.cos(angle) * radius,
        y: 280 + Math.sin(angle) * radius * 0.76,
        degree: degrees[note.path],
      };
    });
  }, [notes, edges]);
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const focus = hover ?? active;
  const related = new Set(
    edges
      .filter((e) => e.source === focus || e.target === focus)
      .flatMap((e) => [e.source, e.target]),
  );
  return (
    <div className="graph-view">
      <div className="graph-heading">
        <span className="eyebrow">CONNECTED THOUGHTS</span>
        <h1>생각의 연결을 살펴보세요</h1>
        <p>점을 선택해 문서를 열고, 연결된 맥락을 따라가 보세요.</p>
        <div className="graph-filters">
          <input
            aria-label="그래프 경로 필터"
            placeholder="문서·폴더 경로"
            value={pathFilter}
            onChange={(e) => setPathFilter(e.target.value)}
          />
          <select
            aria-label="그래프 태그 필터"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
          >
            <option value="">모든 태그</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={local}
              onChange={(e) => setLocal(e.target.checked)}
            />
            현재 문서 주변
          </label>
          {local && (
            <label>
              연결 깊이{" "}
              <select
                aria-label="로컬 그래프 깊이"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      <svg
        aria-label="문서 연결 그래프"
        role="img"
        viewBox="0 0 900 560"
        onWheel={(e) =>
          setCamera((c) => ({
            ...c,
            zoom: Math.min(2, Math.max(0.45, c.zoom - e.deltaY * 0.001)),
          }))
        }
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            drag.current = { x: e.clientX, y: e.clientY, camera };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const scale = 900 / e.currentTarget.getBoundingClientRect().width;
            setCamera({
              ...drag.current.camera,
              x: drag.current.camera.x + (e.clientX - drag.current.x) * scale,
              y: drag.current.camera.y + (e.clientY - drag.current.y) * scale,
            });
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <g
          transform={`translate(${camera.x + 450 * (1 - camera.zoom)} ${camera.y + 280 * (1 - camera.zoom)}) scale(${camera.zoom})`}
        >
          {edges.map((edge) => {
            const a = byPath.get(edge.source);
            const b = byPath.get(edge.target);
            return a && b ? (
              <line
                key={edge.source + edge.target}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={
                  edge.source === focus || edge.target === focus
                    ? "graph-edge focused"
                    : "graph-edge"
                }
              />
            ) : null;
          })}
          {nodes.map((node) => (
            <g
              key={node.path}
              className={`graph-node ${node.path === active ? "selected" : ""} ${focus && !related.has(node.path) && focus !== node.path ? "dimmed" : ""}`}
              transform={`translate(${node.x} ${node.y})`}
              role="button"
              tabIndex={0}
              aria-label={`문서 열기: ${node.title}`}
              onMouseEnter={() => setHover(node.path)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onOpen(node.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(node.path);
              }}
            >
              <circle className="node-halo" r={24 + node.degree} />
              <circle className="node-dot" r={5 + Math.min(6, node.degree)} />
              <text textAnchor="middle" y={32}>
                {node.title.length > 18
                  ? node.title.slice(0, 18) + "…"
                  : node.title}
              </text>
            </g>
          ))}
        </g>
      </svg>
      <div className="graph-legend">
        <span className="legend-dot" />
        문서 <span className="legend-line" />
        문서 링크{" "}
        <span>
          {notes.length}개 문서 · {edges.length}개 연결
        </span>
      </div>
      <div className="graph-controls">
        <button
          aria-label="그래프 축소"
          onClick={() =>
            setCamera((c) => ({ ...c, zoom: Math.max(0.45, c.zoom - 0.15) }))
          }
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(camera.zoom * 100)}%</span>
        <button
          aria-label="그래프 확대"
          onClick={() =>
            setCamera((c) => ({ ...c, zoom: Math.min(2, c.zoom + 0.15) }))
          }
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="그래프 보기 초기화"
          onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}
        >
          <Scan size={16} />
        </button>
      </div>
    </div>
  );
}
