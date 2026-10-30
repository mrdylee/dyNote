import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexController, safeCodexLoginUrl } from "../electron/codex-controller.mjs";
import { CodexRpc, codexEnvironment, codexConfig, codexCandidates } from "../electron/codex-rpc.mjs";

test("Codex discovers Windows npm native binary at a custom global prefix", () => {
  const candidates = codexCandidates({ platform: "win32", env: { PATH: "C:\\npm" } });
  assert.ok(candidates.includes("C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe"));
  assert.ok(!candidates.some(p => p.endsWith(".cmd")));
});

const request = (extra = {}) => ({
  requestId: "req-1", vaultId: "vault-1", model: "model-1", mode: "chat",
  prompt: "요약", context: { kind: "selection", path: "Home.md", content: "선택한 문장" },
  history: [], ...extra,
});
function fixture(overrides = {}) {
  const calls = [], events = [], opened = [];
  let notify;
  const rpc = {
    async start() {},
    async request(method, params) {
      calls.push({ method, params });
      if (overrides[method]) return overrides[method](params, notify);
      if (method === "account/read") return { account: { type: "chatgpt", email: "test@example.test", planType: "plus", token: "never-render" } };
      if (method === "model/list") return { data: [{ id: "model-1", model: "model-1", displayName: "Test model" }], nextCursor: null };
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "turn/start") {
        queueMicrotask(() => {
          notify("item/started", { threadId: "thread-1", item: { id: "answer", type: "agentMessage", phase: "final_answer" } });
          notify("item/agentMessage/delta", { threadId: "thread-1", itemId: "answer", delta: "요약입니다" });
          notify("item/completed", { threadId: "thread-1", item: { id: "answer", type: "agentMessage", phase: "final_answer", text: "요약입니다" } });
          notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
        });
        return { turn: { id: "turn-1" } };
      }
      if (method === "account/login/start") return { type: "chatgpt", loginId: "login-1", authUrl: "https://auth.openai.com/oauth/authorize?client_id=public" };
      return {};
    },
    async close() {},
  };
  const controller = new CodexController({
    directory: "/tmp/dynote-codex-unit",
    onEvent: (event) => events.push(event), openExternal: async (url) => opened.push(url),
    createRpc: (options) => { notify = options.onNotification; return rpc; },
  });
  return { controller, rpc, calls, events, opened, notify: (...args) => notify(...args) };
}

test("Codex uses an isolated ChatGPT account and exposes only account/model display fields", async () => {
  const f = fixture();
  const status = await f.controller.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.login, "test@example.test");
  assert.deepEqual(status.models, [{ id: "model-1", name: "Test model" }]);
  assert.ok(!JSON.stringify(status).includes("never-render"));
  await f.controller.close();
});

test("Codex forwards attachments and refuses unsupported Agent and images", async () => {
  const f = fixture();
  assert.throws(() => f.controller.send(request({ mode: "agent" })), /Ask.*Edit/);
  f.controller.send(request({ references: [{ path: "Other.md", content: "참고" }] }));
  await f.controller.settled();
  const turn = f.calls.find(c => c.method === "turn/start");
  assert.equal(JSON.parse(turn.params.input[0].text).references[0].content, "참고");
  await f.controller.close();
});

test("Codex sends chosen context in ephemeral threads with no environment and streams the answer", async () => {
  const f = fixture();
  f.controller.send(request());
  await f.controller.settled();
  const start = f.calls.find((c) => c.method === "thread/start").params;
  assert.equal(start.ephemeral, true);
  assert.deepEqual(start.environments, []);
  assert.deepEqual(start.dynamicTools, []);
  assert.equal(start.sandbox, "read-only");
  const turn = f.calls.find((c) => c.method === "turn/start").params;
  assert.deepEqual(turn.environments, []);
  assert.equal(JSON.parse(turn.input[0].text).context.content, "선택한 문장");
  assert.equal(f.events.at(-1).content, "요약입니다");
  assert.equal(f.events.at(-1).type, "done");
  assert.ok(f.calls.some((c) => c.method === "thread/unsubscribe"));
  await f.controller.close();
});

