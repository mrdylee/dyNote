import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { runtimeEnvironment } from "./copilot-controller.mjs";

export const codexConfig = Object.freeze({
  forced_login_method: "chatgpt", cli_auth_credentials_store: "keyring",
  model_provider: "openai", web_search: "disabled", project_doc_max_bytes: 0,
  "skills.bundled.enabled": false, "skills.include_instructions": false,
  "orchestrator.skills.enabled": false, "orchestrator.mcp.enabled": false,
  "memories.generate_memories": false, "memories.use_memories": false,
  "history.persistence": "none", "analytics.enabled": false,
  ...Object.fromEntries([
    "shell_tool", "shell_snapshot", "unified_exec", "apps", "plugins",
    "remote_plugin", "hooks", "memories", "chronicle", "multi_agent",
    "browser_use", "in_app_browser", "computer_use", "image_generation",
    "code_mode", "code_mode_host", "tool_suggest", "workspace_dependencies",
    "goals", "request_permissions_tool",
  ].map((name) => [`features.${name}`, false])),
});

export function codexEnvironment(directory, env = process.env) {
  return { ...runtimeEnvironment(env), CODEX_HOME: directory };
}

export function codexCandidates({ platform = process.platform, env = process.env } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const directories = ["/opt/homebrew/bin", "/usr/local/bin", ...(env.PATH ?? "").split(p.delimiter)].filter((dir) => p.isAbsolute(dir));
  const candidates = directories.map((dir) => p.join(dir, platform === "win32" ? "codex.exe" : "codex"));
  if (platform === "win32") {
    for (const dir of [...directories, ...(env.APPDATA ? [p.join(env.APPDATA, "npm")] : [])]) {
      const npm = p.join(dir, "node_modules", "@openai");
      for (const root of [npm, p.join(npm, "codex", "node_modules", "@openai")])
        for (const folder of ["bin", "codex"])
          candidates.push(p.join(root, "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", folder, "codex.exe"));
    }
  }
  return [...new Set(candidates)];
}
async function findCodex() {
  for (const candidate of codexCandidates()) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* Try the next installed path. */ }
  }
  throw new Error("Codex CLI를 찾지 못했습니다. Codex CLI 0.144.5 이상을 설치한 뒤 Dynote를 다시 실행해 주세요.");
}

async function checkVersion(command, env) {
  const { stdout } = await promisify(execFile)(command, ["--version"], { env, timeout: 10000, windowsHide: true });
  const match = stdout.match(/codex-cli (\d+)\.(\d+)\.(\d+)/);
  const version = match?.slice(1).map(Number);
  if (!version || (version[0] === 0 && (version[1] < 144 || (version[1] === 144 && version[2] < 5))))
    throw new Error("Codex CLI 0.144.5 이상이 필요합니다. CLI를 업데이트해 주세요.");
}

export class CodexRpc {
  constructor({ directory, command, onNotification = () => {}, onClose = () => {}, spawnProcess = spawn, checkVersion: verify = checkVersion }) {
    Object.assign(this, { directory, command, onNotification, onClose, spawnProcess, verify });
    this.pending = new Map(); this.sequence = 0; this.buffer = ""; this.child = null; this.closed = false;
  }

  async start() {
    const workspace = path.join(this.directory, "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const command = this.command ?? await findCodex(), env = codexEnvironment(this.directory);
    await this.verify(command, env);
    if (this.closed) throw new Error("Codex 연결이 종료되었습니다.");
    const args = ["app-server", "--listen", "stdio://", ...Object.entries(codexConfig).flatMap(([key, value]) => ["-c", `${key}=${JSON.stringify(value)}`])];
    this.child = this.spawnProcess(command, args, { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.resume(); // Runtime diagnostics can contain auth URLs; never forward them to the renderer.
    this.child.on("error", () => this.fail(new Error("Codex 실행에 실패했습니다. CLI 설치 상태를 확인해 주세요.")));
    this.child.on("exit", () => this.fail(new Error("Codex 연결이 종료되었습니다. 다시 연결해 주세요.")));
    this.child.stdin.on("error", () => this.fail(new Error("Codex 연결이 종료되었습니다.")));
    await this.request("initialize", { clientInfo: { name: "dynote", title: "Dynote", version: "0.12.1" }, capabilities: { experimentalApi: true } });
    this.write({ method: "initialized", params: {} });
    // Managed/global MCP configuration must not silently add external tools.
    const { config } = await this.request("config/read", { includeLayers: false });
    if (Object.values(config?.mcp_servers ?? {}).some((server) => server.enabled !== false)) {
      await this.close();
      throw new Error("Codex에 외부 도구 설정이 있습니다. Dynote 전용 연결에서는 외부 도구를 사용할 수 없습니다.");
    }
  }

  write(value) {
    if (this.closed || !this.child) throw new Error("Codex 연결이 종료되었습니다.");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }

  request(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Codex 연결이 종료되었습니다."));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.fail(new Error("Codex 연결 시간이 초과되었습니다. 다시 시도해 주세요.")), 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) return this.fail(new Error("Codex 응답이 너무 큽니다."));
    let end;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { return this.fail(new Error("Codex 응답 형식을 읽을 수 없습니다.")); }
      if (message.method && message.id != null) {
        const result = /(?:commandExecution|fileChange)\/requestApproval$/.test(message.method)
          ? { result: { decision: "decline" } }
          : message.method === "item/permissions/requestApproval"
            ? { result: { permissions: {}, scope: "turn" } }
            : { error: { code: -32601, message: "Dynote does not execute tools or grant permissions." } };
        this.write({ id: message.id, ...result });
      } else if (message.id != null) {
        const waiting = this.pending.get(message.id);
        if (!waiting) continue;
        this.pending.delete(message.id); clearTimeout(waiting.timer);
        if (message.error) waiting.reject(new Error(message.error.message ?? "Codex 요청 실패"));
        else waiting.resolve(message.result);
      } else if (message.method) this.onNotification(message.method, message.params ?? {});
    }
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear(); this.child?.kill();
    this.onClose(error);
  }

  async close() {
    this.fail(new Error("Codex 연결이 종료되었습니다."));
  }
}
