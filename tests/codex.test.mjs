import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexController, safeCodexLoginUrl } from "../electron/codex-controller.mjs";
import { CodexRpc, codexEnvironment, codexConfig, codexCandidates } from "../electron/codex-rpc.mjs";
import { prepareRequest } from "../core/copilot.mjs";

test("Codex discovers Windows npm native binary at a custom global prefix", () => {
  const candidates = codexCandidates({ platform: "win32", env: { PATH: "C:\\npm" } });
  assert.ok(candidates.includes("C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\codex\\codex.exe"));
  assert.ok(candidates.includes("C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"));
  assert.ok(!candidates.some(p => p.endsWith(".cmd")));
});

const request = (extra = {}) => ({
  requestId: "req-1", vaultId: "vault-1", model: "model-1", mode: "chat",
  prompt: "요약", context: { kind: "selection", path: "Home.md", content: "선택한 문장" },
  history: [], ...extra,
});
function fixture(overrides = {}) {
  const calls = [], events = [], opened = [];
  let notify, onRequest;
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
    createRpc: (options) => { notify = options.onNotification; onRequest = options.onRequest; return rpc; },
  });
  return { controller, rpc, calls, events, opened, notify: (...args) => notify(...args), serverRequest: (...args) => onRequest(...args) };
}

test("Codex Agent dispatches scoped note tools and stages edits without saving", async () => {
  let f;
  f = fixture({ "turn/start": async (_params, notify) => {
    const call = (tool, args) => f.serverRequest("item/tool/call", { threadId: "thread-1", turnId: "turn-1", tool, arguments: args });
    assert.equal((await call("dynote_read_note", { path: "Home.md" })).success, true);
    assert.equal((await call("dynote_edit_note", { path: "Home.md", operation: "append", content: " appended" })).success, true);
    await assert.rejects(() => call("shell", { command: "anything" }), /도구/);
    notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    notify("item/completed", { threadId: "thread-1", item: { id: "a", type: "agentMessage", text: "초안 준비" } });
    return { turn: { id: "turn-1" } };
  } });
  try {
    f.controller.send(request({ mode: "agent" })); await f.controller.settled();
    assert.equal(f.events.at(-1).type, "done");
    const tools = f.calls.find(call => call.method === "thread/start").params.dynamicTools;
    assert.equal(tools.length, 4); assert.ok(tools.every(tool => tool.type === "function" && tool.inputSchema));
    assert.equal(f.events.find(event => event.type === "proposal").proposal.content, "선택한 문장 appended");
  } finally { await f.controller.close(); }
});

test("Codex Agent exposes selected MCP servers and skill resources without ambient discovery", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dynote-codex-skills-"));
  const skill = path.join(root, "sample"); await mkdir(skill);
  await writeFile(path.join(skill, "SKILL.md"), "---\nname: sample\ndescription: A public sample\n---\nPUBLIC_SKILL_INSTRUCTION");
  await writeFile(path.join(skill, "guide.md"), "PUBLIC_RESOURCE");
  await writeFile(path.join(root, "outside.md"), "OUTSIDE");
  if (process.platform !== "win32") await symlink(path.join(root, "outside.md"), path.join(skill, "escape.md"));
  let f;
  f = fixture({ "turn/start": async (_params, notify) => {
    const call = args => f.serverRequest("item/tool/call", { threadId: "thread-1", turnId: "turn-1", tool: "dynote_use_skill", arguments: args });
    const approval = { threadId: "thread-1", turnId: "turn-1", serverName: "sample", mode: "form", _meta: { codex_approval_kind: "mcp_tool_call" }, requestedSchema: { type: "object", properties: {} } };
    assert.deepEqual(await f.serverRequest("mcpServer/elicitation/request", approval), { action: "accept", content: {}, _meta: null });
    for (const bad of [{ serverName: "unselected" }, { mode: "url" }, { requestedSchema: { type: "object", properties: { password: { type: "string" } } } }, { _meta: {} }])
      await assert.rejects(() => f.serverRequest("mcpServer/elicitation/request", { ...approval, ...bad }), /도구/);
    const used = await call({ name: "sample" }); assert.equal(used.success, true); assert.match(used.contentItems[0].text, /PUBLIC_SKILL_INSTRUCTION/);
    assert.match((await call({ name: "sample", resource: "guide.md" })).contentItems[0].text, /PUBLIC_RESOURCE/);
    assert.equal((await call({ name: "sample", resource: "../outside.md" })).success, false);
    if (process.platform !== "win32") assert.equal((await call({ name: "sample", resource: "escape.md" })).success, false);
    notify("item/completed", { threadId: "thread-1", item: { id: "a", type: "agentMessage", text: "완료" } });
    notify("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    return { turn: { id: "turn-1" } };
  } });
  f.controller.getExtensions = async () => ({ mcpServers: { sample: { type: "local", command: "test", args: ["server"], cwd: root, tools: ["echo"] } }, skillDirectories: [root] });
  try {
    f.controller.send(request({ mode: "agent" })); await f.controller.settled();
    assert.equal(f.events.at(-1).type, "done");
    const params = f.calls.find(call => call.method === "thread/start").params;
    assert.equal(params.config.mcp_servers.sample.command, "test");
    assert.deepEqual(params.config.mcp_servers.sample.enabled_tools, ["echo"]);
    assert.ok(params.dynamicTools.some(tool => tool.name === "dynote_use_skill"));
    assert.ok(!params.config.skills?.include_instructions);
  } finally { await f.controller.close(); await rm(root, { recursive: true, force: true }); }
});

