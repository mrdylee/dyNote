import CopilotMentions from "./CopilotMentions.jsx";
import CopilotExtensions from "./CopilotExtensions.jsx";
import { prepareCaptureImage } from "./planner-image.mjs";
import { sendBlock } from "../core/copilot-send-state.mjs";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, GitBranch, Plus, RefreshCw, Square, Sparkles, Paperclip, ChevronDown } from "lucide-react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import DiagramPreview from "./DiagramPreview.jsx";
import CloudAskPanel from "./CloudAskPanel.jsx";
import { captureContext, applyProposal, prepareRequest } from "../core/copilot.mjs";

const invoke = async (promise) => {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const markdown = new MarkdownIt({ html: false, breaks: true });
// Model output must not fetch remote images or navigate the app.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(`[이미지: ${tokens[index].content}]`);
const answerHtml = (text) => DOMPurify.sanitize(markdown.render(text), { FORBID_TAGS: ["img", "a"] });

export default function CopilotPanel({ api, vaultId, session, ...props }) {
  if (session.provider === "copilot" && session.connection.bridge)
    return <CloudAskPanel key={vaultId} api={api} session={session} vaultId={vaultId} visible={props.visible} busy={props.busy}
      renderAnswer={text => <DiagramPreview className="copilot-message-content markdown-answer" html={answerHtml(text)} renderDiagrams />} />;
  return <ProviderPanel key={`${vaultId}:${session.provider}`} {...props} api={api} vaultId={vaultId} session={session} provider={session.provider} onProvider={session.setProvider} />;
}

function ProviderPanel({ api, vaultId, session, provider, onProvider, note, notes = [], selection, busy, onApply, onReview, visible, liveEdits, onBeginLive, onOpenVault }) {
  const label = { copilot: "Copilot", codex: "Codex", claude: "Claude" }[provider];
  const accountLabel = { copilot: "GitHub", codex: "Codex", claude: "Claude" }[provider];
  const { ai, connection, checking, model, setModel, refresh, reasoningEfforts, reasoningEffort, setReasoningEffort, defaultReasoningEffort } = session;
  const effortLabel = value => ({ none: "없음", minimal: "최소", low: "낮음", medium: "보통", high: "높음", xhigh: "매우 높음", max: "최대", ultra: "최상" }[value] ?? value);
  const accountMenu = useRef(null);
  const [auth, setAuth] = useState(null);
  const [scope, setScope] = useState("document");
  const [mode, setMode] = useState(provider !== "claude" ? "agent" : "chat");
  const [prompt, setPrompt] = useState("");
  const chat = useRef(null);
  const [historyList, setHistoryList] = useState(null);
  const [extensionManager, setExtensionManager] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);
  const chatHistory = (action, extra = {}) => invoke(api.copilotHistory({ vaultId, chatId: chat.current, action, ...extra }));
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState([]);
  const [review, setReview] = useState(null);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [references, setReferences] = useState([]);
  const [attachmentSearch, setAttachmentSearch] = useState("");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [vaultAccess, setVaultAccess] = useState(false);
  const pending = useRef(null), transcript = useRef(null), mounted = useRef(true), loginPending = useRef(false);
  const editPrompt = text => {
    if (pending.current) pending.current.promptEdited = true;
    setPrompt(text);
  };
  const previousPath = useRef(note?.path);
  const latest = useRef(null);
  latest.current = { note, notes, vaultId, onApply, busy, liveEdits, onBeginLive };
  useEffect(() => { setError(connection.error || ""); }, [connection]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = ai.onEvent((event) => {
      if (event.type === "auth") {
        setAuth(event);
        loginPending.current = ["starting", "waiting"].includes(event.phase);
        return;
      }
      const request = pending.current;
      if (!request || request.requestId !== event.requestId) return;
      if (event.type === "delta" || event.type === "done") {
        request.reply = event.content;
        setMessages((old) => old.map((m) => m.id === request.requestId ? { ...m, content: event.content, complete: event.type === "done" } : m));
      }
      if (event.type === "done") {
        if (request.image) setAttachment(null);
        if (request.mode === "edit") setProposals([{ id: request.requestId, kind: "edit", path: request.target.path, target: request.target, content: event.content }]);
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
        if (request.chatId) chatHistory("finish", { chatId: request.chatId, requestId: request.requestId, status: event.type, content: event.content || request.reply || event.error }).catch(e => setError(e.message));
        if (request.mode === "agent") latest.current.liveEdits.finish(request.requestId);
        if (event.type !== "done") {
          if (!request.promptEdited) setPrompt(request.inputPrompt);
          setProposals([]); setReview(null);
        }
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
    if (previousPath.current === note?.path) return;
    previousPath.current = note?.path;
    if (mode === "agent" || (provider === "copilot" && mode === "chat" && scope === "none")) return;
    if (pending.current) ai.cancel({ requestId: pending.current.requestId }).catch(() => {});
    pending.current = null;
    chat.current = null; setHistoryList(null); setCheckpoint(null);
    setAttachment(null);
    setRunning(false); setMessages([]); setProposals([]); setReview(null); setError("");
  }, [note?.path]);
  useEffect(() => {
    if (visible && transcript.current) transcript.current.scrollTop = messages.length ? transcript.current.scrollHeight : 0;
  }, [messages, progress, proposals, visible]);
  const authBusy = auth && ["starting", "waiting"].includes(auth.phase);
  useEffect(() => {
    session.setActivity("chat", !!(running || authBusy), vaultId);
    return () => session.setActivity("chat", false, vaultId);
  }, [running, authBusy, vaultId, session.setActivity]);
  const newConversation = () => {
    chat.current = null; setHistoryList(null); setCheckpoint(null);
    setMessages([]); setProposals([]); setReview(null); setError(""); setProgress([]);
  };
  const login = async () => {
    if (loginPending.current) return;
    setError(""); setAuth({ phase: "starting", message: `${label} 로그인 준비 중…` }); loginPending.current = true;
    try { await invoke(ai.login()); }
    catch (e) { loginPending.current = false; setAuth({ phase: "error", message: e.message }); }
  };
  const independent = provider === "copilot";
  const pasteImage = async event => {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    if (running || pending.current) { setError("현재 응답이 끝난 뒤 이미지를 붙여 넣어 주세요."); return; }
    if (files.length > 1 || attachment) { setError("이미지는 한 장씩 첨부할 수 있습니다. 교체하려면 기존 이미지를 제거해 주세요."); return; }
    const draft = { name: files[0].name || "클립보드 이미지" };
    setError("");
    setAttachment(draft);
    try {
      const image = await prepareCaptureImage(files[0]);
      setAttachment(current => current === draft ? { ...draft, image } : current);
    } catch (e) {
      setAttachment(current => current === draft ? { ...draft, error: e.message } : current);
    }
  };
  const outgoingPrompt = attachment && mode !== "edit" && !prompt.trim() ? "첨부한 이미지를 검토해 주세요." : prompt;
  const otherChatRunning = Object.keys(session.activeChats).some(id => id !== String(vaultId));
  const effectiveScope = independent && !note && mode !== "edit" ? "none" : scope;
  const otherWork = independent ? mode === "agent" && (liveEdits.running || liveEdits.working)
    : liveEdits.running || liveEdits.working || session.activity.planner || otherChatRunning;
  const blockedSend = sendBlock({ connection, model, prompt: outgoingPrompt, attachment, checking, authBusy, busy: busy || otherWork, applying, running, label,
    vaultId, note, scope: effectiveScope, selection, mode, ready: liveEdits.ready, blocked: liveEdits.blocked() });
  const canSend = !blockedSend;
  const send = async (event) => {
    event?.preventDefault();
    if (pending.current || running || !canSend) return;
    let request;
    try {
      const { context, target } = captureContext({ vaultId, note, scope: effectiveScope, selection });
      const requestId = crypto.randomUUID();
      const history = messages.filter((m) => m.complete && m.mode !== "edit").map(({ role, content }) => ({ role, content }));
      const attached = references.filter((path) => path !== context.path).map((path) => {
        const found = notes.find((n) => n.path === path);
        if (!found) throw new Error(`첨부 문서가 없어졌습니다: ${path}`);
        return { path, content: found.content };
      });
      const drafts = mode === "agent" ? latest.current.liveEdits.drafts.map(({ path, content }) => ({ path, content })) : [];
      const args = prepareRequest({ requestId, vaultId, model, reasoningEffort, prompt: outgoingPrompt, image: attachment?.image, mode, context, references: attached, drafts, vaultAccess: mode === "agent" && vaultAccess, history: mode === "edit" ? [] : history });
      setError(""); setProposals([]); setReview(null); setProgress([]); setRunning(true);
      if (independent) chat.current ??= crypto.randomUUID();
      request = { ...args, target, inputPrompt: prompt, promptEdited: false, chatId: independent ? chat.current : null };
      pending.current = request;
      setPrompt("");
      if (request.chatId) {
        await chatHistory("begin", { requestId, lastRequestId, prompt: args.prompt, mode, imageName: attachment?.name });
        request.recorded = true;
      }
      if (!mounted.current || pending.current !== request) return;
      if (mode === "agent") await latest.current.onBeginLive(requestId, () => ai.cancel({ requestId }));
      if (!mounted.current) { latest.current.liveEdits.stop(); await latest.current.liveEdits.finish(requestId); return; }
      if (request.canceled) {
        await latest.current.liveEdits.finish(requestId);
        pending.current = null;
        setRunning(false);
        if (!request.promptEdited) setPrompt(request.inputPrompt);
        setError("요청을 중지했습니다. 질문을 다시 보낼 수 있습니다.");
        return;
      }
      setMessages((old) => [...old,
        { id: `${requestId}-user`, requestId, role: "user", content: args.prompt, imageName: attachment?.name, complete: true, mode },
        { id: requestId, checkpoint: request.chatId ? requestId : null, role: "assistant", content: "", complete: false, mode },
      ]);
      try { await invoke(ai.send(args)); request.sent = true; }
      catch (e) {
        if (pending.current !== request) return;
        setMessages(old => old.filter(message => message.id !== requestId && message.id !== `${requestId}-user`));
        throw e;
      }
    } catch (e) {
      if (request && pending.current !== request) return;
      if (request && !request.promptEdited) setPrompt(request.inputPrompt);
      if (pending.current?.mode === "agent") latest.current.liveEdits.finish(pending.current.requestId);
      pending.current = null; setRunning(false); setError(e.message);
    } finally {
      if (request?.recorded && !request.sent) {
        await chatHistory("discardUnsent", { chatId: request.chatId, requestId: request.requestId }).catch(e => setError(e.message));
      }
    }
  };
  const stop = () => {
    const request = pending.current;
    if (!request) return;
    request.canceled = true;
    if (request.mode === "agent") latest.current.liveEdits.stop();
    else invoke(ai.cancel({ requestId: request.requestId })).catch(e => setError(e.message));
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
      const ref = independent ? { chatId: chat.current, requestId: review.id } : null;
      const staged = await current.onApply(review);
      const content = staged ? `초안에 반영: ${review.path}. 저장하려면 변경 유지를 눌러 주세요.` : `적용 완료: ${review.path}. 다음 작업에서는 현재 내용을 다시 확인합니다.`;
      if (ref) await chatHistory("applied", { ...ref, content }).catch(e => setError(e.message));
      setMessages((old) => [...old, { id: crypto.randomUUID(), role: "assistant", mode: "agent", complete: true, content }]);
      setReview(null); setProposals((old) => old.filter((p) => p.id !== review.id));
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  };

  async function showHistory() {
    try { setError(""); setHistoryList(await chatHistory("list")); }
    catch (e) { setError(e.message); }
  }
  async function reopen(id) {
    try {
      const saved = await chatHistory("open", { chatId: id });
      newConversation(); chat.current = id;
      setMode("chat"); setScope("none"); setPrompt(""); setReferences([]); setAttachment(null); setVaultAccess(false);
      setMessages(saved);
    } catch (e) { setError(e.message); }
  }
  const lastRequestId = messages.findLast(m => m.role === "user")?.requestId;
  async function restoreConversation() {
    const chatId = chat.current;
    setApplying(true); setError("");
    try {
      const retained = await chatHistory("rewind", { chatId, requestId: checkpoint.id, lastRequestId: checkpoint.lastRequestId });
      if (mounted.current && chat.current === chatId) {
        setMessages(retained); setCheckpoint(null); setReview(null); setProposals([]); setProgress([]);
      }
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  return <section className="copilot-panel" aria-label={`${label} 채팅`} hidden={!visible}>
    <div className="copilot-chat-heading">
      <select className="ai-provider-select" aria-label="AI 제공자" value={provider}
        disabled={running || session.activity.chat || applying || authBusy || checking || session.activity.planner || proposals.length > 0 || (!independent && liveEdits.blocked())} onChange={event => onProvider(event.target.value)}>
        <option value="copilot">Copilot</option><option value="codex">Codex</option><option value="claude">Claude</option>
      </select>
      <div className="copilot-heading-actions">
        {independent && <details className="copilot-history-menu" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }}
          onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary").focus(); } }}>
          <summary aria-label="Copilot 대화 관리" title="최근 대화 및 Skill · MCP 관리">⋯</summary>
          <div className="copilot-history-options">
            <button disabled={!vaultId || running || applying} onClick={e => { e.target.closest("details").open = false; showHistory(); }}>최근 대화</button>
            <button onClick={e => { e.target.closest("details").open = false; setExtensionManager(true); }}>Skill · MCP 관리</button>
          </div></details>}
        <details className="copilot-account-menu" ref={accountMenu}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; event.currentTarget.querySelector("summary").focus(); } }}>
          <summary aria-label={`${label} 계정 설정`} title={connection.authenticated ? `${accountLabel} · ${connection.login || "연결됨"}` : `${accountLabel} 연결 설정`}>
            <GitBranch size={13}/><span>{connection.authenticated ? connection.login || accountLabel : `${accountLabel} 연결`}</span><ChevronDown size={11}/>
          </summary>
          <div className="copilot-account-options" role="group" aria-label={`${accountLabel} 연결 설정`}>
            {connection.worker && <p>Cloud Worker · {connection.worker.error || (connection.worker.lastChecked ? "Git 확인 " + new Date(connection.worker.lastChecked).toLocaleTimeString() : "연결 확인 중")}</p>}
            <p>{connection.authenticated ? `${accountLabel} · ${connection.login || "연결됨"}` : `${accountLabel} 계정으로 연결하세요.`}</p>
            {provider !== "copilot" && <p>{label} 로그인은 브라우저에서 진행하며, Dynote에서 한 번 완료하면 유지됩니다.</p>}
            <button type="button" disabled={checking || running || applying || authBusy || session.activity.planner} onClick={() => { accountMenu.current.open = false; login(); }}>{connection.authenticated ? "계정 다시 연결" : provider === "copilot" ? "GitHub로 연결" : `${label} 로그인`}</button>
            <button type="button" disabled={checking || running || applying || authBusy} onClick={() => { accountMenu.current.open = false; refresh(); }}>이미 연결한 계정 확인</button>
          </div>
        </details>
        <button type="button" title="연결 상태 확인" aria-label={`${label} 연결 상태 확인`} disabled={checking || running || applying || authBusy} onClick={refresh}><RefreshCw size={14} className={checking ? "spin" : ""}/></button>
        <button type="button" title="새 대화" aria-label={`${label} 새 대화`} disabled={running || applying} onClick={() => { setAttachment(null); newConversation(); }}><Plus size={14}/></button>
      </div>
    </div>
    {extensionManager && <CopilotExtensions api={api} onClose={() => setExtensionManager(false)} />}
    {historyList && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="최근 대화">
      <div className="modal-heading"><h2>최근 대화</h2><button onClick={() => setHistoryList(null)}>닫기</button></div>
      {error && <p role="alert">{error}</p>}
      {historyList.length ? <ul>{historyList.map(c => <li key={c.id}><button onClick={() => reopen(c.id)}>{c.title}</button> <small>{new Date(c.updated).toLocaleString()}</small></li>)}</ul> : <p>이 보관함에 저장된 대화가 없습니다.</p>}
    </section></div>}
    {checkpoint && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="대화 복원">
      <div className="modal-heading"><h2>이 답변까지 대화 복원</h2></div>
      <p>선택한 답변 이후의 질문과 답변을 대화 기록에서 지웁니다.</p>
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer"><button disabled={applying} onClick={() => setCheckpoint(null)}>취소</button>
        <button className="primary-button" disabled={applying} onClick={restoreConversation}>대화 복원</button></div>
    </section></div>}
    {auth && (authBusy || auth.phase === "error") && <div className="copilot-auth-notice">
      <p role="status" className={`copilot-auth ${auth.phase === "error" ? "failed" : ""}`}>{auth.message}</p>
      {authBusy && <button type="button" className="text-action" onClick={() => invoke(ai.cancelLogin()).catch(e => setError(e.message))}>로그인 취소</button>}
    </div>}
    <div className="copilot-transcript" ref={transcript} role="log" aria-label={`${label} 대화`}>
      {!messages.length && <div className="copilot-empty"><Sparkles size={24} /><h3>생각을 더 선명하게</h3><p>내용을 요약하거나, 문장을 다듬거나,<br />시험 항목을 체크리스트로 정리해 보세요.</p>
        <div className="copilot-suggestions">{(mode === "agent" ? ["현재 문서에 실행할 일 체크리스트를 추가해 줘", "현재 문서를 참고해서 새 요약 문서를 만들어 줘"] : ["핵심 내용을 요약해 줘", "실행할 일을 체크리스트로 정리해 줘"]).map((text) => <button key={text} onClick={() => editPrompt(text)}>{text}</button>)}</div>
      </div>}
      {messages.map((m) => <article className={`copilot-message ${m.role}`} key={m.id}>
        <strong>{m.role === "user" ? "나" : m.mode === "edit" ? `${label} · 수정안` : label}</strong>
        {m.imageName && <small className="copilot-sent-image"><Paperclip size={12} />{m.imageName}</small>}
        {m.role === "assistant" && m.content ? <DiagramPreview className="copilot-message-content markdown-answer" html={answerHtml(m.content)} renderDiagrams={m.complete} />
          : <div className="copilot-message-content">{m.content || (running ? "답변을 준비하고 있어요…" : "완료되지 않은 응답")}</div>}
        {m.checkpoint && m.complete && <button className="text-action" disabled={running || applying || busy || m.checkpoint === lastRequestId}
          onClick={() => { setError(""); setCheckpoint({ id: m.checkpoint, lastRequestId }); }}>복원 지점</button>}
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
    {error && !review && blockedSend?.message !== error && <p className="copilot-error" role="alert">{error}</p>}
    <form className="copilot-composer" onSubmit={send}>
      <div className="copilot-context-row">
        <select aria-label={`${label} 전달 범위`} title={`${label}에 보낼 내용`} value={effectiveScope} disabled={running || applying} onChange={(e) => { newConversation(); setScope(e.target.value); }}>
          <option value="none">문서 없음</option><option value="document" disabled={!note}>현재 문서</option><option value="selection" disabled={!note}>선택 영역</option>
        </select>
        <div className="copilot-context-label" title={note?.path}>{scope === "none" ? "현재 문서는 보내지 않습니다" : note?.path ?? "문서를 열어 주세요"}</div>
      </div>
      <div className="copilot-attachments">
        <button type="button" disabled={running || applying} onClick={() => setAttachmentsOpen(!attachmentsOpen)}><Paperclip size={12} />참고 문서 {references.length}/5</button>
        {references.map((path) => <button type="button" className="attachment-chip" key={path} disabled={running} title="첨부 제거" onClick={() => setReferences((old) => old.filter((p) => p !== path))}>{path} ×</button>)}
        {attachment && <button type="button" disabled={running} aria-label="첨부 이미지 제거" title="첨부 이미지 제거" onClick={() => { setAttachment(null); setError(""); }}>
          {attachment.image && <img className="copilot-image-preview" alt="첨부 이미지 미리보기" src={`data:${attachment.image.mimeType};base64,${attachment.image.data}`} />}
          {attachment.name} ×
        </button>}
        {attachmentsOpen && <div className="copilot-attachment-picker">
          <input aria-label="참고 문서 검색" placeholder="문서 이름 검색" value={attachmentSearch} onChange={(e) => setAttachmentSearch(e.target.value)} />
          <div>{notes.filter((n) => n.path !== note?.path && !references.includes(n.path) && n.path.toLocaleLowerCase().includes(attachmentSearch.toLocaleLowerCase())).slice(0, 100).map((n) => <button type="button" disabled={references.length >= 5 || running} key={n.path} onClick={() => { setReferences((old) => [...old, n.path]); setAttachmentsOpen(false); }}>{n.path}</button>)}</div>
        </div>}
        {mode === "agent" && <label className="copilot-vault-access"><input type="checkbox" checked={vaultAccess} disabled={running} onChange={(e) => setVaultAccess(e.target.checked)} />보관함 검색·읽기 허용</label>}
        {mode === "agent" && vaultAccess && <small>검색 결과와 읽은 문서가 {label}에 전송됩니다.</small>}
      </div>
      <div className="copilot-input-box">
        <CopilotMentions enabled={independent && !running} label={label} prompt={prompt} setPrompt={editPrompt}
          notes={notes.filter(n => effectiveScope === "none" || n.path !== note?.path)} references={references} onAttach={path => setReferences(old => [...old, path])}
          onSend={send} onPaste={independent ? pasteImage : undefined} />
        <div className="copilot-send-row">
          <select aria-label={`${label} 작업`} title="작업 모드" value={mode} disabled={running || applying} onChange={(e) => { newConversation(); setMode(e.target.value); }}>
            {provider !== "claude" && <option value="agent">Agent</option>}<option value="chat">Ask</option><option value="edit" disabled={scope === "none" || !note}>Edit</option>
          </select>
        {connection.authenticated && <label className="copilot-model"><select aria-label={`${label} 모델`} value={model} title="모델 선택" disabled={running || checking || (!independent && session.activity.planner)} onChange={(e) => setModel(e.target.value)}>
          <option value="">{connection.models.length ? "모델을 선택해 주세요" : "사용 가능한 모델 확인 필요"}</option>
          {connection.models.map((m) => <option key={m.id} value={m.id}>{m.name}{attachment && m.vision ? " · 이미지 지원" : ""}</option>)}
        </select></label>}
          {running ? <button type="button" aria-label={`${label} 응답 중지`} onClick={stop}><Square size={15} />중지</button>
            : <button type="submit" className="primary-button" aria-label={`${label} 보내기`} aria-describedby="copilot-send-status" title={blockedSend?.message || "현재 전달 범위로 질문 보내기"} disabled={!canSend}><ArrowUp size={16} /></button>}
        </div>
        {connection.authenticated && provider !== "claude" && <label className="copilot-reasoning"><span>추론 강도</span><select aria-label={`${label} 추론 강도`} value={reasoningEffort} disabled={running || applying || checking || (!independent && session.activity.planner) || !reasoningEfforts.length} onChange={event => setReasoningEffort(event.target.value)}>
          <option value="">모델 기본값{defaultReasoningEffort ? ` (${effortLabel(defaultReasoningEffort)})` : ""}</option>
          {reasoningEfforts.map(value => <option key={value} value={value}>{effortLabel(value)}</option>)}
        </select></label>}
      </div>
      <div id="copilot-send-status" className="copilot-send-status" role="status" aria-label={`${label} 전송 상태`}>
        {blockedSend?.message}
        {blockedSend?.code === "auth" && <div className="copilot-connect-actions">
          <button type="button" className="primary-button" disabled={busy || running || applying} onClick={login}>{label} 로그인</button>
          <button type="button" className="secondary-button" disabled={busy || running || applying} onClick={refresh}>연결 다시 확인</button>
        </div>}
        {blockedSend?.code === "vault" && <button type="button" className="text-action" aria-label="AI용 노트 폴더 열기" onClick={onOpenVault}>노트 폴더 열기</button>}
        {blockedSend?.code === "drafts" && <button type="button" className="text-action" onClick={() => { newConversation(); setMode("chat"); }}>Ask로 대화</button>}
      </div>
      <small className="copilot-shortcuts">Enter 전송 · Shift+Enter 줄바꿈</small>
      <small className="copilot-allowance">선택한 내용과 대화가 전송되며 {label} 사용량이 적용됩니다.{provider === "claude" && " Ask·Edit 지원"}</small>
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
