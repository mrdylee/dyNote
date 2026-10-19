import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { buildGraph, selectGraph } from "../core/graph.mjs";
import { DEFAULT_FORCES } from "../core/graph-kernel.mjs";
import { createGraphRenderer } from "./graph-renderer.mjs";

const defaults = { ...DEFAULT_FORCES, nodeSize: 1, lineWidth: 1, labels: 1, local: false, depth: 1, incoming: true, outgoing: true, neighborLinks: true };
const ranges = [
  ["center", "중심 힘", 0, 5, 0.1], ["repel", "반발력", 0, 10000, 100],
  ["link", "연결 힘", 0, 2, 0.05], ["distance", "연결 거리", 10, 1000, 10],
  ["nodeSize", "점 크기", 0.5, 3, 0.1], ["lineWidth", "선 굵기", 0.2, 4, 0.1], ["labels", "이름 표시량", 0, 3, 0.1],
];
function readSettings(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key)), result = { ...defaults };
    for (const [name, , min, max] of [...ranges, ["depth", "", 1, 4]])
      if (Number.isFinite(saved?.[name])) result[name] = Math.max(min, Math.min(max, saved[name]));
    for (const name of ["local", "incoming", "outgoing", "neighborLinks"])
      if (typeof saved?.[name] === "boolean") result[name] = saved[name];
    return result;
  } catch { return { ...defaults }; }
}
export default function Graph({ notes, edges, active, onOpen, vaultId, fontFamily }) {
  const key = `dynote:graph:${vaultId}`;
  const [settings, setSettings] = useState(() => readSettings(key));
  const [path, setPath] = useState(""), [tag, setTag] = useState("");
  const [documentQuery, setDocumentQuery] = useState("");
  const zoomLabel = useRef(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("그래프 준비 중"), [error, setError] = useState("");
  const host = useRef(null), engine = useRef(null), worker = useRef(null), epoch = useRef(0), open = useRef(onOpen);
  open.current = onOpen;
  const graph = useMemo(() => buildGraph(notes, edges), [notes, edges]);
  const { local, depth, incoming, outgoing, neighborLinks, center, repel, link, distance, nodeSize, lineWidth, labels } = settings;
  const selected = useMemo(() => selectGraph(graph, { path, tag, active, local, depth, incoming, outgoing, neighborLinks }), [graph, path, tag, active, local, depth, incoming, outgoing, neighborLinks]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags ?? []))].sort(), [notes]);
  const choices = useMemo(() => {
    const query = documentQuery.toLocaleLowerCase();
    return selected.nodes.filter((n) => `${n.title} ${n.path}`.toLocaleLowerCase().includes(query)).slice(0, 50);
  }, [selected, documentQuery]);
  const send = (type, extra = {}) => worker.current?.postMessage({ type, epoch: epoch.current, ...extra });
  const update = (name, value) => setSettings((previous) => ({ ...previous, [name]: value }));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Storage may be unavailable; session controls still work. */ } }, [key, settings]);
  useEffect(() => {
    let cancelled = false, renderer, simulation;
    const visibility = () => send(document.hidden ? "pause" : "resume");
    createGraphRenderer(host.current, {
      onOpen: (path) => open.current(path), onPin: (index, x, y) => send("pin", { index, x, y }), onUnpin: (index) => send("unpin", { index }),
      onCamera: (value) => { if (!cancelled && zoomLabel.current) zoomLabel.current.textContent = `${Math.round(value * 100)}%`; },
    }).then((created) => {
      if (cancelled) { created.destroy(); return; }
      renderer = created; engine.current = created;
      simulation = new Worker(new URL("./graph.worker.mjs", import.meta.url), { type: "module" }); worker.current = simulation;
      simulation.onmessage = ({ data }) => {
        if (data.epoch === epoch.current && !cancelled) {
          if (data.type === "error") setError(data.message);
          if (data.type === "frame") { created.setPositions(new Float32Array(data.buffer)); setStatus(data.settled ? "배치 완료" : "연결 배치 중"); }
        }
        if (data.type === "frame") simulation.postMessage({ type: "recycle", epoch: data.epoch, buffer: data.buffer }, [data.buffer]);
      };
      simulation.onerror = (event) => { if (!cancelled) setError(event.message || "그래프 계산을 시작하지 못했습니다."); };
      document.addEventListener("visibilitychange", visibility); setReady(true);
    }).catch((error) => { if (!cancelled) setError(error.message); });
    return () => {
      cancelled = true; document.removeEventListener("visibilitychange", visibility);
      renderer?.destroy(); simulation?.terminate(); worker.current = null; engine.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const positions = engine.current.setGraph(selected), links = selected.links.slice();
    const radii = Float32Array.from(selected.nodes, (node) => 4 + Math.min(6, Math.sqrt(node.degree)));
    epoch.current++; setError(""); setStatus(selected.nodes.length ? "연결 배치 중" : "표시할 문서 없음");
    worker.current.postMessage({ type: "graph", epoch: epoch.current, positions, links, radii, settings: { center, repel, link, distance }, paused: document.hidden }, [positions.buffer, links.buffer, radii.buffer]);
  }, [selected, ready]);
  useEffect(() => { if (ready) send("settings", { settings: { center, repel, link, distance } }); }, [center, repel, link, distance, ready]);
  useEffect(() => { engine.current?.setDisplay({ nodeSize, lineWidth, labels }); }, [nodeSize, lineWidth, labels, ready]);
  useEffect(() => { engine.current?.setActive(active); }, [active, ready, selected]);
  useEffect(() => { if (fontFamily) engine.current?.setFont(fontFamily); }, [fontFamily, ready]);
  return (
    <div className="graph-view">
      <div className="graph-heading">
        <span className="eyebrow">CONNECTED THOUGHTS</span>
        <h1>생각의 연결을 살펴보세요</h1>
        <p>점을 선택해 문서를 열고, 끌어서 배치를 바꿔 보세요.</p>
        <div className="graph-filters">
          <input aria-label="그래프 경로 필터" placeholder="문서·폴더 경로" value={path} onChange={(e) => setPath(e.target.value)} />
          <select aria-label="그래프 태그 필터" value={tag} onChange={(e) => setTag(e.target.value)}><option value="">모든 태그</option>{tags.map((t) => <option key={t} value={t}>#{t}</option>)}</select>
          <label><input type="checkbox" checked={local} onChange={(e) => update("local", e.target.checked)} />현재 문서 주변</label>
          {local && <>
            <label>연결 깊이 <select aria-label="로컬 그래프 깊이" value={depth} onChange={(e) => update("depth", Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>
            {[["incoming", "들어오는 링크"], ["outgoing", "나가는 링크"], ["neighborLinks", "이웃 간 연결"]].map(([name, label]) => <label key={name}><input type="checkbox" checked={settings[name]} onChange={(e) => update(name, e.target.checked)} />{label}</label>)}
          </>}
        </div>
        <details className="graph-settings"><summary>표시 및 배치 설정</summary><div>{ranges.map(([name, label, min, max, step]) => <label key={name}>{label}<input aria-label={label} type="range" min={min} max={max} step={step} value={settings[name]} onChange={(e) => update(name, Number(e.target.value))} /><output>{settings[name]}</output></label>)}<button onClick={() => setSettings({ ...defaults })}>기본값 복원</button></div></details>
      </div>
      <div className="graph-stage" ref={host} />
      {error && <p className="graph-error" role="alert">그래프를 표시하지 못했습니다: {error}</p>}
      <div className="graph-footer">
        <div className="graph-document-picker"><input aria-label="그래프 문서 검색" placeholder="그래프에서 문서 찾기" value={documentQuery} onChange={(e) => setDocumentQuery(e.target.value)} /><select aria-label="그래프 문서 열기" value="" onChange={(e) => { if (e.target.value) onOpen(e.target.value); }}><option value="">문서 선택하여 열기 (최대 50개)</option>{choices.map((n) => <option key={n.path} value={n.path}>{n.path}</option>)}</select></div>
        <div className="graph-legend"><span className="legend-dot" />문서 <span className="legend-line" />문서 링크 <span>{selected.nodes.length}개 문서 · {selected.links.length / 2}개 연결 · <span role="status">{status}</span></span></div>
      </div>
      <div className="graph-controls"><button aria-label="그래프 축소" onClick={() => engine.current?.zoom(0.8)}><Minus size={16} /></button><span ref={zoomLabel}>100%</span><button aria-label="그래프 확대" onClick={() => engine.current?.zoom(1.25)}><Plus size={16} /></button><button aria-label="그래프 보기 초기화" onClick={() => engine.current?.fit()}><Scan size={16} /></button></div>
    </div>
  );
}
