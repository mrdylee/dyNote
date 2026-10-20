import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, GitBranch, Plus, RefreshCw, Square, Sparkles } from "lucide-react";
import { captureContext, applyProposal, prepareRequest } from "../core/copilot.mjs";

const invoke = async (promise) => {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const disconnected = { authenticated: false, login: "", models: [], error: "" };

export default function CopilotPanel({ api, provider = "copilot", onProviderChange, vaultId, note, selection, busy, onApply, onReview, visible }) {
  const label = provider === "codex" ? "Codex" : "Copilot";
  const accountLabel = provider === "codex" ? "ChatGPT" : "GitHub";
  const ai = {
    status: api[`${provider}Status`], login: api[`${provider}Login`],
    cancelLogin: api[`${provider}CancelLogin`], send: api[`${provider}Send`],
    cancel: api[`${provider}Cancel`], onEvent: api[`on${label}Event`],
  };
  const [connection, setConnection] = useState(disconnected);
  const [checking, setChecking] = useState(false);
  const [auth, setAuth] = useState(null);
  const [model, setModel] = useState(() => { try { return localStorage.getItem(`dynote.${provider}.model`) ?? ""; } catch { return ""; } });
  const [scope, setScope] = useState("document");
  const [mode, setMode] = useState("chat");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState(null);
  const [review, setReview] = useState(null);
  const pending = useRef(null), transcript = useRef(null), mounted = useRef(true), loginPending = useRef(false);
  const previousPath = useRef(note?.path);
  const checkedConnection = useRef(false);
  const latest = useRef(null);
  latest.current = { note, vaultId, onApply, busy };
  const refresh = async () => {
    setChecking(true); setError("");
    try {
      const next = await invoke(ai.status());
      if (!mounted.current) return;
      setConnection(next);
      setModel((current) => next.models.some((m) => m.id === current) ? current : "");
      if (next.error) setError(next.error);
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setChecking(false); }
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = ai.onEvent((event) => {
      if (event.type === "auth") {
        setAuth(event);
        loginPending.current = ["starting", "waiting"].includes(event.phase);
        if (event.phase === "connected") refresh();
        return;
      }
      const request = pending.current;
      if (!request || request.requestId !== event.requestId) return;
      if (event.type === "delta" || event.type === "done") {
        setMessages((old) => old.map((m) => m.id === request.requestId ? { ...m, content: event.content, complete: event.type === "done" } : m));
      }
      if (event.type === "done") {
        if (request.mode === "edit") setProposal({ target: request.target, content: event.content });
        setPrompt((text) => text === request.prompt ? "" : text);
      }
      if (event.type === "error") setError(event.error);
      if (event.type === "canceled") setError("응답을 중지했습니다. 질문을 수정해 다시 보낼 수 있습니다.");
      if (["done", "error", "canceled"].includes(event.type)) {
        pending.current = null;
        setRunning(false);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      if (pending.current) ai.cancel({ requestId: pending.current.requestId }).catch(() => {});
      if (loginPending.current) ai.cancelLogin().catch(() => {});
    };
  }, []);
  useEffect(() => {
    try { if (model) localStorage.setItem(`dynote.${provider}.model`, model); } catch { /* Keep the choice in memory. */ }
  }, [model]);
  useEffect(() => {
    if (visible && !checkedConnection.current) {
      checkedConnection.current = true;
      refresh();
    }
  }, [visible]);
  useEffect(() => {
    if (previousPath.current === note?.path) return;
    previousPath.current = note?.path;
    if (pending.current) ai.cancel({ requestId: pending.current.requestId }).catch(() => {});
    pending.current = null;
    setRunning(false); setMessages([]); setProposal(null); setReview(null); setError("");
  }, [note?.path]);
  useEffect(() => {
    if (visible && transcript.current) transcript.current.scrollTop = messages.length ? transcript.current.scrollHeight : 0;
  }, [messages, visible]);
  const authBusy = auth && ["starting", "waiting"].includes(auth.phase);
  const newConversation = () => {
    setMessages([]); setProposal(null); setReview(null); setError("");
  };
  const login = async () => {
    setError(""); setAuth({ phase: "starting", message: `${accountLabel} 연결 준비 중…` }); loginPending.current = true;
    try { await invoke(ai.login()); }
    catch (e) { loginPending.current = false; setAuth({ phase: "error", message: e.message }); }
  };
  const send = async (event) => {
    event?.preventDefault();
    if (running || checking || authBusy || busy) return;
    try {
      const { context, target } = captureContext({ vaultId, note, scope, selection });
      const requestId = crypto.randomUUID();
      const history = messages.filter((m) => m.complete && m.mode === "chat").map(({ role, content }) => ({ role, content }));
      const args = prepareRequest({ requestId, vaultId, model, prompt, mode, context, history: mode === "edit" ? [] : history });
      setError(""); setProposal(null); setReview(null); setRunning(true);
      pending.current = { ...args, target };
      setMessages((old) => [...old,
        { id: `${requestId}-user`, role: "user", content: args.prompt, complete: true, mode },
        { id: requestId, role: "assistant", content: "", complete: false, mode },
      ]);
      await invoke(ai.send(args));
    } catch (e) {
      pending.current = null; setRunning(false); setError(e.message);
    }
  };
  let stale = false;
  if (proposal) {
    try { applyProposal(proposal.target, { vaultId, ...note }, proposal.content); }
    catch { stale = true; }
  }
  const apply = async () => {
    try {
      const current = latest.current;
      if (current.busy) return;
      applyProposal(review.target, { vaultId: current.vaultId, ...current.note }, review.content);
      await current.onApply(review);
      setReview(null); setProposal(null);
    } catch (e) { setError(e.message); }
  };

  return <section className="copilot-panel" aria-label={`${label} 채팅`} hidden={!visible}>
    <div className="copilot-connection">
      <label className="copilot-model">서비스<select aria-label="AI 서비스" value={provider} disabled={checking || running || authBusy} onChange={(e) => onProviderChange(e.target.value)}>
        <option value="copilot">GitHub Copilot</option><option value="codex">OpenAI Codex</option>
      </select></label>
      <div className="copilot-account"><GitBranch size={15} /><strong>{connection.authenticated ? connection.login || `${accountLabel} 연결됨` : provider === "codex" ? "OpenAI Codex" : "GitHub Copilot"}</strong>
        <button title="연결 상태 확인" aria-label={`${label} 연결 상태 확인`} disabled={checking || running || authBusy} onClick={refresh}><RefreshCw size={14} className={checking ? "spin" : ""} /></button>
      </div>
      {!connection.authenticated && !authBusy && <div className="copilot-login">
        <p>사용 중인 {provider === "codex" ? "ChatGPT" : "Copilot"} 계정으로<br />노트에 관해 이야기해 보세요.</p>
        <button className="primary-button" disabled={checking} onClick={login}>{accountLabel}로 연결</button>
        <button className="text-action" disabled={checking} onClick={refresh}>이미 연결한 계정 확인</button>
      </div>}
      {auth && <p role="status" className={`copilot-auth ${auth.phase === "error" ? "failed" : ""}`}>{auth.message}</p>}
      {authBusy && <button className="text-action" onClick={() => invoke(ai.cancelLogin()).catch((e) => setError(e.message))}>로그인 취소</button>}
      {connection.authenticated && <button className="text-action" disabled={running || checking || authBusy} onClick={login}>계정 다시 연결</button>}
      {connection.authenticated && <label className="copilot-model">모델<select aria-label={`${label} 모델`} value={model} disabled={running || checking} onChange={(e) => setModel(e.target.value)}>
        <option value="">{connection.models.length ? "모델을 선택해 주세요" : "사용 가능한 모델 확인 필요"}</option>
        {connection.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select></label>}
    </div>
    <div className="copilot-chat-heading"><span>노트 어시스턴트</span><button aria-label={`${label} 새 대화`} disabled={running} onClick={newConversation}><Plus size={14} />새 대화</button></div>
    <div className="copilot-transcript" ref={transcript} role="log" aria-label={`${label} 대화`}>
      {!messages.length && <div className="copilot-empty"><Sparkles size={24} /><h3>생각을 더 선명하게</h3><p>내용을 요약하거나, 문장을 다듬거나,<br />시험 항목을 체크리스트로 정리해 보세요.</p>
        <div className="copilot-suggestions">{["핵심 내용을 요약해 줘", "실행할 일을 체크리스트로 정리해 줘"].map((text) => <button key={text} onClick={() => setPrompt(text)}>{text}</button>)}</div>
      </div>}
      {messages.map((m) => <article className={`copilot-message ${m.role}`} key={m.id}>
        <strong>{m.role === "user" ? "나" : m.mode === "edit" ? `${label} · 수정안` : label}</strong>
        <div className="copilot-message-content">{m.content || (running ? "답변을 준비하고 있어요…" : "완료되지 않은 응답")}</div>
      </article>)}
      {proposal && <div className="copilot-proposal">
        <p>{stale ? "문서가 변경되어 이 수정안을 적용할 수 없습니다. 다시 요청해 주세요." : `${proposal.target.path} · ${scope === "selection" ? "선택 영역" : "문서 전체"} 수정안`}</p>
        <button disabled={stale || busy} onClick={() => { onReview(); setReview(proposal); }}>변경 내용 확인</button>
      </div>}
    </div>
    {error && <p className="copilot-error" role="alert">{error}</p>}
    <form className="copilot-composer" onSubmit={send}>
      <div className="copilot-options">
        <label>보낼 내용<select aria-label={`${label} 전달 범위`} value={scope} disabled={running} onChange={(e) => { newConversation(); setScope(e.target.value); }}>
          <option value="none">문서 없음</option><option value="document" disabled={!note}>현재 문서</option><option value="selection" disabled={!note}>선택 영역</option>
        </select></label>
        <label>작업<select aria-label={`${label} 작업`} value={mode} disabled={running} onChange={(e) => { setMode(e.target.value); setProposal(null); }}>
          <option value="chat">질문하기</option><option value="edit" disabled={scope === "none" || !note}>수정 제안</option>
        </select></label>
      </div>
      <div className="copilot-context-label" title={note?.path}>{scope === "none" ? "문서를 첨부하지 않습니다" : `${scope === "selection" ? "선택 영역" : "현재 문서"} · ${note?.path ?? "문서를 열어 주세요"}`}</div>
      <textarea aria-label={`${label} 질문`} placeholder={`${label}에게 물어보세요…`} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <div className="copilot-send-row"><span>선택한 내용과 대화가 {label}에 전송됩니다.</span>
        {running ? <button type="button" aria-label={`${label} 응답 중지`} onClick={() => invoke(ai.cancel({ requestId: pending.current?.requestId })).catch((e) => setError(e.message))}><Square size={15} />중지</button>
          : <button type="submit" className="primary-button" aria-label={`${label} 보내기`} disabled={!connection.authenticated || !model || !prompt.trim() || checking || authBusy || busy || !vaultId}><ArrowUp size={16} /></button>}
      </div>
      <small className="copilot-allowance">계정의 {provider === "codex" ? "ChatGPT / Codex" : "Copilot"} 사용량 한도가 적용됩니다.</small>
    </form>
    {review && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={`${label} 수정안 확인`} className="modal wide copilot-review">
      <div className="modal-heading"><h2>수정안 확인</h2><button onClick={() => setReview(null)}>닫기</button></div>
      <p>{review.target.path} · 확인한 내용만 문서에 반영합니다.</p>
      <div className="copilot-comparison"><section><h3>변경 전</h3><pre>{review.target.before}</pre></section><section><h3>변경 후</h3><pre>{review.content}</pre></section></div>
      {stale && <p role="alert">문서가 변경되었습니다. 수정 제안을 다시 요청해 주세요.</p>}
      <div className="modal-actions"><button onClick={() => setReview(null)}>취소</button><button className="primary-button" disabled={busy || stale} onClick={apply}><Check size={14} />문서에 적용</button></div>
    </section></div>}
  </section>;
}
