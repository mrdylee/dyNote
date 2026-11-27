import { useEffect, useRef, useState } from "react";

import { DocumentPanes } from "./DocumentWorkspace.jsx";

function copyPath(name, id) {
  const lastDot = name.lastIndexOf(".");
  const dot = lastDot > name.lastIndexOf("/") ? lastDot : name.length;
  return name.slice(0, dot) + " (" + id.slice(0, 8) + ")" + name.slice(dot);
}

function ComparisonPane({id, slot, rows, other, parts, target, selected, picks, busy, onSwitch, onPick, capture}) {
  const body = useRef(null);
  useEffect(() => {
    const view = body.current;
    const block = view.querySelectorAll(".comparison-block")[target];
    if (block) view.scrollTop += block.getBoundingClientRect().top - view.getBoundingClientRect().top - 24;
  }, [target, id, parts]);
  const version = rows.find(v => v.commit === id);
  const center = slot === "original";
  const title = center ? "병합 결과" : version.device || version.author;
  let hunkIndex = 0;
  return <section className="document-pane comparison-pane" aria-label={title}>
    <header className="pane-header">
      {version && rows.length > 2
        ? <select aria-label={"비교할 수정본 " + (slot === "left" ? 1 : 2)} value={id} onChange={e => onSwitch(e.target.value)}>
            {rows.map(v => <option key={v.commit} value={v.commit} disabled={v.commit === other}>
              {v.device || v.author} · {new Date(v.time).toLocaleString()} · {v.commit.slice(0, 8)}
            </option>)}
          </select>
        : <strong>{title}</strong>}
      {center && <small>공통 원문 기준</small>}
      {version && rows.length === 2 && <small>{new Date(version.time).toLocaleString()}</small>}
    </header>
    <div className="comparison-body" ref={body} tabIndex={0} aria-label={title + " 전체 본문"}>
      {parts.map(part => {
        if (typeof part === "string") return part;
        const text = part.alternatives[id] ?? part.original;
        if (!part.key) return center ? part.merged : text;
        const number = ++hunkIndex;
        const pick = picks[part.key];
        const source = pick ?? selected;
        const taken = Object.hasOwn(part.alternatives, source);
        if (!center) {
          const direction = slot === "left" ? "왼쪽" : "오른쪽";
          const label = `충돌 ${number} · ${direction} 수정본을 가운데에 반영`;
          return <div className="comparison-block comparison-source" data-slot={slot} key={part.key} data-resolved={source === "original" || taken}>
            <div className="comparison-block-tools"><strong>충돌 {number}</strong></div>
            <span className="comparison-value">{text || "(삭제)"}</span>
            <button type="button" className="comparison-arrow" title={label} aria-label={label} aria-pressed={source === id}
              disabled={busy || !Object.hasOwn(part.alternatives, id)} onClick={() => onPick(part.key, id)}>
              {capture && "이 내용 사용 "}{slot === "left" ? "→" : "←"}
            </button>
          </div>;
        }
        return <div className="comparison-block" key={part.key} data-resolved={source === "original" || taken}>
          <div className="comparison-block-tools">
            <strong>충돌 {number}</strong>
            <span className="comparison-output-actions">
              <button type="button" aria-pressed={source === "original"} disabled={busy} onClick={() => onPick(part.key, "original")}>원문 유지</button>
              {pick && <button type="button" disabled={busy} onClick={() => onPick(part.key, null)}>되돌리기</button>}
            </span>
          </div>
          {taken && part.alternatives[source] !== part.original ? <>
            <del aria-label="공통 원문">{part.original || "(빈 원문)"}</del>
            <ins aria-label="반영할 내용">{part.alternatives[source] || "(삭제)"}</ins>
          </> : <span className="comparison-value">{part.original || "(빈 원문)"}</span>}
        </div>;
      })}
    </div>
  </section>;
}

