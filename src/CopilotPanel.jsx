import { sendBlock, defaultCopilotModel } from "../core/copilot-send-state.mjs";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, GitBranch, Plus, RefreshCw, Square, Sparkles, Paperclip, ChevronDown } from "lucide-react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import DiagramPreview from "./DiagramPreview.jsx";
import { captureContext, applyProposal, prepareRequest } from "../core/copilot.mjs";

const invoke = async (promise) => {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const disconnected = { authenticated: false, login: "", models: [], error: "" };
const markdown = new MarkdownIt({ html: false, breaks: true });
// Model output must not fetch remote images or navigate the app.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(`[이미지: ${tokens[index].content}]`);
const answerHtml = (text) => DOMPurify.sanitize(markdown.render(text), { FORBID_TAGS: ["img", "a"] });

export default function CopilotPanel({ api, vaultId, note, notes = [], selection, busy, onApply, onReview, visible, liveEdits, onBeginLive, onOpenVault }) {
  const label = "Copilot";
  const accountLabel = "GitHub";
  const ai = {
    status: api.copilotStatus, login: api.copilotLogin,
    cancelLogin: api.copilotCancelLogin, send: api.copilotSend,
    cancel: api.copilotCancel, onEvent: api.onCopilotEvent,
  };
  const accountMenu = useRef(null);
  const [connection, setConnection] = useState(disconnected);
  const [checking, setChecking] = useState(false);
  const [auth, setAuth] = useState(null);
  const [model, setModel] = useState(() => { try { return localStorage.getItem("dynote.copilot.model") ?? ""; } catch { return ""; } });
  const [scope, setScope] = useState("document");
  const [mode, setMode] = useState("agent");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState([]);
  const [review, setReview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState([]);
  const [references, setReferences] = useState([]);
  const [attachmentSearch, setAttachmentSearch] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [vaultAccess, setVaultAccess] = useState(false);
  const pending = useRef(null), transcript = useRef(null), mounted = useRef(true), loginPending = useRef(false);
  const previousPath = useRef(note?.path);
  const checkedConnection = useRef(false);
  const latest = useRef(null);
  latest.current = { note, notes, vaultId, onApply, busy, liveEdits, onBeginLive };
  const refresh = async () => {
    setChecking(true); setError("");
    try {
      const next = await invoke(ai.status());
      if (!mounted.current) return;
      setConnection(next);
      setModel((current) => defaultCopilotModel(next.models, current));
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
        if (request.mode === "edit") setProposals([{ id: request.requestId, kind: "edit", path: request.target.path, target: request.target, content: event.content }]);
        setPrompt((text) => text === request.inputPrompt ? "" : text);
      }
      if (event.type === "tool") setProgress((old) => [...old, event.message].slice(-24));
      if (event.type === "proposal") {
        const proposal = event.proposal;
        // Only the renderer has the complete document when sharing a selection.
        if (proposal.kind === "edit" && proposal.path === request.target?.path) proposal.target = request.target;
        if (request.mode === "agent") latest.current.liveEdits.stage(proposal, request.requestId);
        else setProposals((old) => [...old, proposal]);
      }
      if (event.type === "error") setError(event.error);
      if (event.type === "canceled") setError("응답을 중지했습니다. 질문을 수정해 다시 보낼 수 있습니다.");
      if (["done", "error", "canceled"].includes(event.type)) {
        if (request.mode === "agent") latest.current.liveEdits.finish(request.requestId);
        if (event.type !== "done") { setProposals([]); setReview(null); }
        pending.current = null;
        setRunning(false);
      }
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      if (pending.current) {
        ai.cancel({ requestId: pending.current.requestId }).catch(() => {});
        latest.current.liveEdits.stop();
        latest.current.liveEdits.finish(pending.current.requestId);
      }
      if (loginPending.current) ai.cancelLogin().catch(() => {});
    };
  }, []);
  useEffect(() => {
    try { if (model) localStorage.setItem("dynote.copilot.model", model); } catch { /* Keep the choice in memory. */ }
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
    if (mode === "agent") return;
    if (pending.current) ai.cancel({ requestId: pending.current.requestId }).catch(() => {});
    pending.current = null;
    setRunning(false); setMessages([]); setProposals([]); setReview(null); setError("");
  }, [note?.path]);
  useEffect(() => {
    if (visible && transcript.current) transcript.current.scrollTop = messages.length ? transcript.current.scrollHeight : 0;
  }, [messages, progress, proposals, visible]);
  const authBusy = auth && ["starting", "waiting"].includes(auth.phase);
  const newConversation = () => {
    setMessages([]); setProposals([]); setReview(null); setError(""); setProgress([]);
  };
  const login = async () => {
    setError(""); setAuth({ phase: "starting", message: `${accountLabel} 연결 준비 중…` }); loginPending.current = true;
    try { await invoke(ai.login()); }
    catch (e) { loginPending.current = false; setAuth({ phase: "error", message: e.message }); }
  };
  const blockedSend = sendBlock({ connection, model, prompt, checking, authBusy, busy, applying, running,
    vaultId, note, scope, selection, mode, ready: liveEdits.ready, blocked: liveEdits.blocked() });
  const canSend = !blockedSend;
  const send = async (event) => {
    event?.preventDefault();
    if (pending.current || running || !canSend) return;
    try {
      const { context, target } = captureContext({ vaultId, note, scope, selection });
      const requestId = crypto.randomUUID();
      const history = messages.filter((m) => m.complete && m.mode !== "edit").map(({ role, content }) => ({ role, content }));
      const attached = references.filter((path) => path !== context.path).map((path) => {
        const found = notes.find((n) => n.path === path);
        if (!found) throw new Error(`첨부 문서가 없어졌습니다: ${path}`);
        return { path, content: found.content };
      });
      const args = prepareRequest({ requestId, vaultId, model, prompt, mode, context, references: attached, vaultAccess: mode === "agent" && vaultAccess, history: mode === "edit" ? [] : history });
      setError(""); setProposals([]); setReview(null); setProgress([]); setRunning(true);
      pending.current = { ...args, target, inputPrompt: prompt };
      if (mode === "agent") await latest.current.onBeginLive(requestId);
      if (!mounted.current) { latest.current.liveEdits.stop(); await latest.current.liveEdits.finish(requestId); return; }
      setMessages((old) => [...old,
        { id: `${requestId}-user`, role: "user", content: args.prompt, complete: true, mode },
        { id: requestId, role: "assistant", content: "", complete: false, mode },
      ]);
      await invoke(ai.send(args));
    } catch (e) {
      if (pending.current?.mode === "agent") latest.current.liveEdits.finish(pending.current.requestId);
      pending.current = null; setRunning(false); setError(e.message);
    }
  };
  const isStale = (proposal) => {
    if (proposal.kind === "create") return notes.some((n) => n.path === proposal.path);
    const current = notes.find((n) => n.path === proposal.path);
    try { applyProposal(proposal.target, { vaultId, ...current }, proposal.content); return false; }
    catch { return true; }
  };
  const apply = async () => {
    try {
      const current = latest.current;
      if (current.busy || applying) return;
      setApplying(true);
      if (review.kind !== "create") applyProposal(review.target, { vaultId: current.vaultId, ...current.notes.find((n) => n.path === review.path) }, review.content);
      await current.onApply(review);
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: "assistant", mode: "agent", complete: true, content: `적용 완료: ${review.path}. 다음 작업에서는 현재 내용을 다시 확인합니다.` }]);
      setReview(null); setProposals((old) => old.filter((p) => p.id !== review.id));
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  };

  return <section className="copilot-panel" aria-label={`${label} 채팅`} hidden={!visible}>
    <div className="copilot-chat-heading">
      <span className="copilot-heading-label" title="노트 어시스턴트">Copilot</span>
      <div className="copilot-heading-actions">
        <details className="copilot-account-menu" ref={accountMenu}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary").focus(); } }}>
          <summary aria-label={`${label} 계정 설정`} title={connection.authenticated ? `${accountLabel} · ${connection.login || "연결됨"}` : `${accountLabel} 연결 설정`}>
            <GitBranch size={13}/><span>{connection.authenticated ? connection.login || accountLabel : `${accountLabel} 연결`}</span><ChevronDown size={11}/>
          </summary>
          <div className="copilot-account-options" role="group" aria-label="GitHub 연결 설정">
            <p>{connection.authenticated ? `${accountLabel} · ${connection.login || "연결됨"}` : "GitHub Copilot 계정으로 연결하세요."}</p>
            <button type="button" disabled={checking || running || applying || authBusy} onClick={() => { accountMenu.current.open = false; login(); }}>{connection.authenticated ? "계정 다시 연결" : `${accountLabel}로 연결`}</button>
            <button type="button" disabled={checking || running || applying || authBusy} onClick={() => { accountMenu.current.open = false; refresh(); }}>이미 연결한 계정 확인</button>
          </div>
        </details>
        <button type="button" title="연결 상태 확인" aria-label={`${label} 연결 상태 확인`} disabled={checking || running || applying || authBusy} onClick={refresh}><RefreshCw size={14} className={checking ? "spin" : ""}/></button>
        <button type="button" title="새 대화" aria-label={`${label} 새 대화`} disabled={running || applying} onClick={newConversation}><Plus size={14}/></button>
      </div>
    </div>
    {auth && (authBusy || auth.phase === "error") && <div className="copilot-auth-notice">
      <p role="status" className={`copilot-auth ${auth.phase === "error" ? "failed" : ""}`}>{auth.message}</p>
      {authBusy && <button type="button" className="text-action" onClick={() => invoke(ai.cancelLogin()).catch(e => setError(e.message))}>로그인 취소</button>}
    </div>}
    <div className="copilot-transcript" ref={transcript} role="log" aria-label={`${label} 대화`}>
      {!messages.length && <div className="copilot-empty"><Sparkles size={24} /><h3>생각을 더 선명하게</h3><p>내용을 요약하거나, 문장을 다듬거나,<br />시험 항목을 체크리스트로 정리해 보세요.</p>
        <div className="copilot-suggestions">{(mode === "agent" ? ["현재 문서에 실행할 일 체크리스트를 추가해 줘", "현재 문서를 참고해서 새 요약 문서를 만들어 줘"] : ["핵심 내용을 요약해 줘", "실행할 일을 체크리스트로 정리해 줘"]).map((text) => <button key={text} onClick={() => setPrompt(text)}>{text}</button>)}</div>
      </div>}
      {messages.map((m) => <article className={`copilot-message ${m.role}`} key={m.id}>
        <strong>{m.role === "user" ? "나" : m.mode === "edit" ? `${label} · 수정안` : label}</strong>
        {m.role === "assistant" && m.content ? <DiagramPreview className="copilot-message-content markdown-answer" html={answerHtml(m.content)} renderDiagrams={m.complete} />
          : <div className="copilot-message-content">{m.content || (running ? "답변을 준비하고 있어요…" : "완료되지 않은 응답")}</div>}
      </article>)}
      {!!progress.length && <details className="copilot-progress" open={running}><summary>문서 작업 · {progress.length}단계{running ? " · 진행 중" : ""}</summary>
        <ul>{progress.map((text, i) => <li key={i}>{text}</li>)}</ul></details>}
      {proposals.map((proposal) => <div className="copilot-proposal" key={proposal.id}>
        <p>{proposal.path} · {proposal.kind === "create" ? "새 문서" : "수정안"}</p>
        {isStale(proposal) && <p>문서가 변경되었거나 같은 이름이 있습니다. 다시 요청해 주세요.</p>}
        <button disabled={running || isStale(proposal) || busy || applying} onClick={() => { if (proposal.kind !== "create") onReview(proposal.path); setReview(proposal); }}>변경 내용 확인</button>
        <button disabled={running || applying} onClick={() => setProposals((old) => old.filter((p) => p.id !== proposal.id))}>버리기</button>
      </div>)}
    </div>
    {!!liveEdits.drafts.length && <div className="copilot-pending-list"><strong>미확정 문서 {liveEdits.drafts.length}개</strong>{liveEdits.drafts.map((draft) => <button key={draft.path} onClick={() => onReview(draft.path)}>{draft.path}</button>)}<small>가운데 편집기에서 유지하거나 되돌려 주세요.</small></div>}
    {error && !review && <p className="copilot-error" role="alert">{error}</p>}
    <form className="copilot-composer" onSubmit={send}>
      <div className="copilot-context-row">
        <select aria-label={`${label} 전달 범위`} title="Copilot에 보낼 내용" value={scope} disabled={running || applying} onChange={(e) => { newConversation(); setScope(e.target.value); }}>
          <option value="none">문서 없음</option><option value="document" disabled={!note}>현재 문서</option><option value="selection" disabled={!note}>선택 영역</option>
        </select>
        <div className="copilot-context-label" title={note?.path}>{scope === "none" ? "현재 문서는 보내지 않습니다" : note?.path ?? "문서를 열어 주세요"}</div>
      </div>
      <div className="copilot-attachments">
        <button type="button" disabled={running || applying} onClick={() => setAttachmentsOpen(!attachmentsOpen)}><Paperclip size={12} />참고 문서 {references.length}/5</button>
        {references.map((path) => <button type="button" className="attachment-chip" key={path} disabled={running} title="첨부 제거" onClick={() => setReferences((old) => old.filter((p) => p !== path))}>{path} ×</button>)}
        {attachmentsOpen && <div className="copilot-attachment-picker">
          <input aria-label="참고 문서 검색" placeholder="문서 이름 검색" value={attachmentSearch} onChange={(e) => setAttachmentSearch(e.target.value)} />
          <div>{notes.filter((n) => n.path !== note?.path && !references.includes(n.path) && n.path.toLocaleLowerCase().includes(attachmentSearch.toLocaleLowerCase())).slice(0, 100).map((n) => <button type="button" disabled={references.length >= 5 || running} key={n.path} onClick={() => { setReferences((old) => [...old, n.path]); setAttachmentsOpen(false); }}>{n.path}</button>)}</div>
        </div>}
        {mode === "agent" && <label className="copilot-vault-access"><input type="checkbox" checked={vaultAccess} disabled={running} onChange={(e) => setVaultAccess(e.target.checked)} />보관함 검색·읽기 허용</label>}
        {mode === "agent" && vaultAccess && <small>검색 결과와 읽은 문서가 Copilot에 전송됩니다.</small>}
      </div>
      <div className="copilot-input-box">
        <textarea aria-label={`${label} 질문`} placeholder={`${label}에게 물어보세요…`} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) { e.preventDefault(); if (!e.repeat) send(); } }} />
        <div className="copilot-send-row">
          <select aria-label={`${label} 작업`} title="작업 모드" value={mode} disabled={running || applying} onChange={(e) => { newConversation(); setMode(e.target.value); }}>
            <option value="agent">Agent</option><option value="chat">Ask</option><option value="edit" disabled={scope === "none" || !note}>Edit</option>
          </select>
        {connection.authenticated && <label className="copilot-model"><select aria-label={`${label} 모델`} value={model} title="모델 선택" disabled={running || checking} onChange={(e) => setModel(e.target.value)}>
          <option value="">{connection.models.length ? "모델을 선택해 주세요" : "사용 가능한 모델 확인 필요"}</option>
          {connection.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>}
          {running ? <button type="button" aria-label={`${label} 응답 중지`} onClick={() => { liveEdits.stop(); invoke(ai.cancel({ requestId: pending.current?.requestId })).catch((e) => setError(e.message)); }}><Square size={15} />중지</button>
            : <button type="submit" className="primary-button" aria-label={`${label} 보내기`} aria-describedby="copilot-send-status" title={blockedSend?.message || "현재 전달 범위로 질문 보내기"} disabled={!canSend}><ArrowUp size={16} /></button>}
        </div>
      </div>
      <div id="copilot-send-status" className="copilot-send-status" role="status" aria-label="Copilot 전송 상태">
        {blockedSend?.message}
        {blockedSend?.code === "vault" && <button type="button" className="text-action" aria-label="AI용 노트 폴더 열기" onClick={onOpenVault}>노트 폴더 열기</button>}
        {blockedSend?.code === "drafts" && <button type="button" className="text-action" onClick={() => { newConversation(); setMode("chat"); }}>Ask로 대화</button>}
      </div>
      <small className="copilot-shortcuts">Enter 전송 · Shift+Enter 줄바꿈</small>
      <small className="copilot-allowance">선택한 내용과 대화가 전송되며 Copilot 사용량이 적용됩니다.</small>
    </form>
    {review && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label={`${label} 수정안 확인`} className="modal wide copilot-review">
      <div className="modal-heading"><h2>수정안 확인</h2><button disabled={applying} onClick={() => setReview(null)}>닫기</button></div>
      <p>{review.path} · 확인한 내용만 문서에 반영합니다.</p>
      <div className="copilot-comparison"><section><h3>변경 전</h3><pre>{review.target?.before ?? "(새 문서)"}</pre></section><section><h3>변경 후</h3><pre>{review.content}</pre></section></div>
      {isStale(review) && <p role="alert">문서가 변경되었습니다. 수정 제안을 다시 요청해 주세요.</p>}
      {error && <p role="alert" className="copilot-error">{error}</p>}
      <div className="modal-actions"><button disabled={applying} onClick={() => setReview(null)}>취소</button><button className="primary-button" disabled={busy || applying || isStale(review)} onClick={apply}><Check size={14} />{applying ? "저장 중…" : review.kind === "create" ? "새 문서 만들기" : "문서에 적용"}</button></div>
    </section></div>}
  </section>;
}
