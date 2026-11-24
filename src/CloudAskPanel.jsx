import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

const labels = {
  IDLE: "질문을 입력해 주세요.", BUSY: "다른 보관함의 질문이 진행 중입니다.",
  SUBMITTED: "Git에 질문을 제출하는 중", QUEUED: "Cloud PC 대기 중", RUNNING: "Cloud Copilot 답변 생성 중",
  COMPLETED: "답변 도착", FAILED: "Cloud에서 답변을 만들지 못했습니다. Cloud PC의 계정과 모델을 확인해 주세요.",
  TIMEOUT: "대기 시간이 지났습니다. 도착한 답변을 다시 확인할 수 있습니다.",
};
const active = state => ["BUSY", "SUBMITTED", "QUEUED", "RUNNING"].includes(state);

export default function CloudAskPanel({ api, session, vaultId, visible, busy, renderAnswer }) {
  const [job, setJob] = useState(null), [input, setInput] = useState("");
  const [error, setError] = useState(""), [sending, setSending] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const generation = useRef(0), submitting = useRef(false);
  useEffect(() => {
    if (!visible || !vaultId) return;
    let live = true, timer;
    const refresh = async () => {
      const epoch = generation.current;
      try {
        const result = await api.cloudAskView({ vaultId });
        if (!live || epoch !== generation.current || submitting.current) return;
        if (!result.ok) throw new Error(result.error);
        setJob(result.value);
        setRefreshError(result.value.connectionError || "");
      } catch (err) { if (live && epoch === generation.current) setRefreshError(err.message); }
      finally { if (live) timer = setTimeout(refresh, 1500); }
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [api, vaultId, visible]);

  const run = async recheck => {
    if ((!recheck && !input.trim()) || !job || active(job.state) || submitting.current || busy) return;
    submitting.current = true;
    generation.current++;
    setSending(true);
    try {
      const result = recheck ? await api.cloudAskRecheck({ vaultId, requestId: job.requestId })
        : await api.cloudAskSubmit({ vaultId, prompt: input });
      if (!result.ok) throw new Error(result.error);
      setJob(result.value);
      if (!recheck) setInput("");
      setError(recheck && result.value.state === "TIMEOUT" ? "아직 확정된 답변이 없습니다." : "");
    } catch (err) { setError(err.message); }
    finally { submitting.current = false; setSending(false); }
  };

  return <section className="copilot-panel" aria-label="Cloud Copilot 채팅" hidden={!visible}>
    <div className="copilot-chat-heading">
      <select className="ai-provider-select" aria-label="AI 제공자" value="copilot"
        disabled={sending || session.activity.chat || session.activity.planner} onChange={e => session.setProvider(e.target.value)}>
        <option value="copilot">Copilot · Cloud Ask</option><option value="codex">Codex</option><option value="claude">Claude</option>
      </select>
    </div>
    <div className="copilot-transcript" role="log" aria-label="Cloud Copilot 대화">
      {job?.prompt && <article className="copilot-message user"><strong>나</strong><div className="copilot-message-content">{job.prompt}</div></article>}
      {job?.state === "COMPLETED" && <article className="copilot-message assistant"><strong>Cloud Copilot</strong>{renderAnswer(job.answer)}</article>}
    </div>
    <p role="status" className="copilot-send-status">{job?.reason === "OUTCOME_UNKNOWN"
      ? "Cloud 실행이 중단되어 답변 생성 여부를 확인할 수 없습니다. 다시 보내면 새 요청으로 처리됩니다."
      : job?.awaitingConfirmation ? "기한 경과 · 서버 확인 대기"
      : vaultId ? (labels[job?.state] || "작업 확인 중…") : "질문을 보낼 보관함을 열어 주세요."}</p>
    {job?.state === "TIMEOUT" && <button type="button" className="text-action" disabled={sending || busy} onClick={() => run(true)}>기존 답변 다시 확인</button>}
    {(error || refreshError) && <p role="alert" className="copilot-error">{error || refreshError}</p>}
    <form onSubmit={event => { event.preventDefault(); void run(false); }} className="copilot-composer">
      <textarea aria-label="Cloud Copilot 질문" value={input} onChange={e => setInput(e.target.value)} disabled={sending}
        placeholder="Cloud PC에 질문하기" onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault(); e.currentTarget.form.requestSubmit();
          }
        }} />
      <button type="submit" className="primary-button" disabled={!vaultId || !job || !input.trim() || active(job.state) || sending || busy} aria-label="Cloud 질문 보내기"><ArrowUp size={14}/> 보내기</button>
      <small className="copilot-allowance">입력한 질문과 답변이 전용 Git 저장소에 기록됩니다. 매번 독립된 질문으로 보냅니다.</small>
    </form>
  </section>;
}
