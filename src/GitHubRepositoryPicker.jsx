import { useEffect, useRef, useState } from "react";

export default function GitHubRepositoryPicker({ onLogin, onCopy, onConnect, disabled }) {
  const [stage, setStage] = useState("idle"), [code, setCode] = useState("");
  const [repos, setRepos] = useState([]), [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const session = useRef(null), generation = useRef(0), timer = useRef(null), onReturn = useRef(null);
  const latestList = useRef(0);
  function clear() {
    generation.current++;
    clearTimeout(timer.current);
    if (onReturn.current) window.removeEventListener("focus", onReturn.current);
    onReturn.current = null;
    if (session.current) onLogin({action:"cancel", sessionId:session.current}).catch(() => {});
    session.current = null;
  }
  useEffect(() => clear, []);
  function reset() {
    clear(); setStage("idle"); setBusy(false); setChoice(""); setRepos([]); setError("");
  }
  async function list(id) {
    const request = ++latestList.current;
    const current = () => session.current === id && request === latestList.current;
    setBusy(true); setError("");
    try {
      const rows = await onLogin({action:"repositories", sessionId:id});
      if (!current()) return;
      setRepos(rows);
      setChoice(prior => rows.some(row => String(row.id) === prior) ? prior : rows.length === 1 ? String(rows[0].id) : "");
    } catch (e) {
      if (current()) setError(e.message);
    } finally { if (current()) setBusy(false); }
  }
  async function start() {
    reset();
    const attempt = generation.current;
    setStage("starting");
    try {
      const device = await onLogin({action:"start"});
      if (generation.current !== attempt) { await onLogin({action:"cancel", sessionId:device.id}); return; }
      session.current = device.id; setCode(device.userCode); setStage("waiting");
      const poll = async () => {
        try {
          const result = await onLogin({action:"poll", sessionId:device.id});
          if (session.current !== device.id) return;
          if (result.authorized) { setStage("choose"); await list(device.id); }
          else timer.current = setTimeout(poll, result.waitMs);
        } catch (e) { if (session.current === device.id) { reset(); setError(e.message); } }
      };
      timer.current = setTimeout(poll, device.waitMs);
    } catch (e) { if (generation.current === attempt) { reset(); setError(e.message); } }
  }
  async function install() {
    const id = session.current;
    if (onReturn.current) window.removeEventListener("focus", onReturn.current);
    onReturn.current = () => { if (session.current === id) list(id); };
    window.addEventListener("focus", onReturn.current, {once:true});
    try { await onLogin({action:"install", sessionId:id}); }
    catch (e) { if (session.current === id) setError(e.message); }
  }
  async function connect() {
    const id = session.current;
    setBusy(true); setError("");
    try {
      await onConnect({mode:"github-api", sessionId:id, repositoryId:Number(choice)});
      if (session.current === id) reset();
    } catch (e) { if (session.current === id) { setBusy(false); setError(e.message); } }
  }
  return <>
    {stage === "idle" && <button className="primary-button" disabled={disabled} onClick={start}>GitHub 로그인</button>}
    {stage === "starting" && <p role="status">GitHub 로그인 여는 중…</p>}
    {stage === "waiting" && <>
      <p role="status">열린 GitHub 페이지에 인증 코드 <strong>{code}</strong>를 입력하고 승인해 주세요.</p>
      <button className="secondary-button" onClick={() => onCopy(code).catch(e => setError(e.message))}>인증 코드 복사</button>
    </>}
    {stage === "choose" && <>
      {busy && <p role="status">GitHub에 연결 중…</p>}
      {repos.length > 0 ? <label>노트 저장소<select aria-label="노트 저장소" value={choice} disabled={busy || disabled} onChange={e => setChoice(e.target.value)}>
        <option value="">저장소 선택</option>{repos.map(repo => <option key={repo.id} value={repo.id}>{repo.name} · {repo.private ? "비공개" : "공개"}</option>)}
      </select></label> : !busy && !error && <p>GitHub에서 Dynote가 동기화할 노트 저장소를 허용해 주세요.</p>}
      <div className="settings-actions">
        {repos.length > 0 && <button className="primary-button" disabled={busy || disabled || !choice} onClick={connect}>선택한 저장소 연결</button>}
        <button className="secondary-button" disabled={busy} onClick={install}>GitHub에서 저장소 허용</button>
        <button className="secondary-button" disabled={busy} onClick={() => list(session.current)}>목록 새로고침</button>
      </div>
    </>}
    {stage !== "idle" && <button className="secondary-button" disabled={busy} onClick={reset}>로그인 취소</button>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </>;
}
