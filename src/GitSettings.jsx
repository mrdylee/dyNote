import { useEffect, useRef, useState } from "react";
import LocalOnlyFiles from "./LocalOnlyFiles.jsx";
import GitHubRepositoryPicker from "./GitHubRepositoryPicker.jsx";

const initial = { remote: "", branch: "main", authorName: "", authorEmail: "", schedule: "daily", push: true };
export default function GitSettings({ startPersonal = false, status, space, onRepositoryStatus, onManageSpaces, onConnect, onGitHubLogin, onClone, onSync, onDisconnect, onZips, onAction, onReview, onCopyDiagnostics, onShowRecovery }) {
  const [form, setForm] = useState(() => ({ ...initial, ...status.config,
    ...(startPersonal && status.config?.mode !== "github-api" ? {mode:status.config ? "personal-sync" : status.suggestedMode ?? "personal-sync"} : {}) }));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(null);
  const edited = useRef(new Set());
  const [repository, setRepository] = useState(null), [refresh, setRefresh] = useState(0);
  const [zipPaths,setZipPaths]=useState(null);
  const personal=form.mode==="personal-sync" && space?.purpose==="personal";
  const apiMode = form.mode === "github-api" && space?.purpose === "personal";
  const [token,setToken] = useState("");
  const connectedPersonal = status.config?.mode === "personal-sync";
  useEffect(()=>{
    let current=true; setZipPaths(null);
    if(personal) onZips().then(list=>{if(current)setZipPaths(list);}).catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[personal,space?.id]);
  useEffect(() => {
    let mounted = true;
    setRepository(null);
    if (apiMode) return;
    onRepositoryStatus().then(value => { if (!mounted) return;
      setRepository(value);
      if (startPersonal && !status.config?.remote && value.available) {
        setForm(old => ({ ...old,
          remote: edited.current.has("remote") ? old.remote : value.suggestedRemote || old.remote,
          branch: edited.current.has("branch") ? old.branch : value.branchName || old.branch,
        }));
      } }).catch(error => { if (mounted) setRepository({ error: error.message }); });
    return () => { mounted = false; };
  }, [refresh,apiMode]);
  const update = (key, value) => { edited.current.add(key); setForm(previous => ({ ...previous, [key]: value })); };
  const run = async (action) => {
    setPending(true); setError("");
    try { await action(); } catch (error) { setError(error.message); } finally { setPending(false); }
  };
  const busy = pending || status.phase === "saving";
  const modeSelect = space?.purpose==="personal" && <label>Git 사용 방식<select value={form.mode || "daily"} disabled={busy}
    onChange={e=>{setToken("");setError("");update("mode",e.target.value);}}>
    <option value="daily">하루 한 번 백업</option><option value="personal-sync">여러 PC에서 이어 쓰기</option>
    <option value="github-api">GitHub API로 이어 쓰기</option></select></label>;
  if (apiMode) return <section className="settings-section">
    <h3>개인 노트 동기화</h3>{modeSelect}
    <p>GitHub에 로그인하고 노트 저장소를 선택하세요. 다른 PC에서도 일반 노트 폴더를 같은 저장소에 연결하면 이어 쓸 수 있습니다. File Storage 안의 일반 파일은 확장자와 관계없이 파일당 25 MiB까지 전송합니다.</p>
    <label>노트 폴더<code>{space.root}</code></label>
    {status.enabled && status.config?.mode === "github-api" && <p>연결된 저장소 <strong>{status.config.remote.replace("https://github.com/","").replace(/\.git$/,"")}</strong> · {status.config.branch}</p>}
    <GitHubRepositoryPicker onLogin={args => { if (args.action === "start") setError(""); return onGitHubLogin(args); }}
      onCopy={onCopyDiagnostics} disabled={busy} onConnect={async config => {
        setError(""); setPending(true);
        try { return await onConnect(config); } finally { setPending(false); }
      }}/>
    <details><summary>주소와 토큰으로 직접 연결</summary>
    <label>GitHub 저장소 주소<input value={form.remote} placeholder="https://github.com/사용자/저장소" disabled={busy} onChange={e=>update("remote",e.target.value)}/></label>
    <label>브랜치<input value={form.branch} disabled={busy} onChange={e=>update("branch",e.target.value)}/></label>
    <label>GitHub 토큰<input type="password" autoComplete="off" value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/></label>
    <p>이 저장소의 Contents 읽기·쓰기 권한이 필요합니다. 토큰은 이 PC의 보안 저장소로 암호화합니다.</p>
    <div className="settings-actions">
      <button className="primary-button" disabled={busy || !form.remote || !form.branch || !token.trim()} onClick={()=>run(async()=>{
        await onConnect({mode:"github-api",remote:form.remote,branch:form.branch,token});setToken("");
      })}>연결하고 동기화</button>
    </div></details>
    <div className="settings-actions">
      <button className="secondary-button" disabled={busy || !status.enabled || status.config?.mode !== "github-api"} onClick={()=>run(()=>onSync(true))}>지금 동기화</button>
      <button className="secondary-button" disabled={busy || !status.enabled || status.config?.mode !== "github-api"} onClick={()=>run(onDisconnect)}>이 기기 동기화 끄기</button>
      <button className="secondary-button" disabled={busy} onClick={onManageSpaces}>개인·팀 공간 관리</button>
    </div>
    <p className={`settings-message ${status.phase}`} role="status">{status.message}</p>
    {status.apiConflicts?.length>0 && <ul aria-label="최근 처리한 충돌">{status.apiConflicts.map(item=><li key={item}>{item}</li>)}</ul>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </section>;
  return <section className="settings-section">
    <h3>{personal ? "개인 노트 동기화" : "자동 백업"}</h3>
    <div className="git-space-context" aria-label="현재 공간의 Git 연결">
      <strong>{space?.purpose === "personal" ? "개인 노트" : space?.purpose === "team" ? "팀 공유 노트" : "용도 미지정"} · {space?.name ?? "현재 공간"}</strong>
      <dl><dt>노트 폴더</dt><dd>{space?.root ?? "폴더 정보를 불러오는 중…"}</dd>
        <dt>저장소 Git 원격</dt><dd>{!repository ? "Git 정보를 불러오는 중…" : repository.error ? <span role="status">Git 정보를 확인하지 못했습니다: {repository.error}</span> : !repository.available ? "이 폴더에 Git 저장소가 없습니다." : !repository.remoteUrls.length ? "등록된 원격 주소가 없습니다. 로컬 Git 저장소입니다." :
          <ul className="git-remote-urls">{repository.remoteUrls.map(remote => <li key={remote.name}><strong>{remote.name}</strong>{[["fetch", "가져오기"], ["push", "업로드"]].map(([key, label]) => <div key={key}>{label}: {remote[key].length ? remote[key].map((url, index) => <code key={index}>{url}</code>) : "주소 미설정"}</div>)}</li>)}</ul>}</dd>
        <dt>자동 백업 대상</dt><dd className="git-backup-target">{status.config?.remote || "자동 백업 대상 미설정"}</dd>
      </dl>
      <button className="secondary-button" disabled={busy || !repository} onClick={() => setRefresh(value => value + 1)}>원격 주소 새로고침</button>
      <p>Git 원격은 로컬 저장소에 등록된 주소입니다. 인증정보는 제외하고 표시합니다. Dynote 자동 백업 대상은 아래에서 별도로 설정합니다.</p>
      <p>이 설정은 현재 공간에만 적용됩니다. 개인 공간과 팀 공간에 서로 다른 폴더·Git 저장소 주소를 사용하세요.</p>
      <p className="muted">개인·팀 표시는 Git 접근 권한을 바꾸지 않습니다. 업로드한 문서는 연결된 저장소의 접근 권한을 따릅니다.</p>
      <button className="secondary-button" disabled={busy} onClick={onManageSpaces}>개인·팀 공간 관리</button>
    </div>
    {modeSelect}
    {personal ? <><p>File Storage 안의 일반 파일은 확장자와 관계없이 파일당 25 MiB까지 동기화합니다.</p><label>이 기기 이름<input value={form.deviceName ?? ""} maxLength={80} placeholder="예: Cloud PC" onChange={e=>update("deviceName",e.target.value)} /></label>
      <p>{repository?.available === false ? "이 폴더의 노트를 처음 올리려면 Git 서비스에서 빈 저장소를 만든 뒤 아래에 주소를 입력하세요." : "다른 PC에서도 같은 저장소와 브랜치를 선택하면 이 폴더의 노트를 이어 쓸 수 있습니다."}</p>
      <details open={zipPaths?.length>0 && status.config?.mode!=="personal-sync"}><summary>{zipPaths===null?"기존 ZIP 확인 중":"함께 전송할 기존 ZIP "+zipPaths.length+"개"}</summary>
        <ul>{zipPaths?.map(name=><li key={name}>{name}</li>)}</ul></details></> : <p>보관함의 파일을 Git으로 백업합니다. 파일 편집은 계속 자동 저장됩니다.</p>}
    <label>저장소 주소<input aria-label="Git 저장소 주소" placeholder="https://github.com/사용자/노트저장소.git" value={form.remote} disabled={busy} onChange={(e) => update("remote", e.target.value)} /></label>
    <div className="daily-backup-info"><strong>{personal?"편집 5분마다 전송 · 창을 떠날 때 전송":"하루 한 번 · 매일 밤 11시"}</strong>
      <p>{personal?"앱이 열려 있는 동안 약 1분마다 다른 PC의 변경을 확인합니다.":"이 PC의 시간 기준이며 앱이 열려 있을 때 실행됩니다. 놓친 백업은 다음 실행 시 보충합니다."}</p>
    </div>
    <details className="backup-details">
      <summary>세부 설정</summary>
      <label>브랜치<input aria-label="Git 브랜치" value={form.branch} disabled={busy} onChange={(e) => update("branch", e.target.value)} /></label>
      <div className="font-setting-row git-identity">
        <label>커밋 이름<input aria-label="Git 커밋 이름" placeholder="기존 Git 설정 사용" value={form.authorName} disabled={busy} onChange={(e) => update("authorName", e.target.value)} /></label>
        <label>커밋 이메일<input aria-label="Git 커밋 이메일" placeholder="기존 Git 설정 사용" value={form.authorEmail} disabled={busy} onChange={(e) => update("authorEmail", e.target.value)} /></label>
      </div>
      {!personal && <label>저장 방식<select aria-label="Git 저장 방식" value={form.push ? "push" : "commit"} disabled={busy} onChange={(e) => update("push", e.target.value === "push")}><option value="push">커밋 후 원격 업로드</option><option value="commit">로컬 커밋만</option></select></label>}
      <p className="muted">인증은 이 PC의 Git 로그인 또는 SSH 키를 사용합니다. {personal?"원격에서 받은 버전은 이 기기에서도 열어볼 수 있습니다.":"원격에 다른 변경사항이 있으면 업로드를 멈추고 알려드립니다."}</p>
      {!personal && <p className="muted">보충 백업도 오늘의 백업으로 계산합니다. 변경이 없으면 커밋하지 않으며, 수동 백업은 추가 커밋을 만들 수 있습니다.</p>}
    </details>
    <div className="settings-actions">
      <button className="primary-button" disabled={busy || !form.remote || personal && (!form.deviceName?.trim() || zipPaths===null)} onClick={() => run(() => onConnect(personal?{...form,zipPaths}:form))}>{personal?"이 설정으로 동기화":status.enabled ? "백업 설정 적용" : "연결하고 백업 시작"}</button>
      <button className="secondary-button" disabled={busy || !form.remote || personal && !form.deviceName?.trim()} onClick={() => run(() => onClone(form))}>기존 저장소 가져오기</button>
      <button className="secondary-button" disabled={busy || !status.enabled || personal !== connectedPersonal} onClick={() => run(() => onSync(personal))}>{personal?"지금 동기화":"지금 백업"}</button>
      <button className="secondary-button" disabled={busy || !status.enabled} onClick={() => run(onDisconnect)}>{personal?"이 기기 동기화 끄기":"자동 백업 끄기"}</button>
    </div>
    <p className={`settings-message ${status.phase}`} role="status">{status.message}</p>
    {status.diagnostics && <button className="secondary-button" onClick={() => run(async () => {
      await onCopyDiagnostics(status.diagnostics); setCopiedDiagnostics(status.diagnostics);
    })}>{copiedDiagnostics === status.diagnostics ? "진단 복사됨" : "진단 복사"}</button>}
    {status.recoveryFile && <button className="secondary-button" onClick={() => run(() => onShowRecovery(status.recoveryFile))}>복구 사본 위치 열기</button>}
    {status.enabled && status.config?.mode==="personal-sync" && <>
      <p>열린 파일 복구 사본 · {((status.recoveryBytes ?? 0)/1048576).toFixed(1)} MiB · <code>{space?.root}/.git/dynote-personal</code></p>
      <strong>등록 기기 {status.devices?.length ?? 0}대</strong>
      <ul>{status.devices?.map(d=><li key={d.id}>{d.name} · {d.id.slice(0,8)} {d.id===status.deviceId?"(이 기기)":<button disabled={busy} onClick={()=>run(()=>onAction({action:"device",deviceId:d.id}))}>등록 해제</button>}</li>)}</ul>
      {status.pendingFiles?.map(f=><p key={f.name}>{f.name} · {f.message} {f.oid && <button disabled={busy} onClick={()=>run(()=>onAction({action:"confirm",path:f.name,oid:f.oid}))}>복사 완료 확인</button>}</p>)}
      <LocalOnlyFiles files={status.localOnlyFiles}/>
      {status.conflicts?.map(f=><button key={f.name} onClick={()=>onReview(f.name)}>{f.name} · 버전 확인 {f.count}개</button>)}
    </>}
    {!connectedPersonal && status.lastBackupDay && <p className="muted">마지막 일일 백업 확인: {status.lastBackupDay}</p>}
    {status.pendingCommit && <p className="muted">업로드 대기 중인 커밋이 있습니다. 재시도는 이 커밋만 전송하며 이후 편집은 다음 백업에 포함됩니다.</p>}
    {connectedPersonal && status.lastRemoteCheck && <p className="muted">마지막 원격 확인 · {new Date(status.lastRemoteCheck).toLocaleString()}</p>}
    {status.lastSuccess && <p className="muted">{connectedPersonal ? "마지막 업로드" : "마지막 원격 저장"} · {new Date(status.lastSuccess).toLocaleString()}</p>}
    {error && <p className="error-banner settings-message" role="alert">{error}</p>}
  </section>;
}
