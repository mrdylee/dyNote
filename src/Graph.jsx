import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, Scan, SlidersHorizontal, X, RotateCcw, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { buildVaultGraph, selectGraph, graphColors } from "../core/graph.mjs";
import { GRAPH_DEFAULTS, GRAPH_RANGES, normalizeGraphSettings } from "../core/graph-options.mjs";
import { createGraphRenderer } from "./graph-renderer.mjs";

function readSettings(key) {
  try { return normalizeGraphSettings(JSON.parse(localStorage.getItem(key))); }
  catch { return normalizeGraphSettings(null); }
}
const emptyFiles = [];
export default function Graph({ notes, edges, attachments = emptyFiles, documents = emptyFiles, active, onOpen, vaultId, fontFamily }) {
  const key = `dynote:graph:${vaultId}`;
  const [settings, setSettings] = useState(() => readSettings(key));
  const [notice, setNotice] = useState(""), [replaying, setReplaying] = useState(false);
  const [documentQuery, setDocumentQuery] = useState("");
  const zoomLabel = useRef(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("그래프 준비 중"), [error, setError] = useState("");
  const host = useRef(null), engine = useRef(null), worker = useRef(null), epoch = useRef(0), open = useRef(onOpen);
  open.current = (path) => {
    const node = selected.nodes[selected.index.get(path)];
    if (node?.type === "tag") { update("tag", node.tags[0]); setNotice(`${node.title} 태그의 문서를 표시합니다.`); }
    else if (node?.type === "missing") setNotice(`아직 없는 문서: ${node.title}`);
    else onOpen(path);
  };
  const graph = useMemo(() => buildVaultGraph(notes, edges, attachments, documents), [notes, edges, attachments, documents]);
  const { local, depth, incoming, outgoing, neighborLinks, center, repel, link, distance, nodeSize, lineWidth, labelThreshold, arrows, query, path, tag, showTags, showAttachments, existingOnly, showOrphans } = settings;
  const selected = useMemo(() => selectGraph(graph, { path, tag, active, local, depth, incoming, outgoing, neighborLinks, query, showTags, showAttachments, existingOnly, showOrphans }), [graph, path, tag, active, local, depth, incoming, outgoing, neighborLinks, query, showTags, showAttachments, existingOnly, showOrphans]);
  const tags = useMemo(() => [...new Set(notes.flatMap((n) => n.tags ?? []))].sort(), [notes]);
  const choices = useMemo(() => {
    const query = documentQuery.toLocaleLowerCase();
    return selected.nodes.filter((n) => !["tag", "missing"].includes(n.type)).filter((n) => `${n.title} ${n.path}`.toLocaleLowerCase().includes(query)).slice(0, 50);
  }, [selected, documentQuery]);
  const send = (type, extra = {}) => worker.current?.postMessage({ type, epoch: epoch.current, ...extra });
  const update = (name, value) => setSettings((previous) => ({ ...previous, [name]: value }));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Storage may be unavailable; session controls still work. */ } }, [key, settings]);
  useEffect(() => {
    let cancelled = false, renderer, simulation;
    const visibility = () => send(document.hidden ? "pause" : "resume");
    createGraphRenderer(host.current, {
      onOpen: (path) => open.current(path), onPin: (index, x, y) => send("pin", { index, x, y }), onUnpin: (index) => send("unpin", { index }),
      onReplay: (value) => { if (!cancelled) setReplaying(value); },
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
  useEffect(() => { engine.current?.setDisplay({ nodeSize, lineWidth, labelThreshold, arrows }); }, [nodeSize, lineWidth, labelThreshold, arrows, ready]);
  useEffect(() => { engine.current?.setColors(graphColors(selected.nodes, settings.groups)); }, [selected, settings.groups, ready]);
  useEffect(() => { engine.current?.setActive(active); }, [active, ready, selected]);
  useEffect(() => { if (fontFamily) engine.current?.setFont(fontFamily); }, [fontFamily, ready]);
  const toggle = (name, label) => <label className="graph-toggle" key={name}><span>{label}</span><input type="checkbox" checked={settings[name]} onChange={(e) => update(name, e.target.checked)} /></label>;
  const range = ([name, label, min, max, step]) => <label className="graph-range" key={name}><span>{label}<output>{settings[name]}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={settings[name]} onChange={(e) => update(name, Number(e.target.value))} /></label>;
  const section = (name, title, children) => <section className="graph-setting-section"><button className="graph-section-title" aria-expanded={settings[name]} onClick={() => update(name, !settings[name])}>{settings[name] ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{title}</button>{settings[name] && <div className="graph-section-content">{children}</div>}</section>;
  const editGroup = (index, patch) => update("groups", settings.groups.map((g, i) => i === index ? { ...g, ...patch } : g));
  const moveGroup = (index, delta) => { const groups = [...settings.groups]; [groups[index], groups[index + delta]] = [groups[index + delta], groups[index]]; update("groups", groups); };
  return (
    <div className="graph-view">
      <div className="graph-heading"><span className="eyebrow">CONNECTED THOUGHTS</span><h1>생각의 연결</h1><p>점을 선택해 문서를 열고, 끌어서 배치를 바꿔 보세요.</p></div>
      <div className="graph-body">
        <div className="graph-stage" ref={host} />
        {!settings.panelOpen && <button className="graph-settings-open" aria-label="그래프 설정 열기" onClick={() => update("panelOpen", true)}><SlidersHorizontal size={17} /> 그래프 설정</button>}
        {settings.panelOpen && <aside className="graph-settings-panel" aria-label="그래프 설정">
          <div className="graph-panel-header"><strong>그래프 설정</strong><button aria-label="그래프 설정 초기화" title="모든 그래프 설정 초기화" onClick={() => { engine.current?.stopReplay(); setSettings(normalizeGraphSettings(GRAPH_DEFAULTS)); setNotice(""); }}><RotateCcw size={16} /></button><button aria-label="그래프 설정 닫기" onClick={() => update("panelOpen", false)}><X size={17} /></button></div>
          {section("filtersOpen", "필터", <>
            <input aria-label="그래프 파일 검색" placeholder="파일 검색…" value={query} maxLength={1000} onChange={(e) => update("query", e.target.value)} />
            <small>이름·경로, path:, file:, tag:, -제외, "구문" · 조건은 AND</small>
            {toggle("showTags", "태그")}{toggle("showAttachments", "첨부 파일")}{toggle("existingOnly", "존재하는 파일만 표시")}{toggle("showOrphans", "미연결 노트")}
            <input aria-label="그래프 경로 필터" placeholder="문서·폴더 경로" value={path} maxLength={1000} onChange={(e) => update("path", e.target.value)} />
            <select aria-label="그래프 태그 필터" value={tag} onChange={(e) => update("tag", e.target.value)}><option value="">모든 태그</option>{tags.map((t) => <option key={t} value={t}>#{t}</option>)}</select>
            {toggle("local", "현재 문서 주변")}
            {local && <><label className="graph-toggle">연결 깊이<select aria-label="로컬 그래프 깊이" value={depth} onChange={(e) => update("depth", Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></label>{toggle("incoming", "들어오는 링크")}{toggle("outgoing", "나가는 링크")}{toggle("neighborLinks", "이웃 간 연결")}</>}
          </>)}
          {section("groupsOpen", "그룹", <>
            <small>위에서 처음 일치하는 그룹의 색상을 적용합니다.</small>
            {settings.groups.map((group, i) => <div className="graph-group" key={i}>
              <div><input aria-label={`그룹 ${i + 1} 검색`} placeholder="path:work 또는 tag:project" value={group.query} maxLength={1000} onChange={(e) => editGroup(i, { query: e.target.value })} /><input type="color" aria-label={`그룹 ${i + 1} 색상`} value={group.color} onChange={(e) => editGroup(i, { color: e.target.value })} /></div>
              <div className="graph-group-actions"><button disabled={!i} aria-label={`그룹 ${i + 1} 위로`} onClick={() => moveGroup(i, -1)}><ArrowUp size={14} /></button><button disabled={i === settings.groups.length - 1} aria-label={`그룹 ${i + 1} 아래로`} onClick={() => moveGroup(i, 1)}><ArrowDown size={14} /></button><button aria-label={`그룹 ${i + 1} 삭제`} onClick={() => update("groups", settings.groups.filter((_, j) => i !== j))}><Trash2 size={14} /></button></div>
            </div>)}
            <button className="graph-wide-button" disabled={settings.groups.length >= 64} onClick={() => update("groups", [...settings.groups, { query: "", color: ["#9871c2", "#49a591", "#da8a54", "#588fc9"][settings.groups.length % 4] }])}><Plus size={14} /> 새 그룹</button>
          </>)}
          {section("displayOpen", "표시", <>{toggle("arrows", "화살표")}{GRAPH_RANGES.slice(4).map(range)}<small>표시 시작점이 클수록 더 확대해야 이름이 보입니다.</small><button className="graph-wide-button" disabled={!selected.nodes.length} onClick={() => replaying ? engine.current?.stopReplay() : engine.current?.replay()}>{replaying ? "애니메이션 중지" : "애니메이션 재생"}</button><small>문서의 생성·수정 시간 순서로 표시합니다.</small></>)}
          {section("forcesOpen", "장력", GRAPH_RANGES.slice(0, 4).map(range))}
        </aside>}
      </div>
      {error && <p className="graph-error" role="alert">그래프를 표시하지 못했습니다: {error}</p>}
      {notice && <p className="graph-notice" role="status">{notice}</p>}
      <div className="graph-footer">
        <div className="graph-document-picker"><input aria-label="그래프 문서 검색" placeholder="그래프에서 문서 찾기" value={documentQuery} onChange={(e) => setDocumentQuery(e.target.value)} /><select aria-label="그래프 문서 열기" value="" onChange={(e) => { if (e.target.value) onOpen(e.target.value); }}><option value="">문서 선택하여 열기 (최대 50개)</option>{choices.map((n) => <option key={n.path} value={n.path}>{n.path}</option>)}</select></div>
        <div className="graph-legend"><span className="legend-dot" />문서·태그 <span className="legend-line" />링크 <span>{selected.nodes.length}개 노드 · {selected.links.length / 2}개 연결 · <span role="status">{status}</span></span></div>
        <div className="graph-controls"><button aria-label="그래프 축소" onClick={() => engine.current?.zoom(0.8)}><Minus size={16} /></button><span ref={zoomLabel}>100%</span><button aria-label="그래프 확대" onClick={() => engine.current?.zoom(1.25)}><Plus size={16} /></button><button aria-label="그래프 보기 초기화" onClick={() => engine.current?.fit()}><Scan size={16} /></button></div>
      </div>
    </div>
  );
}