test("Codex ignores unrelated threads and excludes commentary from replacement text", async () => {
  const f = fixture({ "turn/start": async (_params, notify) => {
    for (const [threadId, id, phase, text] of [
      ["other", "foreign", "final_answer", "private"],
      ["thread-1", "thinking", "commentary", "분석 중"],
      ["thread-1", "final", "final_answer", "# 수정안"],
    ]) notify("item/completed", { threadId, item: { id, type: "agentMessage", phase, text } });
    notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    return { turn: { id: "turn-1" } };
  } });
  f.controller.send(request({ mode: "edit" }));
  await f.controller.settled();
  assert.equal(f.events.at(-1).content, "# 수정안");
  await f.controller.close();
});

test("Codex rejects unavailable models, API-key accounts and oversized context before a turn", async () => {
  for (const overrides of [
    { "model/list": async () => ({ data: [], nextCursor: null }) },
    { "account/read": async () => ({ account: { type: "apiKey" } }) },
  ]) {
    const f = fixture(overrides);
    f.controller.send(request());
    await f.controller.settled();
    assert.equal(f.events.at(-1).type, "error");
    assert.ok(!f.calls.some((c) => c.method === "turn/start"));
    await f.controller.close();
  }
  const f = fixture();
  assert.throws(() => f.controller.send(request({ context: { kind: "document", path: "A.md", content: "가".repeat(24000) } })), /64/);
  await f.controller.close();
});

test("Codex cancel during startup sends no context and does not affect a different request", async () => {
  const f = fixture();
  let ready;
  f.rpc.start = () => new Promise((resolve) => { ready = resolve; });
  f.controller.send(request());
  while (!ready) await new Promise(setImmediate);
  await f.controller.cancel("other");
  await f.controller.cancel("req-1");
  ready();
  await f.controller.settled();
  assert.ok(!f.calls.some((c) => c.method === "turn/start"));
  assert.equal(f.events.at(-1).type, "canceled");
  await f.controller.close();
});

test("Codex cancellation interrupts a running turn and ends once", async () => {
  const f = fixture({ "turn/start": async () => ({ turn: { id: "turn-1" } }) });
  f.controller.send(request());
  while (!f.calls.some((c) => c.method === "turn/start")) await new Promise(setImmediate);
  await new Promise(setImmediate);
  await f.controller.cancel("req-1");
  await f.controller.settled();
  assert.ok(f.calls.some((c) => c.method === "turn/interrupt"));
  assert.equal(f.events.filter((e) => e.type === "canceled").length, 1);
  await f.controller.close();
});

test("Codex overflow and failed turns cannot be reported as successful edits", async () => {
  for (const overflow of [true, false]) {
    const f = fixture({ "turn/start": async (_params, notify) => {
      notify("item/agentMessage/delta", { threadId: "thread-1", itemId: "answer", delta: overflow ? "x".repeat(131073) : "partial" });
      notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: overflow ? "completed" : "failed", error: { message: "quota exhausted" } } });
      return { turn: { id: "turn-1" } };
    } });
    f.controller.send(request());
    await f.controller.settled();
    assert.equal(f.events.at(-1).type, "error");
    assert.ok(!f.events.some((e) => e.type === "done"));
    await f.controller.close();
  }
});

test("Codex login allowlists auth domains and correlates completion with the active login", async () => {
  const f = fixture();
  await f.controller.login();
  assert.equal(f.opened.length, 1);
  f.notify("account/login/completed", { loginId: "other", success: true });
  assert.equal(f.events.at(-1).phase, "waiting");
  f.notify("account/login/completed", { loginId: "login-1", success: true });
  assert.equal(f.events.at(-1).phase, "connected");
  for (const url of ["file:///tmp/auth", "http://auth.openai.com/oauth/authorize", "https://auth.openai.com.evil.test/oauth/authorize", "https://u:p@chatgpt.com/auth", "https://chatgpt.com:8443/auth"])
    assert.throws(() => safeCodexLoginUrl(url));
  await f.controller.close();
});

