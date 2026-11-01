import { useEffect, useState } from "react";

const empty = { configs: [], skillDirectories: [], servers: [], errors: [] };
const nameOf = value => value.split(/[\\/]/).at(-1);

export default function AiExtensions({ api, disabled, onBusy }) {
  const [snapshot, setSnapshot] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    if (api.aiExtensions) api.aiExtensions().then(result => {
      if (!alive) return;
      if (result.ok) setSnapshot(result.value); else setError(result.error);
    }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [api]);
  const change = async action => {
    if (busy || disabled) return;
    setBusy(true); onBusy(true); setError("");
    try {
      const result = await action();
      if (!result.ok) throw new Error(result.error);
      setSnapshot(result.value);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); onBusy(false); }
  };
  return <details className="ai-extensions">
    <summary>MCP·스킬</summary>
    <p>연결한 MCP와 스킬은 Copilot·Codex의 Agent에서 사용합니다. MCP 설정 파일은 서버 실행 명령이나 서비스 주소를 포함합니다.</p>
    <div className="ai-extension-actions"><button type="button" disabled={disabled || busy} onClick={() => change(() => api.aiImportMcp())}>MCP 설정 연결</button><button type="button" disabled={disabled || busy} onClick={() => change(() => api.aiAddSkills())}>스킬 폴더 연결</button></div>
    {snapshot.servers.length > 0 && <p>{snapshot.servers.map(server => <span className="ai-extension-server" key={server.name}>{server.name}</span>)}</p>}
    {snapshot.configs.map(config => <div className="ai-extension-source" key={config.path}><span title={config.path}>{config.name}</span><button type="button" aria-label={`${config.name} 연결 해제`} disabled={disabled || busy} onClick={() => change(() => api.aiRemoveExtension({ kind: "config", path: config.path }))}>해제</button></div>)}
    {snapshot.skillDirectories.map(directory => <div className="ai-extension-source" key={directory}><span title={directory}>{nameOf(directory)}</span><button type="button" aria-label={`${nameOf(directory)} 연결 해제`} disabled={disabled || busy} onClick={() => change(() => api.aiRemoveExtension({ kind: "skills", path: directory }))}>해제</button></div>)}
    <p>스킬 지침과 참고 파일을 읽을 수 있습니다. 스크립트 실행에는 해당 기능을 제공하는 MCP 도구가 필요합니다.</p>
    {[...snapshot.errors, ...(error ? [error] : [])].map((message, index) => <p role="alert" key={index}>{message}</p>)}
  </details>;
}
