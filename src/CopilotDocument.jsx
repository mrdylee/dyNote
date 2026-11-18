import { useEffect, useRef, useState } from "react";
import { conversationDocumentContent, conversationDocumentRequest, defaultDocumentPrompt, documentPrompt } from "../core/copilot-document.mjs";

export function DocumentPromptSettings({ prompts, onSave }) {
  const [editor, setEditor] = useState(prompts[0]);
  const [message, setMessage] = useState(null);
  const choose = preset => { setEditor(preset); setMessage(null); };
  const save = event => {
    event.preventDefault();
    try {
      const name = editor.name.trim(), text = editor.text.trim();
      if (!name) throw new Error("프롬프트 이름을 입력해 주세요.");
      if (prompts.some(p => p.id !== editor.id && p.name.toLowerCase() === name.toLowerCase()))
        throw new Error("같은 이름의 프롬프트가 있습니다.");
      documentPrompt(text);
      const preset = { id: editor.id || crypto.randomUUID(), name, text };
      onSave(editor.id ? prompts.map(p => p.id === editor.id ? preset : p) : [...prompts, preset]);
      setEditor(preset);
      setMessage({ text: "프롬프트를 저장했습니다." });
    } catch (error) { setMessage({ error: true, text: error.message }); }
  };
  return <section className="settings-section document-prompt-settings">
    <h3>문서로 만들기 프롬프트</h3>
    <form onSubmit={save}>
      <label>편집할 프롬프트<select value={editor.id} onChange={event => choose(prompts.find(p => p.id === event.target.value))}>
        {!editor.id && <option value="" disabled>새 프롬프트</option>}
        {prompts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>
      <label>프롬프트 이름<input value={editor.name} readOnly={editor.id === "default"} maxLength={60}
        onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
      <label>프롬프트 내용<textarea rows={6} value={editor.text} onChange={event => setEditor({ ...editor, text: event.target.value })} /></label>
      {message && <p role={message.error ? "alert" : "status"}>{message.text}</p>}
      <div className="settings-actions">
        <button type="button" className="secondary-button" onClick={() => choose({ id: "", name: "", text: "" })}>프롬프트 추가</button>
        {editor.id === "default" && <button type="button" className="secondary-button" onClick={() => choose(defaultDocumentPrompt)}>기본 내용 불러오기</button>}
        <button type="submit" className="primary-button">프롬프트 저장</button>
      </div>
    </form>
  </section>;
}

export default function CopilotDocument({ source, vaultId, session, prompts, onSave }) {
  const { ai, label, model, setModel, reasoningEffort, connection, checking, activity, setActivity } = session;
  const activityId = `document:${vaultId}`;
  const [promptId, setPromptId] = useState("default");
  const [draft, setDraft] = useState(null);
  const [fileName, setFileName] = useState(() => {
    const stem = Array.from(source.title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, " ").replace(/^[. ]+/, "").trim()).slice(0, 55).join("").trim();
    return `${stem || "Copilot 대화"} · 문서`;
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(null);
  useEffect(() => {
    const unsubscribe = ai.onEvent(event => {
      if (!request.current || request.current !== event.requestId || !["done", "error", "canceled"].includes(event.type)) return;
      request.current = null;
      setRunning(false);
      setActivity("chat", false, activityId);
      if (event.type === "done") {
        const content = event.content.trim().replace(/^```(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n```$/i, "$1").trim();
        if (content) setDraft(content);
        else setError("초안이 비어 있습니다. 다시 시도해 주세요.");
      } else setError(event.type === "canceled" ? "초안 만들기를 중지했습니다." : event.error);
    });
    return () => {
      unsubscribe();
      const requestId = request.current;
      request.current = null;
      if (requestId) void ai.cancel({ requestId }).catch(() => {}).finally(() => setActivity("chat", false, activityId));
    };
  }, [ai, activityId, setActivity]);

  const unavailable = checking ? `${label} 연결 상태를 확인하고 있습니다.`
    : !connection.authenticated ? connection.error || `AI 채팅에서 ${label}에 먼저 연결해 주세요.`
    : !running && (activity.chat || activity.planner) ? "다른 AI 작업이 끝나면 시작할 수 있습니다."
    : !connection.models.some(item => item.id === model) ? "모델을 선택해 주세요." : "";
  const generate = async () => {
    if (request.current || unavailable) return;
    setError("");
    const requestId = crypto.randomUUID();
    let args;
    try {
      const template = prompts.find(preset => preset.id === promptId).text;
      args = conversationDocumentRequest({ requestId, vaultId, model, reasoningEffort, source, template });
    } catch (failure) { setError(failure.message); return; }
    request.current = requestId;
    setRunning(true);
    setActivity("chat", true, activityId);
    try {
      const response = await ai.send(args);
      if (!response.ok) throw new Error(response.error);
    } catch (failure) {
      if (request.current !== requestId) return;
      request.current = null;
      setRunning(false);
      setActivity("chat", false, activityId);
      setError(failure.message);
    }
  };
  const save = async event => {
    event.preventDefault();
    if (saving || !draft?.trim()) return;
    setError("");
    const name = fileName.trim().replace(/\.md$/i, "").trim();
    if (!name || /[\\/]/.test(name)) { setError("개인 노트에 저장할 파일 이름을 입력해 주세요."); return; }
    setSaving(true);
    try {
      await onSave(`${name}.md`, conversationDocumentContent(draft, source.path));
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };

  return <form className="conversation-document" onSubmit={save}>
    {draft === null ? <>
      <p>현재 대화 문서만 {label}에 보내 초안을 만듭니다.</p>
      <label>문서 프롬프트<select value={promptId} disabled={running} onChange={event => setPromptId(event.target.value)}>
        {prompts.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></label>
      {connection.authenticated && <label>AI 모델<select value={model ?? ""} disabled={running || checking || activity.chat || activity.planner}
        onChange={event => setModel(event.target.value)}><option value="">모델 선택</option>
        {connection.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      {running ? <p role="status">초안을 만들고 있습니다…</p> : unavailable && <p role="status">{unavailable}</p>}
      {error && <p role="alert" className="error-banner">{error}</p>}
      <div className="modal-actions"><button type="button" className="primary-button" disabled={running || !!unavailable} onClick={generate}>초안 만들기</button></div>
    </> : <>
      <label>파일 이름<input autoFocus value={fileName} disabled={saving} onChange={event => setFileName(event.target.value)} /></label>
      <label>Markdown 초안<textarea rows={14} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} /></label>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <div className="modal-actions"><button type="submit" className="primary-button" disabled={saving || !draft.trim() || !fileName.trim()}>새 문서로 저장</button></div>
    </>}
  </form>;
}
