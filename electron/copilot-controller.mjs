import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { MAX_ANSWER, prepareRequest, reasoningCapabilities, safeLoginUrl, sessionOptions, validateReasoningEffort } from "../core/copilot.mjs";
import { noteTools } from "../core/copilot-agent.mjs";
import { skillTools } from "./ai-skills.mjs";

const message = (error) => String(error?.message ?? error).replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[redacted]").slice(0, 800);

// Do not inherit unrelated Git/API tokens or provider overrides from the host.
export function runtimeEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) =>
    /^(PATH|HOME|USERPROFILE|USER|LOGNAME|APPDATA|LOCALAPPDATA|SystemRoot|SYSTEMROOT|WINDIR|windir|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)$/i.test(name)));
}

export class CopilotController {
  constructor({ directory, onEvent, openExternal, createClient, getNotes, getExtensions = async () => ({}) }) {
    this.directory = directory;
    this.onEvent = onEvent;
    this.openExternal = openExternal;
    this.getNotes = getNotes;
    this.getExtensions = getExtensions;
    this.createClient = createClient ?? (async () => {
      const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
      // Executables must live outside app.asar; the platform package is unpacked
      // by the desktop packager. Development uses the SDK's default resolver.
      let connection;
      if (import.meta.url.includes("/app.asar/")) {
        const require = createRequire(import.meta.url);
        const platform = `${process.platform}-${process.arch}`;
        const root = path.dirname(require.resolve(`@github/copilot-sdk-${platform}/package.json`)).replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
        connection = RuntimeConnection.forStdio({ path: path.join(root, "prebuilds", platform, process.platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime") });
      }
      return new CopilotClient({
        connection,
        // Empty mode forcibly disables the OS credential store in SDK 1.0.23.
        // Keep desktop sign-in enabled; sessionOptions restricts all AI sessions.
        mode: "copilot-cli", baseDirectory: directory, workingDirectory: path.join(directory, "workspace"),
        env: runtimeEnvironment(), useLoggedInUser: true, logLevel: "error", enableRemoteSessions: false,
      });
    });
    this.clientPromise = null;
    this.job = null;
    this.loginJob = null;
    this.closed = false;
  }

  client() {
    if (this.closed) throw new Error("Copilot이 종료되었습니다.");
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        await mkdir(path.join(this.directory, "workspace"), { recursive: true, mode: 0o700 });
        const client = await this.createClient();
        try { await client.start(); return client; }
        catch (error) { await client.stop().catch(() => {}); throw error; }
      })().catch((error) => { this.clientPromise = null; throw error; });
    }
    return this.clientPromise;
  }

  async status() {
    const client = await this.client();
    const auth = await client.getAuthStatus();
    const result = { authenticated: !!auth.isAuthenticated, login: auth.login ?? "", models: [], error: "" };
    if (result.authenticated) {
      try {
        result.models = (await client.listModels())
          .filter((model) => model.policy?.state !== "disabled")
          .map((model) => ({ id: model.id, name: model.name || model.id, vision: model.capabilities?.supports?.vision === true,
            ...reasoningCapabilities(model.capabilities?.supports?.reasoningEffort ? model.supportedReasoningEfforts : [], model.defaultReasoningEffort) }));
      } catch (error) { result.error = message(error); }
    }
    return result;
  }

  send(input) {
    if (this.job || this.loginJob) throw new Error("Copilot 작업이 진행 중입니다.");
    const args = prepareRequest(input);
    const job = { id: args.requestId, canceled: false, session: null };
    this.job = job;
    job.promise = this.run(job, args);
    return { requestId: job.id };
  }

