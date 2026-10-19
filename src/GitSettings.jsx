import { useState } from "react";

const initial = { remote: "", branch: "main", authorName: "", authorEmail: "", interval: 300, push: true };
export default function GitSettings({ status, onConnect, onClone, onSync, onDisconnect }) {
  const [form, setForm] = useState(() => ({ ...initial, ...status.config }));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const run = async (action) => {
    setPending(true); setError("");
    try { await action(); } catch (error) { setError(error.message); } finally { setPending(false); }
  };
  const busy = pending || status.phase === "saving";
  return <section className="settings-section">
    <h3>Git 자동 저장</h3>
    <p>로컬에 저장된 문서·Canvas·Bases·이미지·PDF를 Git에 커밋하고 업로드합니다. 앱이 열려 있는 동안 실행됩니다.</p>
    <label>저장소 주소<input aria-label="Git 저장소 주소" placeholder="https://github.com/사용자/노트저장소.git" value={form.remote} disabled={busy} onChange={(e) => update("remote", e.target.value)} /></label>
    <label>브랜치<input aria-label="Git 브랜치" value={form.branch} disabled={busy} onChange={(e) => update("branch", e.target.value)} /></label>
    <div className="font-setting-row git-identity">
      <label>커밋 이름<input aria-label="Git 커밋 이름" placeholder="기존 Git 설정 사용" value={form.authorName} disabled={busy} onChange={(e) => update("authorName", e.target.value)} /></label>
      <label>커밋 이메일<input aria-label="Git 커밋 이메일" placeholder="기존 Git 설정 사용" value={form.authorEmail} disabled={busy} onChange={(e) => update("authorEmail", e.target.value)} /></label>
    </div>
    <label>자동 저장 간격<select aria-label="Git 자동 저장 간격" value={form.interval} disabled={busy} onChange={(e) => update("interval", Number(e.target.value))}><option value="30">30초</option><option value="300">5분</option><option value="900">15분</option></select></label>
    <label>저장 방식<select aria-label="Git 저장 방식" value={form.push ? "push" : "commit"} disabled={busy} onChange={(e) => update("push", e.target.value === "push")}><option value="push">커밋 후 원격 업로드</option><option value="commit">로컬 커밋만</option></select></label>
    <p className="muted">인증은 이 PC의 Git 로그인 또는 SSH 키를 사용합니다. 토큰·비밀번호를 주소에 넣지 마세요. 원격에 다른 변경사항이 있으면 업로드를 멈추고 알려드립니다.</p>
    <div className="settings-actions">
      <button className="primary-button" disabled={busy || !form.remote} onClick={() => run(() => onConnect(form))}>{status.enabled ? "Git 설정 적용" : "연결하고 자동 저장 시작"}</button>
      <button className="secondary-button" disabled={busy || !form.remote} onClick={() => run(() => onClone(form))}>기존 저장소 가져오기</button>
      <button className="secondary-button" disabled={busy || !status.enabled} onClick={() => run(onSync)}>지금 Git 저장</button>
      <button className="secondary-button" disabled={busy || !status.enabled} onClick={() => run(onDisconnect)}>자동 저장 끄기</button>
    </div>
    <p className={`settings-message ${status.phase}`} role="status">{status.message}</p>
    {status.lastSuccess && <p className="muted">마지막 원격 저장: {new Date(status.lastSuccess).toLocaleString()}</p>}
    {error && <p className="error-banner settings-message" role="alert">{error}</p>}
  </section>;
}