test("Codex advertises model-specific effort metadata and forwards it on turn/start", async () => {
  const f = fixture({ "model/list": async () => ({ data: [{ id: "model-1", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "ultra" }], defaultReasoningEffort: "ultra" }], nextCursor: null }) });
  try {
    const model = (await f.controller.status()).models[0];
    assert.deepEqual(model.reasoningEfforts, ["low", "ultra"]);
    assert.equal(model.defaultReasoningEffort, "ultra");
    f.controller.send(request({ reasoningEffort: "low" }));
    await f.controller.settled();
    assert.equal(f.events.at(-1).type, "done");
    assert.equal(f.calls.find(call => call.method === "turn/start").params.effort, "low");
  } finally { await f.controller.close(); }
});

test("Codex rejects stale effort before transmitting context and omits an empty override", async () => {
  const f = fixture();
  try {
    f.controller.send(request({ reasoningEffort: "high" }));
    await f.controller.settled();
    assert.match(f.events.at(-1).error, /추론/);
    assert.ok(!f.calls.some(call => call.method === "thread/start"));
    f.controller.send(request({ requestId: "default", reasoningEffort: "" }));
    await f.controller.settled();
    assert.equal(Object.hasOwn(f.calls.find(call => call.method === "turn/start").params, "effort"), false);
  } finally { await f.controller.close(); }
});

test("Codex uses an isolated ChatGPT account and exposes only account/model display fields", async () => {
  const f = fixture();
  const status = await f.controller.status();
  assert.equal(status.authenticated, true);
  assert.equal(status.login, "test@example.test");
  assert.deepEqual(status.models, [{ id: "model-1", name: "Test model", vision: true }]);
  assert.ok(!JSON.stringify(status).includes("never-render"));
  await f.controller.close();
});

test("Codex forwards attachments in Ask without exposing Agent tools", async () => {
  const f = fixture();
  f.controller.send(request({ references: [{ path: "Other.md", content: "참고" }] }));
  await f.controller.settled();
  const turn = f.calls.find(c => c.method === "turn/start");
  assert.equal(JSON.parse(turn.params.input[0].text).references[0].content, "참고");
  await f.controller.close();
});

test("Codex sends capture images through the selected account without starting login", async () => {
  const f = fixture();
  try {
    f.controller.send(request({ image: { mimeType: "image/png", data: "aGVsbG8=" } }));
    await f.controller.settled();
    assert.equal(f.events.at(-1).type, "done");
    assert.deepEqual(f.calls.find(c => c.method === "turn/start").params.input[1], { type: "image", url: "data:image/png;base64,aGVsbG8=" });
    assert.equal(f.opened.length, 0);
    assert.ok(!f.calls.some(c => c.method === "account/login/start"));
  } finally { await f.controller.close(); }
});

test("Codex respects advertised text-only image capability", async () => {
  const f = fixture({ "model/list": async () => ({ data: [{ id: "model-1", inputModalities: ["text"] }], nextCursor: null }) });
  try {
    assert.equal((await f.controller.status()).models[0].vision, false);
    f.controller.send(request({ image: { mimeType: "image/png", data: "aGVsbG8=" } }));
    await f.controller.settled();
    assert.equal(f.events.at(-1).type, "error");
    assert.ok(!f.calls.some(c => c.method === "turn/start"));
  } finally { await f.controller.close(); }
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
  assert.equal(codexConfig["features.view_image"], false);
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

test("RPC accepts a fragmented echo of the largest supported capture before a small answer", async () => {
  const events = [], failures = [];
  const rpc = new CodexRpc({ onNotification: (method, params) => events.push({ method, params }), onClose: error => failures.push(error.message) });
  const image = { mimeType: "image/png", data: "A".repeat(8 * 1024 * 1024) };
  prepareRequest(request({ image }));
  const echo = JSON.stringify({ method: "item/started", params: { threadId: "synthetic", item: { type: "userMessage", content: [{ type: "image", url: `data:${image.mimeType};base64,${image.data}` }] } } }) + "\n";
  for (let offset = 0; offset < echo.length; offset += 65536) rpc.receive(echo.slice(offset, offset + 65536));
  rpc.receive(JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "small answer" } }) + "\n");
  assert.deepEqual(failures, []);
  assert.equal(events.length, 2);
  assert.equal(events[0].params.item.content[0].url.length, image.data.length + "data:image/png;base64,".length);
  assert.equal(events[1].params.delta, "small answer");
  assert.equal(rpc.buffer, "");
  await rpc.close();
});

test("RPC bounds complete and unfinished protocol frames independently of image allowance", () => {
  for (const suffix of ["", "\n"]) {
    const failures = [];
    const rpc = new CodexRpc({ onClose: error => failures.push(error.message) });
    rpc.receive("x".repeat(10 * 1024 * 1024 + 1) + suffix);
    assert.equal(rpc.closed, true);
    assert.match(failures[0], /통신 메시지가 너무 큽니다/);
  }
});

test("RPC applies its bound to each frame rather than an aggregate stream chunk", async () => {
  let received = 0;
  const failures = [];
  const rpc = new CodexRpc({ onNotification: () => { received++; }, onClose: error => failures.push(error.message) });
  const frame = JSON.stringify({ method: "fixture/event", params: { text: "x".repeat(1024) } }) + "\n";
  rpc.receive(frame.repeat(11000));
  assert.deepEqual(failures, []);
  assert.equal(received, 11000);
  await rpc.close();
});