  async run(job, args) {
    let client, unsubscribe, content = "", failed = false, terminal;
    const emit = (type, data = {}) => this.onEvent({ requestId: job.id, type, ...data });
    try {
      client = await this.client();
      if (job.canceled) return;
      const status = await this.status();
      if (job.canceled) return;
      if (!status.authenticated) throw new Error("먼저 GitHub Copilot에 연결해 주세요.");
      if (!status.models.some((model) => model.id === args.model))
        throw new Error(status.error || "선택한 모델을 사용할 수 없습니다. 연결 상태를 새로 확인해 주세요.");
      validateReasoningEffort(status.models.find(model => model.id === args.model), args.reasoningEffort);
      if (args.image && !status.models.find(model => model.id === args.model)?.vision)
        throw new Error('이미지를 지원하는 모델을 선택해 주세요.');
      const tools = args.mode === "agent" ? noteTools({ args, getNotes: this.getNotes, emit, canceled: () => job.canceled || !!job.failure || this.closed }) : [];
      const extensions = args.mode === "agent" ? await this.getExtensions() : {};
      if (job.canceled) return;
      const servers = extensions.mcpServers ?? {}, directories = extensions.skillDirectories ?? [];
      const options = sessionOptions(args.model, args.mode, tools, args.reasoningEffort);
      if (Object.keys(servers).length || directories.length) {
        const selectedSkills = await skillTools({ directories, emit, canceled: () => job.canceled || !!job.failure || this.closed });
        if (job.canceled) return;
        options.tools = [...tools, ...selectedSkills];
        options.availableTools = [...options.availableTools, ...selectedSkills.map(tool => tool.name), ...(Object.keys(servers).length ? ["mcp:*"] : []), ...(directories.length ? ["builtin:skill"] : [])];
        options.mcpServers = Object.fromEntries(Object.entries(servers).map(([name, { cwd, ...server }]) => [name, { ...server, ...(cwd ? { workingDirectory: cwd } : {}) }]));
        options.enableSkills = directories.length > 0;
        options.skillDirectories = directories;
        options.onPermissionRequest = (request, invocation) => {
          if (job.canceled || job.failure || this.closed || request.kind !== "mcp" || request.managedApprovalRequired || invocation?.promptRequest?.managedApprovalRequired || !Object.hasOwn(servers, request.serverName)) return { kind: "reject" };
          const allowed = servers[request.serverName].tools ?? ["*"];
          const tool = request.toolName.startsWith(`${request.serverName}-`) ? request.toolName.slice(request.serverName.length + 1) : request.toolName;
          return { kind: allowed.includes("*") || allowed.includes(tool) ? "approve-once" : "reject" };
        };
        options.systemMessage = { ...options.systemMessage, content: options.systemMessage.content
          .replace("Use only the Dynote tools to read permitted notes and prepare writing changes.", "Use Dynote tools to read permitted notes and prepare writing changes. You may also use the configured MCP tools and skills when relevant. Use dynote_list_skills to discover selected skills and dynote_use_skill to read their instructions or relative resources; scripts are not executed by that tool.")
          .replace("No shell or external filesystem access is available.", "Do not use MCP tools or skills to bypass Dynote note permissions or draft review.") };
      }
      job.session = await client.createSession(options);
      if (job.canceled) return;
      await job.session.rpc.options.update({ installedPlugins: [] });
      if (job.canceled) return;
      const activeTools = new Map();
      unsubscribe = job.session.on((event) => {
        if (job.canceled || job.failure) return;
        if (args.mode === "agent" && event.type === "tool.execution_start" && !event.data.toolName.startsWith("dynote_")) {
          activeTools.set(event.data.toolCallId, event.data.toolName);
          emit("tool", { message: `도구 실행 · ${event.data.toolName.slice(0, 120)}` });
        }
        if (event.type === "tool.execution_complete" && activeTools.has(event.data.toolCallId)) {
          emit("tool", { message: `도구 ${event.data.success ? "완료" : "실패"} · ${activeTools.get(event.data.toolCallId).slice(0, 120)}` });
          activeTools.delete(event.data.toolCallId);
        }
        if (event.type === "assistant.message_delta") {
          const delta = event.data.deltaContent;
          if (typeof delta !== "string") return;
          content += delta;
          if (Buffer.byteLength(content) > MAX_ANSWER) {
            job.failure = "답변이 너무 큽니다. 요청 범위를 줄여 주세요.";
            job.session.abort().catch(() => {});
            return;
          }
          emit("delta", { content });
        }
        if (event.type === "session.error") job.failure = message(event.data.message);
      });
      const result = await job.session.sendAndWait({
        prompt: JSON.stringify({ request: args.prompt, context: args.context, references: args.references, vaultAccess: args.vaultAccess, dialogue: args.history }),
        ...(args.image ? { attachments: [{ type: 'blob', ...args.image, displayName: 'Schedule capture' }] } : {}),
      }, args.mode === "agent" ? 240000 : 120000);
      if (job.canceled) return;
      if (job.failure) throw new Error(job.failure);
      content = result?.data?.content ?? content;
      if (typeof content !== "string" || !content.trim()) throw new Error("응답이 비어 있습니다. 다시 시도해 주세요.");
      if (Buffer.byteLength(content) > MAX_ANSWER) throw new Error("답변이 너무 큽니다. 요청 범위를 줄여 주세요.");
      terminal = { type: "done", content };
    } catch (error) {
      failed = true;
      if (!job.canceled) terminal = { type: "error", error: message(error) };
    } finally {
      unsubscribe?.();
      if (job.session) {
        if (failed || job.canceled) await job.session.abort().catch(() => {});
        await client.deleteSession(job.session.sessionId).catch(() => {});
      }
      if (this.job === job) this.job = null;
      if (job.canceled) emit("canceled");
      else if (terminal) emit(terminal.type, terminal);
    }
  }

