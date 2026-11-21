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

export default function CopilotDocument({ document, hidden, session, prompts, folders, onUpdate, onPersist, onSave }) {
  const { ai, label, model, setModel, reasoningEffort, connection, checking, activity, setActivity } = session;
  const otherWork = session.provider !== "copilot" && (activity.chat || activity.planner);
  const { id, source, vaultId, content, fileName, promptId } = document;
  const activityId = `document:${id}`;
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [temporaryError, setTemporaryError] = useState("");
  const request = useRef(null), latest = useRef(null);
  latest.current = { onUpdate };
  useEffect(() => {
    const timer = setTimeout(() => {
      onPersist(document).then(() => setTemporaryError("")).catch(failure => setTemporaryError(`임시 저장: ${failure.message}`));
    }, 250);
    return () => clearTimeout(timer);
  }, [id, content, fileName, promptId, onPersist]);
  useEffect(() => {
    const unsubscribe = ai.onEvent(event => {
      if (!request.current || request.current !== event.requestId || !["done", "error", "canceled"].includes(event.type)) return;
      request.current = null;
      setRunning(false);
      setActivity("chat", false, activityId);
      if (event.type === "done") {
        const content = event.content.trim().replace(/^```(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n```$/i, "$1").trim();
        latest.current.onUpdate(id, { running: false, content: content || null, failed: !content });
        if (!content) setError("초안이 비어 있습니다. 다시 시도해 주세요.");
      } else {
        latest.current.onUpdate(id, { running: false, failed: true });
        setError(event.type === "canceled" ? "초안 만들기를 중지했습니다." : event.error);
      }
    });
    return () => {
      unsubscribe();
      const requestId = request.current;
      request.current = null;
      if (requestId) void ai.cancel({ requestId }).catch(() => {}).finally(() => setActivity("chat", false, activityId));
    };
  }, [ai, id, activityId, setActivity]);
  const unavailable = checking ? `${label} 연결 상태를 확인하고 있습니다.`
    : !connection.authenticated ? connection.error || `AI 채팅에서 ${label}에 먼저 연결해 주세요.`
    : !running && otherWork ? "다른 AI 작업이 끝나면 시작할 수 있습니다."
    : !connection.models.some(item => item.id === model) ? "모델을 선택해 주세요." : "";
  const generate = async () => {
    if (request.current || unavailable) return;
    setError("");
    const requestId = crypto.randomUUID();
    let args;
    try {
      const template = (prompts.find(preset => preset.id === promptId) ?? prompts[0]).text;
      args = conversationDocumentRequest({ requestId, vaultId, model, reasoningEffort, source, template });
    } catch (failure) { setError(failure.message); return; }
    request.current = requestId;
    setRunning(true);
    onUpdate(id, { running: true, failed: false });
    setActivity("chat", true, activityId);
    try {
      const response = await ai.send(args);
      if (!response.ok) throw new Error(response.error);
    } catch (failure) {
      if (request.current !== requestId) return;
      request.current = null;
      setRunning(false);
      onUpdate(id, { running: false, failed: true });
      setActivity("chat", false, activityId);
      setError(failure.message);
    }
  };
  const save = async event => {
    event.preventDefault();
    if (saving || running || !content?.trim()) return;
    setError("");
    const name = fileName.trim().replace(/\.md$/i, "").trim();
    if (!name || /[\\/]/.test(name)) { setError("저장할 파일 이름을 입력해 주세요."); return; }
    setSaving(true);
    try {
      await onPersist(document);
      await onSave(document, `${folder ? folder + "/" : ""}${name}.md`, conversationDocumentContent(content, source.path));
    } catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  };
  return <form hidden={hidden} className="conversation-document document-draft-panel" onSubmit={save} aria-label="임시 생성 문서">
    <h2>{fileName}</h2>
    <p>원본: {source.title}</p>
    {running ? <p role="status">문서를 만들고 있습니다… 다른 노트에서 계속 작업할 수 있습니다.</p> : content === null && unavailable && <p role="status">{unavailable}</p>}
    {content === null && <>
      <label>문서 프롬프트<select aria-label="문서 프롬프트" value={promptId} disabled={running} onChange={event => onUpdate(id, { promptId: event.target.value })}>
        {prompts.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></label>
      {connection.authenticated && <label>AI 모델<select aria-label="AI 모델" value={model ?? ""} disabled={running || checking || otherWork} onChange={event => setModel(event.target.value)}>
        <option value="">모델 선택</option>{connection.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>}
      <div className="modal-actions">{running
        ? <button type="button" onClick={() => ai.cancel({ requestId: request.current }).catch(failure => setError(failure.message))}>생성 중지</button>
        : <button type="button" className="primary-button" disabled={!!unavailable} onClick={generate}>초안 만들기</button>}</div>
    </>}
    {content !== null && <>
      <h3>어디에 저장할까요?</h3>
      <p>초안은 tmp에 임시 보관되어 있습니다.</p>
      <label>저장할 폴더<select aria-label="저장할 폴더" value={folder} disabled={saving} onChange={event => setFolder(event.target.value)}>
        <option value="">보관함 최상위</option>{folders.map(path => <option key={path} value={path}>{path}</option>)}
      </select></label>
      <label>파일 이름<input value={fileName} disabled={saving} onChange={event => onUpdate(id, { fileName: event.target.value })} /></label>
      <label>Markdown 초안<textarea aria-label="Markdown 초안" rows={14} value={content} disabled={saving} onChange={event => onUpdate(id, { content: event.target.value })} /></label>
      <div className="modal-actions"><button type="submit" className="primary-button" disabled={saving || !content.trim() || !fileName.trim()}>새 문서로 저장</button></div>
    </>}
    {(error || temporaryError) && <p role="alert" className="error-banner">{error || temporaryError}</p>}
  </form>;
}
