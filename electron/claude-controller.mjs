import { spawn } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_ANSWER, prepareRequest, sessionOptions } from "../core/copilot.mjs";
import { runtimeEnvironment } from "./copilot-controller.mjs";

const models = ["sonnet", "opus", "haiku"].map(id => ({ id, name: `Claude ${id[0].toUpperCase()}${id.slice(1)}` }));
export function claudeEnvironment(directory, env = process.env) {
  return { ...runtimeEnvironment(env), CLAUDE_CONFIG_DIR: directory, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" };
}
export function claudeCandidates({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const dirs = [p.join(home, ".local", "bin"), ...(env.PATH ?? "").split(p.delimiter), "/opt/homebrew/bin", "/usr/local/bin"].filter(dir => p.isAbsolute(dir));
  const candidates = dirs.map(dir => p.join(dir, platform === "win32" ? "claude.exe" : "claude"));
  if (platform === "win32") {
    for (const dir of [...dirs, ...(env.APPDATA ? [p.join(env.APPDATA, "npm")] : [])]) {
      const npm = p.join(dir, "node_modules", "@anthropic-ai");
      candidates.push(p.join(npm, "claude-code-win32-x64", "claude.exe"), p.join(npm, "claude-code", "bin", "claude.exe"), p.join(npm, "claude-code", "cli.js"));
    }
  }
  return [...new Set(candidates)];
}
async function resolveClaude() {
  for (const candidate of claudeCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      const resolved = await realpath(candidate);
      if (!resolved.endsWith(".js")) return { command: resolved, args: [] };
      // npm shims need the installed Node runtime, never Electron or a shell.
      for (const dir of [path.dirname(candidate), ...(process.env.PATH ?? "").split(path.delimiter)]) {
        if (!path.isAbsolute(dir)) continue;
        const node = path.join(dir, process.platform === "win32" ? "node.exe" : "node");
        try { await access(node, constants.X_OK); return { command: node, args: [resolved] }; } catch { /* Next runtime. */ }
      }
    } catch { /* Next installation. */ }
  }
  throw new Error("Claude Code CLI 2.1.118 이상을 설치한 뒤 Dynote를 다시 실행해 주세요. 설치 안내: https://code.claude.com/docs/en/setup");
}
export function claudeArguments(args) {
  return ["--print", "--verbose", "--output-format", "stream-json", "--include-partial-messages",
    "--model", args.model, "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--settings", '{"disableAllHooks":true}', "--disable-slash-commands", "--no-session-persistence", "--permission-mode", "dontAsk",
    "--system-prompt", sessionOptions(args.model, args.mode).systemMessage.content];
}

export class ClaudeController {
  constructor({ directory, onEvent, resolveCli = resolveClaude, spawnProcess = spawn }) {
    Object.assign(this, { directory, onEvent, resolveCli, spawnProcess });
    this.job = null; this.loginJob = null; this.closed = false; this.runtime = null;
    this.children = new Set();
  }
  process(cli, args, { input = "", onLine, timeout = 30000, started = () => {} } = {}) {
    if (this.closed) return Promise.reject(new Error("Claude 연결이 종료되었습니다."));
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(cli.command, [...cli.args, ...args], { cwd: path.join(this.directory, "workspace"), env: claudeEnvironment(this.directory), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      this.children.add(child);
      let output = "", buffer = "", failure, killTimer;
      const stop = () => { child.kill(); killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2000); killTimer.unref(); };
      const fail = error => { failure ??= error; stop(); };
      const timer = setTimeout(() => fail(new Error("Claude 연결 시간이 초과되었습니다. 다시 시도해 주세요.")), timeout);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        if (failure) return;
        if (!onLine) {
          output += chunk;
          if (Buffer.byteLength(output) > MAX_ANSWER) fail(new Error("Claude 응답이 너무 큽니다."));
          return;
        }
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return fail(new Error("Claude 응답이 너무 큽니다."));
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line.trim()) try { onLine(JSON.parse(line)); } catch (error) { fail(error); break; }
        }
      });
      child.stderr.resume(); // Never forward raw CLI diagnostics, login URLs or credentials.
      child.on("error", () => { failure = new Error("Claude 실행에 실패했습니다. CLI 설치 상태를 확인해 주세요."); });
      child.stdin.on("error", () => fail(new Error("Claude 입력 연결이 종료되었습니다.")));
      child.on("close", code => {
        clearTimeout(timer); clearTimeout(killTimer); this.children.delete(child);
        if (onLine && buffer.trim() && !failure) try { onLine(JSON.parse(buffer)); } catch (error) { failure = error; }
        if (failure) reject(failure); else resolve({ code, output });
      });
      started(stop); child.stdin.end(input);
    });
  }
  async client() {
    if (this.closed) throw new Error("Claude 연결이 종료되었습니다.");
    if (!this.runtime) this.runtime = (async () => {
      await mkdir(path.join(this.directory, "workspace"), { recursive: true, mode: 0o700 });
      const cli = await this.resolveCli();
      const { code, output } = await this.process(cli, ["--version"]);
      const version = output.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
      if (code !== 0 || !version || version[0] < 2 || (version[0] === 2 && (version[1] < 1 || (version[1] === 1 && version[2] < 118))))
        throw new Error("Claude Code CLI 2.1.118 이상이 필요합니다. CLI를 업데이트한 뒤 다시 연결해 주세요.");
      return cli;
    })().catch(error => { this.runtime = null; throw error; });
    return this.runtime;
  }
  async status() {
    const { code, output } = await this.process(await this.client(), ["auth", "status"]);
    let account;
    try { account = JSON.parse(output); } catch { throw new Error("Claude 로그인 상태를 읽지 못했습니다. CLI를 업데이트해 주세요."); }
    const authenticated = code === 0 && account.loggedIn === true && account.authMethod === "claude.ai";
    return { authenticated, login: authenticated ? account.email ?? "Claude" : "", models: authenticated ? models : [], error: account.loggedIn && !authenticated ? "Claude 계정으로 다시 연결해 주세요." : "" };
  }
  send(input) {
    if (this.closed || this.job || this.loginJob) throw new Error("Claude 작업이 진행 중이거나 연결이 종료되었습니다.");
    const args = prepareRequest(input);
    if (!["chat", "edit"].includes(args.mode) || args.image) throw new Error("Claude는 Ask와 Edit 텍스트 작업을 지원합니다.");
    const job = { id: args.requestId, canceled: false }; this.job = job;
    job.promise = this.run(job, args); return { requestId: job.id };
  }
  async run(job, args) {
    let terminal;
    try {
      const status = await this.status();
      if (job.canceled) return;
      if (!status.authenticated) throw new Error("먼저 Claude 계정으로 연결해 주세요.");
      if (!models.some(m => m.id === args.model)) throw new Error("선택한 Claude 모델을 사용할 수 없습니다.");
      let content = "", result;
      const { code } = await this.process(await this.client(), claudeArguments(args), {
        input: JSON.stringify({ request: args.prompt, context: args.context, references: args.references, dialogue: args.history }), timeout: 180000,
        started: stop => { job.stop = stop; if (job.canceled) stop(); },
        onLine: event => {
          if (job.canceled) return;
          if (event.type === "system" && event.subtype === "init" && event.tools?.length) throw new Error("Claude 외부 도구를 비활성화하지 못했습니다. 요청을 중단했습니다.");
          if (event.type === "stream_event" && event.event?.delta?.type === "text_delta") {
            content += event.event.delta.text;
            if (Buffer.byteLength(content) > MAX_ANSWER) throw new Error("Claude 응답이 너무 큽니다.");
            this.onEvent({ type: "delta", requestId: job.id, content });
          }
          if (event.type === "result") result = event;
        },
      });
      if (job.canceled) return;
      if (code !== 0 || !result || result.is_error || result.subtype !== "success") throw new Error("Claude 응답을 완료하지 못했습니다. 로그인, 모델 이용 권한과 사용량을 확인해 주세요.");
      content = typeof result.result === "string" ? result.result : content;
      if (!content.trim() || Buffer.byteLength(content) > MAX_ANSWER) throw new Error("Claude 응답이 비어 있거나 너무 큽니다.");
      terminal = { type: "done", content };
    } catch (error) { terminal = { type: "error", error: error instanceof SyntaxError ? "Claude 응답 형식을 읽을 수 없습니다." : error.message }; }
    finally {
      if (this.job === job) this.job = null;
      this.onEvent({ requestId: job.id, ...(job.canceled ? { type: "canceled" } : terminal) });
    }
  }
  async login() {
    if (this.job || this.loginJob || this.closed) throw new Error("Claude 작업이 진행 중이거나 연결이 종료되었습니다.");
    const job = { canceled: false }; this.loginJob = job;
    this.onEvent({ type: "auth", phase: "starting", message: "Claude 연결 준비 중…" });
    job.promise = (async () => {
      try {
        const cli = await this.client(); if (job.canceled) return;
        this.onEvent({ type: "auth", phase: "waiting", message: "브라우저에서 Claude 로그인을 완료해 주세요." });
        const { code } = await this.process(cli, ["auth", "login", "--claudeai"], { timeout: 300000, started: stop => { job.stop = stop; if (job.canceled) stop(); } });
        if (job.canceled) return;
        if (code !== 0 || !(await this.status()).authenticated) throw new Error("Claude 로그인을 완료하지 못했습니다. 다시 연결해 주세요.");
        this.onEvent({ type: "auth", phase: "connected", message: "Claude 계정이 연결되었습니다." });
      } catch (error) { if (!job.canceled) this.onEvent({ type: "auth", phase: "error", message: error.message }); }
      finally { if (this.loginJob === job) this.loginJob = null; if (job.canceled) this.onEvent({ type: "auth", phase: "canceled", message: "로그인을 취소했습니다." }); }
    })();
  }
  async cancel(id) { if (this.job && (!id || id === this.job.id)) { this.job.canceled = true; this.job.stop?.(); } }
  settled() { return this.job?.promise ?? Promise.resolve(); }
  async cancelLogin() { if (this.loginJob) { this.loginJob.canceled = true; this.loginJob.stop?.(); await this.loginJob.promise; } }
  async close() {
    await this.cancel();
    this.closed = true;
    if (this.loginJob) this.loginJob.canceled = true;
    for (const child of this.children) child.kill();
    await Promise.allSettled([this.settled(), this.loginJob?.promise]);
  }
}
