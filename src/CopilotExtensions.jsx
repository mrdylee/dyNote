import { useEffect, useState } from "react";

export default function CopilotExtensions({ api, onClose }) {
  const [state, setState] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function run(operation) {
    setBusy(true); setError("");
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.error);
      setState(result.value);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { run(api.aiExtensions); }, []);
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Skill · MCP 관리">
    <div className="modal-heading"><h2>Skill · MCP 관리</h2><button onClick={onClose}>닫기</button></div>
    <p>등록한 확장은 이 PC의 Agent 요청에서 사용할 수 있습니다.</p>
    <button disabled={busy} onClick={() => run(api.aiAddSkills)}>Skill 폴더 추가</button>
    <button disabled={busy} onClick={() => run(api.aiImportMcp)}>MCP JSON 추가</button>
    {state && <ul>{[...state.skillDirectories.map(path => ({ kind: "skills", path })), ...state.configs.map(c => ({ kind: "config", path: c.path }))].map(item =>
      <li key={item.kind + item.path}>{item.path} <button disabled={busy} onClick={() => run(() => api.aiRemoveExtension(item))}>연결 해제</button></li>)}</ul>}
    {!!state?.servers.length && <p>연결된 MCP 서버 · {state.servers.map(s => s.name).join(", ")}</p>}
    {(error || state?.errors.length > 0) && <p role="alert">{error || state.errors.join(" · ")}</p>}
  </section></div>;
}