  async cancel(requestId) {
    const job = this.job;
    if (!job || (requestId && job.id !== requestId)) return;
    job.canceled = true;
    await job.session?.abort().catch(() => {});
  }

  settled() { return this.job?.promise ?? Promise.resolve(); }

  login() {
    if (this.job || this.loginJob) throw new Error("Copilot 작업이 진행 중입니다.");
    const job = { canceled: false, session: null };
    this.loginJob = job;
    job.promise = this.runLogin(job);
    return { started: true };
  }

  async runLogin(job) {
    let client, terminal;
    const emit = (data) => this.onEvent({ type: "auth", ...data });
    const timeout = setTimeout(() => this.cancelLogin().catch(() => {}), 5 * 60000);
    try {
      emit({ phase: "starting", message: "GitHub 연결 준비 중…" });
      client = await this.client();
      if (job.canceled) return;
      job.session = await client.createSession(sessionOptions(null, "chat"));
      if (job.canceled) return;
      await job.session.rpc.options.update({ installedPlugins: [] });
      if (job.canceled) return;
      const login = job.session.rpc.accounts.login;
      const begun = await login.begin({ kind: "githubDotCom" });
      job.flowId = begun.flowId;
      let step = begun.step;
      while (!job.canceled) {
        if (step.kind === "error") throw new Error(step.message);
        if (step.kind === "open-url") {
          await this.openExternal(safeLoginUrl(step.url));
          emit({ phase: "waiting", message: "브라우저에서 GitHub 로그인을 완료해 주세요." });
        } else if (step.kind === "completed") {
          if (step.result.status === "completed") {
            terminal = { phase: "connected", message: "GitHub 계정이 연결되었습니다." };
            return;
          }
          if (step.result.status === "needs-plaintext-consent")
            throw new Error("시스템 자격 증명 저장소를 사용할 수 없습니다. 키체인/자격 증명 관리자를 활성화한 뒤 다시 연결해 주세요.");
          throw new Error("GitHub 계정 선택을 완료하지 못했습니다. 다시 연결해 주세요.");
        } else if (step.kind === "input-required") {
          throw new Error("이 버전은 GitHub.com 계정 로그인을 지원합니다.");
        }
        step = await login.advance({ flowId: job.flowId });
      }
    } catch (error) {
      if (!job.canceled) terminal = { phase: "error", message: message(error) };
    } finally {
      clearTimeout(timeout);
      if (job.flowId) await job.session.rpc.accounts.login.cancel({ flowId: job.flowId }).catch(() => {});
      if (job.session) await client.deleteSession(job.session.sessionId).catch(() => {});
      if (this.loginJob === job) this.loginJob = null;
      if (terminal?.phase === "connected") {
        await client.stop().catch(() => {});
        this.clientPromise = null;
      }
      if (job.canceled) emit({ phase: "canceled", message: "로그인을 취소했습니다." });
      else if (terminal) emit(terminal);
    }
  }

  async cancelLogin() {
    const job = this.loginJob;
    if (!job) return;
    job.canceled = true;
    if (job.flowId) await job.session.rpc.accounts.login.cancel({ flowId: job.flowId }).catch(() => {});
  }

  async close() {
    this.closed = true;
    await Promise.all([this.cancel(), this.cancelLogin()]);
    const client = await this.clientPromise?.catch(() => null);
    if (client) await client.stop().catch(() => {});
  }
}
