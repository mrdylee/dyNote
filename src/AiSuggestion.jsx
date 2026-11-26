import { useEffect, useRef, useState } from "react";
import { isolateHistory } from "@codemirror/commands";
import { defaultCopilotModel } from "../core/copilot-send-state.mjs";

const instructions = {
  "문장 다듬기": "원래 뜻과 사실, Markdown 형식을 유지하며 문장을 자연스럽고 명확하게 다듬어 주세요.",
  "맞춤법 교정": "원문의 뜻과 어조, Markdown 형식을 유지하며 맞춤법, 띄어쓰기, 문법만 바로잡아 주세요.",
  "간결하게": "핵심 내용과 Markdown 형식을 유지하며 중복을 줄이고 간결하게 써 주세요.",
};
export default function AiSuggestion({ target, editor, readOnly, onClose }) {
  const dialog = useRef(null), active = useRef(null);
  const [action, setAction] = useState("문장 다듬기");
  const [custom, setCustom] = useState("");
  const prompt = instructions[action] ?? custom.trim();
  const [connection, setConnection] = useState(null), [model, setModel] = useState("");
  const [running, setRunning] = useState(false), [answer, setAnswer] = useState(""), [error, setError] = useState("");
  const { doc, from, to, vaultId } = target;
  const original = from == null ? "" : doc.sliceString(from, to);
  const stale = () => readOnly || editor.state.readOnly || editor.state.doc !== doc;
  const invalid = !original.trim() ? "편집할 문구를 한 곳에 선택해 주세요." :
    new TextEncoder().encode(original).length > 65536 ? "64 KiB 이내로 범위를 줄여 주세요." :
    stale() ? "원문이 변경되었거나 편집할 수 없습니다. 닫고 다시 선택해 주세요." : "";

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    let mounted = true;
    window.notes.copilotStatus().then(response => {
      if (!mounted) return;
      if (!response.ok) throw new Error(response.error);
      const state = response.value;
      setConnection(state);
      if (!state.authenticated || !state.models.length) throw new Error(state.error || "Copilot 탭에서 계정 연결과 모델을 확인해 주세요.");
      setModel(defaultCopilotModel(state.models, localStorage.getItem("dynote.copilot.model")));
    }).catch(e => { if (mounted) setError(e.message); });
    const unsubscribe = window.notes.onCopilotEvent(event => {
      if (!active.current || event.requestId !== active.current) return;
      if (!["done", "error", "canceled"].includes(event.type)) return;
      active.current = null;
      setRunning(false);
      if (event.type === "done") setAnswer(event.content);
      if (event.type === "error") setError(event.error);
    });
    return () => {
      mounted = false;
      unsubscribe();
      if (active.current) window.notes.copilotCancel({ requestId: active.current }).catch(() => {});
      active.current = null;
      element.close();
    };
  }, []);

  const send = async () => {
    if (active.current || invalid || stale() || !model || !prompt) return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setError(""); setAnswer(""); setRunning(true);
    try {
      const result = await window.notes.copilotSend({ requestId, vaultId, workspace: true, model, mode: "edit",
        prompt, context: { kind: "selection", content: original, path: "선택.md" },
        references: [], history: [], vaultAccess: false });
      if (!result.ok) throw new Error(result.error);
    } catch (e) {
      if (active.current === requestId) { active.current = null; setRunning(false); setError(e.message); }
    }
  };
  const apply = () => {
    if (!answer.trim() || stale()) return;
    editor.dispatch({ changes: { from, to, insert: answer }, annotations: isolateHistory.of("full"), scrollIntoView: true });
    dialog.current.close();
    onClose();
    editor.focus();
  };
  return <dialog className="ai-suggestion" ref={dialog} aria-label="AI 제안" onCancel={onClose}>
    <h2>AI 제안</h2>
    <div className="copilot-comparison"><section><h3>보낼 원문</h3><pre>{original}</pre></section>
      {answer && <section><h3>수정 제안</h3><pre>{answer}</pre></section>}</div>
    <label>작업 <select value={action} disabled={running} onChange={e => { setAction(e.target.value); setAnswer(""); }}>
      {Object.keys(instructions).map(name => <option key={name}>{name}</option>)}<option>직접 요청</option></select></label>
    <label>Copilot 모델 <select value={model} disabled={running || !connection?.authenticated} onChange={e => { setModel(e.target.value); setAnswer(""); }}>
      <option value="" disabled>모델 선택</option>{connection?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {action === "직접 요청" && <label className="ai-custom-prompt">요청 내용 <input value={custom} disabled={running} maxLength={2000}
      placeholder="예: 정중한 메일 문체로 바꿔 줘" onChange={e => { setCustom(e.target.value); setAnswer(""); }} /></label>}
    <p>제안을 요청하면 위 원문과 작업 지시가 GitHub Copilot으로 전송됩니다.</p>
    {running && <p role="status">Copilot이 제안을 작성하고 있습니다…</p>}
    {(invalid || error) && <p role="alert">{invalid || error}</p>}
    <footer>
      <button type="button" disabled={running || !model || !prompt || !!invalid} onClick={send}>{answer ? "다시 제안" : "제안 받기"}</button>
      {answer && <button type="button" disabled={!!invalid} onClick={apply}>원문에 적용</button>}
      <button type="button" onClick={onClose}>{running ? "요청 취소" : answer ? "버리기" : "닫기"}</button>
    </footer>
  </dialog>;
}