test("Codex login cancellation and rejected URL clean the pending flow", async () => {
  const f = fixture();
  await f.controller.login();
  await f.controller.cancelLogin();
  assert.ok(f.calls.some((c) => c.method === "account/login/cancel" && c.params.loginId === "login-1"));
  assert.equal(f.events.at(-1).phase, "canceled");
  await f.controller.close();
  const bad = fixture({ "account/login/start": async () => ({ loginId: "login-1", authUrl: "https://evil.test" }) });
  await assert.rejects(bad.controller.login());
  assert.equal(bad.opened.length, 0);
  assert.ok(bad.calls.some((c) => c.method === "account/login/cancel"));
  await bad.controller.close();
});

test("Codex login completion during browser launch does not revert to waiting", async () => {
  const f = fixture();
  f.controller.openExternal = async () => {
    f.notify("account/login/completed", { loginId: "login-1", success: true });
  };
  await f.controller.login();
  assert.equal(f.events.at(-1).phase, "connected");
  assert.equal(f.controller.loginJob, null);
  await f.controller.close();
});

test("Codex account errors do not forward credentials to the renderer", async () => {
  const f = fixture({ "account/read": async () => { throw new Error("Rejected Bearer abc123 sk-secretValue"); } });
  await assert.rejects(f.controller.status(), (error) => !/abc123|secretValue/.test(error.message));
  await f.controller.close();
});

test("Codex environment excludes ambient credentials and disables unrelated capabilities", () => {
  const env = codexEnvironment("/app/codex", { PATH: "/bin", HOME: "/home/test", OPENAI_API_KEY: "secret", CODEX_HOME: "/user/codex", NODE_OPTIONS: "bad" });
  assert.equal(env.CODEX_HOME, "/app/codex");
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(codexConfig["features.shell_tool"], false);
  assert.equal(codexConfig["features.apps"], false);
  assert.equal(codexConfig["features.plugins"], false);
  assert.equal(codexConfig["orchestrator.skills.enabled"], false);
  assert.equal(codexConfig["orchestrator.mcp.enabled"], false);
  assert.equal(codexConfig["web_search"], "disabled");
  assert.equal(codexConfig["cli_auth_credentials_store"], "keyring");
});

test("RPC correlates fragmented replies, rejects execution requests and rejects pending work on exit", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.emit("exit", 0); return true; };
  const writes = [];
  child.stdin.on("data", (bytes) => {
    const data = JSON.parse(bytes.toString()); writes.push(data);
    if (["initialize", "config/read"].includes(data.method)) child.stdout.write(JSON.stringify({ id: data.id, result: {} }) + "\n");
  });
  const rpc = new CodexRpc({ directory: "/tmp/dynote-codex-rpc-unit", command: "/mock/codex", checkVersion: async () => {}, spawnProcess: () => child });
  await rpc.start();
  const answer = rpc.request("account/read", {});
  const id = writes.at(-1).id;
  child.stdout.write(`{"id":${id},"result":`);
  child.stdout.write('{"account":null}}\n');
  assert.deepEqual(await answer, { account: null });
  child.stdout.write('{"id":99,"method":"item/commandExecution/requestApproval","params":{}}\n');
  assert.equal(writes.at(-1).result.decision, "decline");
  child.stdout.write('{"id":100,"method":"item/tool/call","params":{}}\n');
  assert.ok(writes.at(-1).error);
  const pending = rpc.request("model/list", {});
  child.emit("exit", 1);
  await assert.rejects(pending, /종료/);
  await rpc.close();
});
