import { useEffect, useState } from "react";

export default function CloudRepositorySettings({ api, openBackup }) {
  const [settings, setSettings] = useState(null), [choice, setChoice] = useState("");
  const [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.cloudAskSettings().then(result => {
      if (!live) return;
      if (!result.ok) throw new Error(result.error);
      setSettings(result.value);
      setChoice(result.value.remote);
    }).catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [api]);
  async function save() {
    setSaving(true); setMessage(""); setError("");
    try {
      const result = await api.selectCloudAskRepository(choice);
      if (!result.ok) throw new Error(result.error);
      setSettings(result.value);
      setMessage("이 PC에 적용했습니다. 상대 PC에서도 같은 저장소를 선택해 주세요.");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }
  return <section className="settings-section cloud-repository-settings">
    <h3>Copilot 중계 Git</h3>
    <p>Local PC의 질문과 Cloud PC의 답변을 교환하는 전용 저장소입니다.</p>
    {settings?.role === "direct" && <p>현재 Direct Copilot을 사용합니다. Cloud Ask를 쓰려면 관리자에게 이 PC의 중계 설정을 요청해 주세요.</p>}
    {settings?.remotes.length > 0 && <>
      <p>이 PC의 역할 · {settings.role === "worker" ? "Cloud PC (답변 생성)" : "Local PC (질문 전송)"}</p>
      <label>승인된 중계 저장소 <select value={choice} disabled={saving} onChange={event => {
        setChoice(event.target.value); setError(""); setMessage("");
      }}>
        {!settings.remote && <option value="">저장소 선택</option>}
        {settings.remotes.map(url => <option key={url} value={url}>{url}</option>)}
      </select></label>
      <p>적용된 주소 · {settings.remote || "미설정"}</p>
      <button className="primary-button" disabled={saving || !choice || choice === settings.remote} onClick={save}>
        {saving ? "저장 중…" : "중계 저장소 적용"}
      </button>
    </>}
    {!settings && !error && <p role="status">설정 확인 중…</p>}
    {message && <p role="status">{message}</p>}
    {(error || settings?.error) && <p role="alert">{error || settings.error}</p>}
    <p><button className="text-action" onClick={openBackup}>노트 백업 설정 열기</button></p>
  </section>;
}