export default function PersonalVersionReview({ path, count, action, onClose, onResolved, applyLabel }) {
  const [rows, setRows] = useState([]),
    [basis, setBasis] = useState([]),
    [current, setCurrent] = useState(null);
  const [selected, select] = useState(""),
    [parts, setParts] = useState(null),
    [compared, setCompared] = useState([]),
    [target, setTarget] = useState(0),
    [picks, setPicks] = useState({});
  const hunks = parts?.filter(part => part.key) ?? [];
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [error, setError] = useState(""),
    [limit, setLimit] = useState(50);
  const [both, setBoth] = useState(false),
    [names, setNames] = useState({}),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    async function load() {
      const initial = await action({ action: "versions", path }),
        all = [...initial.versions];
      for (let skip = 50; skip < Math.min(limit, initial.basis.length); skip += 50) {
        const page = await action({ action: "versions", path, skip });
        if (JSON.stringify(initial.basis) !== JSON.stringify(page.basis)) {
          if (active) setReload((n) => n + 1);
          return;
        }
        all.push(...page.versions);
      }
      if (!active) return;
      setRows((old) => [
        ...old.filter((v) => all.some((a) => a.commit === v.commit)),
        ...all.filter((v) => !old.some((o) => o.commit === v.commit)),
      ]);
      setBasis(initial.basis);
      setCurrent(initial.current);
      const comparison = initial.basis.length ? await action({ action: "comparison", path }) : {basis: [], parts: null};
      if (active) {
        if (JSON.stringify(comparison.basis) !== JSON.stringify(initial.basis)) {
          setReload(n => n + 1);
          return;
        }
        setLoading(false);
        setParts(comparison.parts);
        setCompared(old => {
          const newest = [...all].reverse();
          const left = all.find(v => v.commit === old[0]) ?? newest[0];
          const rest = newest.filter(v => v !== left);
          const right = rest.find(v => v.commit === old[1])
            ?? rest.find(v => (v.id || v.author) !== (left.id || left.author)) ?? rest[0];
          return [left?.commit, right?.commit].filter(Boolean);
        });
        select((old) => (initial.basis.includes(old) ? old : ""));
      }
    }
    load().catch((e) => {
      if (active) { setLoading(false); setParts(null); setLoadError(e.message); }
    });
    return () => {
      active = false;
    };
  }, [path, count, limit, reload]);
  const keepsDeletion = !hunks.length && rows.some(v => v.commit === selected && !v.blob);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const copies = both
        ? Object.fromEntries(
            rows
              .filter((v) => v.commit !== selected && v.blob)
              .map((v) => [v.commit, names[v.commit] ?? copyPath(path, v.commit)])
          )
        : undefined;
      await action({
        action: "resolve",
        path,
        basis,
        commit: selected || rows[0].commit,
        options: { hunks: hunks.map((h) => picks[h.key] ?? selected), copies },
      });
      if (onResolved) await onResolved({keepsDeletion});
      else onClose();
    } catch (e) {
      setError(e.message);
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }
  async function continueResolved() {
    setBusy(true);
    setError("");
    try {
      const latest = await action({action:"versions", path});
      if (latest.basis.length || latest.current !== current) setReload(n => n + 1);
      else await onResolved({keepsDeletion:latest.current === null});
    }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function download(v) {
    try {
      const bytes = await action({ action: "preview", path, commit: v.commit });
      const url = URL.createObjectURL(new Blob([bytes])),
        link = document.createElement("a");
      link.download = copyPath(path.split("/").pop(), v.commit);
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(e.message);
    }
  }
  const remaining = hunks.filter(h => {
    const choice = picks[h.key] ?? selected;
    return choice !== "original" && !Object.hasOwn(h.alternatives, choice);
  }).length;
  const ready = hunks.length ? remaining === 0 : !!selected;
  const actions = (
    <div className="settings-actions">
        {!!hunks.length && <span role="status">{remaining ? `미해결 충돌 ${remaining}개` : "모든 충돌 선택 완료"}</span>}
        <button
          className="primary-button"
          disabled={busy || loading || !!loadError || !ready || rows.length !== basis.length}
          onClick={apply}
        >
          {(onResolved && keepsDeletion ? "삭제 유지하고 가져오기 중단" : applyLabel) || (hunks.length ? "선택한 내용 반영" : "선택한 버전으로 적용")}
        </button>
        <button disabled={busy} onClick={onClose}>
          나중에
        </button>
      </div>
  );
  const versions = (
    <fieldset disabled={busy}>
        <legend>검토할 버전 {basis.length}개</legend>
        {rows.map((v) => (
          <div key={v.commit}>
            <label>
              <input
                type="radio"
                name="version"
                checked={selected === v.commit && !Object.keys(picks).length}
                onChange={() => { select(v.commit); setPicks({}); }}
              />
              {hunks[0]?.alternatives[v.commit]?.trim().slice(0, 120) || (onResolved && rows.some(row => !row.blob) ? (v.blob ? "파일 복원" : "삭제 유지") : (v.blob ? "파일 수정" : "파일 삭제"))} ·{" "}
              {v.device || v.author} · {new Date(v.time).toLocaleString()}
              {v.blob === current ? " · 현재 상태" : ""}
            </label>
            {v.blob && <button onClick={() => download(v)}>이 버전 저장</button>}
          </div>
        ))}
        {rows.length < basis.length && <button onClick={() => setLimit((n) => n + 50)}>이전 버전 더 보기</button>}
      </fieldset>
  );
  return (
    <section className="settings-section">
      <h3>{path}</h3>
      {loading && <p role="status">{count ? `버전 ${count}개 불러오는 중…` : "버전 불러오는 중…"}</p>}
      {loadError && <p role="alert">{loadError} <button onClick={() => setReload(n => n + 1)}>다시 불러오기</button></p>}
      {!loading && !loadError && !basis.length && <p role="status">
        {onResolved && current === null ? "충돌이 해결되었고 현재 버전에서 이 파일은 삭제되었습니다." : "이 노트에 남은 충돌이 없습니다."}
        {onResolved && <button disabled={busy} onClick={continueResolved}>{current === null ? "삭제 유지하고 가져오기 중단" : "가져오기 계속"}</button>}
      </p>}
      {parts && compared.length === 2 && compared.every(id => rows.some(v => v.commit === id)) && <div className="version-workspace">
        {hunks.length > 1 && <label className="comparison-jump">겹친 구간으로 이동
          <select value={Math.min(target, hunks.length - 1)} onChange={e => setTarget(Number(e.target.value))}>
            {hunks.map((h, i) => <option key={h.key} value={i}>겹친 구간 {i + 1}</option>)}
          </select>
        </label>}
        <DocumentPanes panes={[{key:"left", id:compared[0]}, {key:"original", id:"original"}, {key:"right", id:compared[1]}]}
          renderPane={({key, id}) => <ComparisonPane slot={key} id={id} rows={rows} other={compared[key === "left" ? 1 : 0]}
            capture={!!onResolved} parts={parts} target={Math.min(target, hunks.length - 1)} selected={selected} picks={picks} busy={busy}
            onSwitch={id => setCompared(old => key === "left" ? [id, old[1]] : [old[0], id])}
            onPick={(key, pick) => setPicks(old => {
              const next = { ...old };
              if (pick) next[key] = pick;
              else delete next[key];
              return next;
            })}/>}/>
      </div>}
      {parts && actions}
      {basis.length > 0 && (hunks.length ? <details className="comparison-versions">
        <summary>버전별 선택 및 저장 · {basis.length}개</summary>
        {versions}
      </details> : versions)}
      {!/\.md$/i.test(path) && selected && (
        <>
          <label>
            <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} />
            모두 유지
          </label>
          {both &&
            rows
              .filter((v) => v.blob && v.commit !== selected)
              .map((v) => (
                <label key={v.commit}>
                  {v.device || v.author} 사본 경로
                  <input
                    value={names[v.commit] ?? copyPath(path, v.commit)}
                    onChange={(e) => setNames((old) => ({ ...old, [v.commit]: e.target.value }))}
                  />
                </label>
              ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!parts && basis.length > 0 && actions}
    </section>
  );
}
