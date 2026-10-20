import path from "node:path";
import { MAX_ANSWER, prepareRequest, sessionOptions } from "../core/copilot.mjs";
import { CodexRpc } from "./codex-rpc.mjs";

const safeError = (error) => String(error?.message ?? error)
  .replace(/\b(?:sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, "[redacted]")
  .replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 800);

export function safeCodexLoginUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["auth.openai.com", "chatgpt.com"].includes(url.hostname) ||
      url.port || url.username || url.password ||
      !/^\/(?:oauth\/|auth\/|codex\/)/.test(url.pathname))
    throw new Error("ChatGPT 로그인 주소를 확인할 수 없습니다.");
  return url.href;
}

export class CodexController {
  constructor({ directory, onEvent, openExternal, createRpc = (options) => new CodexRpc(options) }) {
    Object.assign(this, { directory, onEvent, openExternal, createRpc });
    this.rpcPromise = null; this.job = null; this.loginJob = null; this.closed = false;
  }

  client() {
    if (this.closed) throw new Error("Codex가 종료되었습니다.");
    if (!this.rpcPromise) {
      this.rpcPromise = (async () => {
        const rpc = this.createRpc({
          directory: this.directory, onNotification: (method, params) => this.notification(method, params),
          onClose: (error) => {
            this.rpcPromise = null;
            if (this.job) { this.job.failure = safeError(error); this.job.finish?.(); }
            if (this.loginJob) this.finishLogin("error", safeError(error));
          },
        });
        try { await rpc.start(); return rpc; }
        catch (error) { await rpc.close(); throw error; }
      })().catch((error) => { this.rpcPromise = null; throw error; });
    }
    return this.rpcPromise;
  }

  async status() {
    let rpc, account;
    try {
      rpc = await this.client();
      ({ account } = await rpc.request("account/read", { refreshToken: false }));
    } catch (error) { throw new Error(safeError(error)); }
    const result = { authenticated: account?.type === "chatgpt", login: account?.type === "chatgpt" ? account.email ?? "ChatGPT" : "", models: [], error: "" };
    if (account && !result.authenticated) result.error = "ChatGPT 계정으로 연결해 주세요.";
    if (result.authenticated) {
      try {
        let cursor = null;
        do {
          const page = await rpc.request("model/list", { limit: 100, includeHidden: false, cursor });
          result.models.push(...page.data.filter((model) => !model.hidden).map((model) => ({ id: model.model ?? model.id, name: model.displayName ?? model.model ?? model.id })));
          cursor = page.nextCursor;
        } while (cursor);
      } catch (error) { result.error = safeError(error); }
    }
    return result;
  }

  send(input) {
    if (this.job || this.loginJob) throw new Error("Codex 작업이 진행 중입니다.");
    const args = prepareRequest(input), job = { id: args.requestId, canceled: false, items: new Map() };
    this.job = job;
    job.promise = this.run(job, args);
    return { requestId: job.id };
  }

  async run(job, args) {
    let rpc, timer, terminal;
    try {
      rpc = await this.client();
      if (job.canceled) return;
      const status = await this.status();
      if (job.canceled) return;
      if (!status.authenticated) throw new Error("먼저 ChatGPT 계정으로 Codex에 연결해 주세요.");
      if (!status.models.some((model) => model.id === args.model)) throw new Error(status.error || "선택한 모델을 사용할 수 없습니다.");
      const { thread } = await rpc.request("thread/start", {
        model: args.model, modelProvider: "openai", cwd: path.join(this.directory, "workspace"),
        ephemeral: true, environments: [], dynamicTools: [], sandbox: "read-only",
        approvalPolicy: "untrusted", baseInstructions: sessionOptions(args.model, args.mode).systemMessage.content,
        developerInstructions: "Use only the supplied JSON. Return text; no tools or environment access.",
      });
      job.threadId = thread.id;
      if (job.canceled) return;
      const completed = new Promise((resolve) => { job.finish = resolve; });
      timer = setTimeout(() => { job.failure = "Codex 응답 시간이 초과되었습니다. 요청 범위를 줄여 다시 시도해 주세요."; job.finish(); }, 120000);
      const { turn } = await rpc.request("turn/start", {
        threadId: thread.id, environments: [],
        input: [{ type: "text", text: JSON.stringify({ request: args.prompt, context: args.context, dialogue: args.history }), text_elements: [] }],
      });
      job.turnId = turn.id;
      if (!job.canceled && !job.failure) await completed;
      if (job.canceled) return;
      if (job.failure) throw new Error(job.failure);
      const content = this.answer(job);
      if (!content.trim()) throw new Error("Codex 응답이 비어 있습니다. 다시 시도해 주세요.");
      terminal = { type: "done", content };
    } catch (error) {
      if (!job.canceled) terminal = { type: "error", error: safeError(error) };
    } finally {
      clearTimeout(timer);
      if (job.turnId && (job.canceled || terminal?.type === "error"))
        await rpc.request("turn/interrupt", { threadId: job.threadId, turnId: job.turnId }).catch(() => {});
      if (job.threadId) await rpc.request("thread/unsubscribe", { threadId: job.threadId }).catch(() => {});
      if (this.job === job) this.job = null;
      if (job.canceled) this.onEvent({ type: "canceled", requestId: job.id });
      else if (terminal) this.onEvent({ requestId: job.id, ...terminal });
    }
  }

