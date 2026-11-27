import { useEffect, useRef, useState } from "react";
import { AlignLeft, Check, ChevronDown, Eye, MessageSquareText, PenLine, RefreshCw, Sparkles, SpellCheck } from "lucide-react";
import { isolateHistory } from "@codemirror/commands";
import { defaultCopilotModel } from "../core/copilot-send-state.mjs";

const actions = {
  "문장 다듬기": { Icon: PenLine, instruction: "원래 뜻과 사실, Markdown 형식을 유지하며 문장을 자연스럽고 명확하게 다듬어 주세요." },
  "맞춤법 교정": { Icon: SpellCheck, instruction: "원문의 뜻과 어조, Markdown 형식을 유지하며 맞춤법, 띄어쓰기, 문법만 바로잡아 주세요." },
  "간결하게": { Icon: AlignLeft, instruction: "핵심 내용과 Markdown 형식을 유지하며 중복을 줄이고 간결하게 써 주세요." },
  "직접 요청": { Icon: MessageSquareText },
};
function cancelActive(request) {
  const requestId = request.current;
  request.current = null;
  if (requestId) window.notes.copilotCancel({ requestId }).catch(() => {});
}

export default function AiSuggestion({ target, editor, readOnly, onClose }) {
  const dialog = useRef(null), active = useRef(null), promptField = useRef(null);
  const { doc, from, to, vaultId } = target;
  const original = from == null ? "" : doc.sliceString(from, to);
  const inserting = from != null && !original.trim();
  const [action, setAction] = useState(inserting ? "직접 요청" : "문장 다듬기");
  const [custom, setCustom] = useState(inserting ? "이곳에 넣을 짧은 문단 초안을 작성해 주세요." : "");
  const prompt = actions[action].instruction ?? custom.trim();
  const [connection, setConnection] = useState(null), [model, setModel] = useState("");
  const [running, setRunning] = useState(false), [answer, setAnswer] = useState(""), [error, setError] = useState("");
  const stale = () => readOnly || editor.state.readOnly || editor.state.doc !== doc;
  const invalid = from == null ? "편집할 문구를 한 곳에 선택해 주세요." :
    new TextEncoder().encode(original).length > 65536 ? "64 KiB 이내로 범위를 줄여 주세요." :
    stale() ? "원문이 변경되었거나 편집할 수 없습니다. 닫고 다시 선택해 주세요." : "";

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    promptField.current?.select();
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
    const escape = event => {
      if (event.key !== "Escape" || !active.current || !element.open) return;
      event.preventDefault();
      event.stopPropagation();
      element.requestClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      mounted = false;
      unsubscribe();
      cancelActive(active);
      element.close();
    };
  }, []);

  const send = async () => {
    if (active.current || invalid || stale() || !model || !prompt) return;
    const requestId = crypto.randomUUID();
    active.current = requestId;
    setError(""); setRunning(true);
    try {
      const result = await window.notes.copilotSend({ requestId, vaultId, workspace: true, model, mode: "edit",
        prompt, context: { kind: "selection", content: original, path: "선택.md" },
        references: [], history: [], vaultAccess: false });
      if (!result.ok) throw new Error(result.error);
    } catch (e) {
      if (active.current === requestId) { active.current = null; setRunning(false); setError(e.message); }
    }
  };
  const close = () => {
    cancelActive(active);
    dialog.current.close();
    onClose();
    editor.focus();
  };
  const apply = () => {
    if (running || !answer.trim() || stale()) return;
    editor.dispatch({ changes: { from, to, insert: answer }, annotations: isolateHistory.of("full"), scrollIntoView: true });
    close();
  };
  return <dialog className="ai-suggestion" ref={dialog} aria-label="AI 제안" onCancel={event => { event.preventDefault(); close(); }}>
    <header className="ai-heading">
      <h2><span className="ai-mark"><Sparkles size={20} aria-hidden="true" /></span>AI 제안</h2>
      <label className="ai-model-field">Copilot 모델
        <span><select value={model} disabled={running || !connection?.authenticated} onChange={e => { setModel(e.target.value); setAnswer(""); }}>
          <option value="" disabled>모델 선택</option>{connection?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select><ChevronDown size={14} aria-hidden="true" /></span>
      </label>
    </header>
    <div className="ai-body">
      {(!inserting || answer) && <div className="copilot-comparison">
        {!inserting && <section><h3>선택한 원문</h3><pre>{original}</pre></section>}
        {answer && <section className="ai-result"><h3>{inserting ? "삽입할 내용" : "수정 제안"}</h3><pre>{answer}</pre></section>}
      </div>}
      <fieldset className="ai-actions" disabled={running}><legend>작업 선택</legend>
        {Object.entries(actions).map(([name, { Icon }]) => <label key={name}>
          <input type="radio" name="suggestion-action" checked={action === name} disabled={inserting && name !== "직접 요청"}
            onChange={() => { setAction(name); setAnswer(""); }} />
          <Icon size={18} aria-hidden="true" />{name}
          {action === name && <Check className="ai-choice-check" size={13} aria-hidden="true" />}
        </label>)}
      </fieldset>
      {action === "직접 요청" && <label className="ai-field">요청 내용
        <textarea ref={promptField} value={custom} disabled={running} maxLength={2000} rows={3}
          placeholder="예: 이 구간을 회의록에 쓸 세 줄 요약으로 바꿔 줘"
          onChange={e => { setCustom(e.target.value); setAnswer(""); }} /></label>}
      <p>{inserting ? "요청 내용을 Copilot에 보냅니다. 적용하면 이 위치에 삽입됩니다." : "선택한 원문과 작업 지시를 GitHub Copilot에 보냅니다."}</p>
      {running && <p role="status">Copilot이 제안을 작성하고 있습니다… (Esc로 취소)</p>}
      {(invalid || error) && <p role="alert">{invalid || error}</p>}
    </div>
    <footer>
      <button type="button" className="ai-close" onClick={close}>{running ? "요청 취소" : answer ? "버리기" : "닫기"}</button>
      <button type="button" className={answer ? "secondary-button" : "primary-button"} disabled={running || !model || !prompt || !!invalid} onClick={send}>
        {answer ? <RefreshCw size={15} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{answer ? "다시 생성" : "미리보기"}
      </button>
      {answer && <button type="button" className="primary-button" disabled={running || !!invalid} onClick={apply}>
        <Check size={16} aria-hidden="true" />{inserting ? "이 위치에 삽입" : "적용"}
      </button>}
    </footer>
  </dialog>;
}
