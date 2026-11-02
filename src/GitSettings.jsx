import { useEffect, useState } from "react";

const initial = { remote: "", branch: "main", authorName: "", authorEmail: "", schedule: "daily", push: true };
export default function GitSettings({ status, space, onRepositoryStatus, onManageSpaces, onConnect, onClone, onSync, onDisconnect }) {
  const [form, setForm] = useState(() => ({ ...initial, ...status.config }));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const [repository, setRepository] = useState(null), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let mounted = true;
    setRepository(null);
    onRepositoryStatus().then(value => { if (mounted) setRepository(value); }).catch(error => { if (mounted) setRepository({ error: error.message }); });
    return () => { mounted = false; };
  }, [refresh]);
  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const run = async (action) => {
    setPending(true); setError("");
    try { await action(); } catch (error) { setError(error.message); } finally { setPending(false); }
  };
  const busy = pending || status.phase === "saving";
  return <section className="settings-section">
    <h3>자동 백업</h3>
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
    <p>보관함의 파일을 Git으로 백업합니다. 파일 편집은 계속 자동 저장됩니다.</p>
    <label>저장소 주소<input aria-label="Git 저장소 주소" placeholder="https://github.com/사용자/노트저장소.git" value={form.remote} disabled={busy} onChange={(e) => update("remote", e.target.value)} /></label>
    <div className="daily-backup-info"><strong>하루 한 번 · 매일 밤 11시</strong>
      <p>이 PC의 시간 기준이며 앱이 열려 있을 때 실행됩니다. 놓친 백업은 다음 실행 시 보충합니다.</p>
    </div>
    <details className="backup-details">
      <summary>세부 설정</summary>
      <label>브랜치<input aria-label="Git 브랜치" value={form.branch} disabled={busy} onChange={(e) => update("branch", e.target.value)} /></label>
      <div className="font-setting-row git-identity">
        <label>커밋 이름<input aria-label="Git 커밋 이름" placeholder="기존 Git 설정 사용" value={form.authorName} disabled={busy} onChange={(e) => update("authorName", e.target.value)} /></label>
        <label>커밋 이메일<input aria-label="Git 커밋 이메일" placeholder="기존 Git 설정 사용" value={form.authorEmail} disabled={busy} onChange={(e) => update("authorEmail", e.target.value)} /></label>
      </div>
      <label>저장 방식<select aria-label="Git 저장 방식" value={form.push ? "push" : "commit"} disabled={busy} onChange={(e) => update("push", e.target.value === "push")}><option value="push">커밋 후 원격 업로드</option><option value="commit">로컬 커밋만</option></select></label>
      <p className="muted">인증은 이 PC의 Git 로그인 또는 SSH 키를 사용합니다. 토큰·비밀번호를 주소에 넣지 마세요. 원격에 다른 변경사항이 있으면 업로드를 멈추고 알려드립니다.</p>
      <p className="muted">보충 백업도 오늘의 백업으로 계산합니다. 변경이 없으면 커밋하지 않으며, 수동 백업은 추가 커밋을 만들 수 있습니다.</p>
    </details>
    <div className="settings-actions">
      <button className="primary-button" disabled={busy || !form.remote} onClick={() => run(() => onConnect(form))}>{status.enabled ? "백업 설정 적용" : "연결하고 백업 시작"}</button>
      <button className="secondary-button" disabled={busy || !form.remote} onClick={() => run(() => onClone(form))}>기존 저장소 가져오기</button>
      <button className="secondary-button" disabled={busy || !status.enabled} onClick={() => run(onSync)}>지금 백업</button>
      <button className="secondary-button" disabled={busy || !status.enabled} onClick={() => run(onDisconnect)}>자동 백업 끄기</button>
    </div>
    <p className={`settings-message ${status.phase}`} role="status">{status.message}</p>
    {status.lastBackupDay && <p className="muted">마지막 일일 백업 확인: {status.lastBackupDay}</p>}
    {status.pendingCommit && <p className="muted">업로드 대기 중인 커밋이 있습니다. 재시도는 이 커밋만 전송하며 이후 편집은 다음 백업에 포함됩니다.</p>}
    {status.lastSuccess && <p className="muted">마지막 원격 저장: {new Date(status.lastSuccess).toLocaleString()}</p>}
    {error && <p className="error-banner settings-message" role="alert">{error}</p>}
  </section>;
}