  answer(job) {
    return [...job.items.values()].filter((item) => !item.phase || item.phase === "final_answer" || item.phase === "partial_answer").map((item) => item.text).join("\n");
  }

  notification(method, params) {
    if (method === "account/login/completed") {
      if (this.loginJob?.id === params.loginId)
        this.finishLogin(params.success ? "connected" : "error", params.success ? "ChatGPT 계정이 연결되었습니다." : safeError(params.error || "로그인을 완료하지 못했습니다."));
      return;
    }
    const job = this.job;
    if (!job || job.canceled || job.failure || params.threadId !== job.threadId || (job.turnId && params.turnId && params.turnId !== job.turnId)) return;
    if (method === "turn/completed") {
      if (params.turn.status !== "completed") job.failure = safeError(params.turn.error?.message || "Codex 응답이 중단되었습니다.");
      job.finish?.(); return;
    }
    if (method === "item/started" || method === "item/completed") {
      if (params.item.type !== "agentMessage") return;
      const previous = job.items.get(params.item.id);
      job.items.set(params.item.id, { phase: params.item.phase, text: params.item.text ?? previous?.text ?? "" });
    } else if (method === "item/agentMessage/delta") {
      const item = job.items.get(params.itemId) ?? { text: "" };
      item.text += params.delta; job.items.set(params.itemId, item);
    } else return;
    const content = this.answer(job);
    if ([...job.items.values()].reduce((bytes, item) => bytes + Buffer.byteLength(item.text), 0) > MAX_ANSWER) {
      job.failure = "Codex 응답이 너무 큽니다. 요청 범위를 줄여 주세요."; job.finish?.(); return;
    }
    this.onEvent({ type: "delta", requestId: job.id, content });
  }

  async cancel(id) {
    const job = this.job;
    if (!job || (id && id !== job.id)) return;
    job.canceled = true; job.finish?.();
  }

  settled() { return this.job?.promise ?? Promise.resolve(); }

  async login() {
    if (this.job || this.loginJob) throw new Error("Codex 작업이 진행 중입니다.");
    const job = { canceled: false };
    this.loginJob = job;
    this.onEvent({ type: "auth", phase: "starting", message: "ChatGPT 연결 준비 중…" });
    let rpc;
    try {
      rpc = await this.client();
      if (job.canceled) return;
      const response = await rpc.request("account/login/start", { type: "chatgpt" });
      job.id = response.loginId;
      if (job.canceled) { await rpc.request("account/login/cancel", { loginId: job.id }); return; }
      await this.openExternal(safeCodexLoginUrl(response.authUrl));
      if (this.loginJob !== job || job.canceled) return;
      job.timer = setTimeout(() => this.cancelLogin().catch(() => {}), 5 * 60000);
      this.onEvent({ type: "auth", phase: "waiting", message: "브라우저에서 ChatGPT 로그인을 완료해 주세요." });
    } catch (error) {
      if (job.id) await rpc.request("account/login/cancel", { loginId: job.id }).catch(() => {});
      if (this.loginJob === job) this.finishLogin("error", safeError(error));
      throw new Error(safeError(error));
    }
  }

  finishLogin(phase, message) {
    clearTimeout(this.loginJob?.timer); this.loginJob = null;
    this.onEvent({ type: "auth", phase, message });
  }

  async cancelLogin() {
    const job = this.loginJob;
    if (!job) return;
    job.canceled = true;
    if (job.id) await (await this.client()).request("account/login/cancel", { loginId: job.id }).catch(() => {});
    if (this.loginJob === job) this.finishLogin("canceled", "로그인을 취소했습니다.");
  }

  async close() {
    await this.cancelLogin();
    await this.cancel();
    this.closed = true;
    if (this.rpcPromise) await (await this.rpcPromise.catch(() => null))?.close();
  }
}
