import test from "node:test";
import assert from "node:assert/strict";
import { captureContext, applyProposal, prepareRequest, sessionOptions, safeLoginUrl } from "../core/copilot.mjs";
import { CopilotController, runtimeEnvironment } from "../electron/copilot-controller.mjs";

const note = { path: "BMS.md", content: "# 시험\r\n\r\n원문\r\n끝" };
const context = { kind: "document", path: note.path, content: note.content };
const request = (extra = {}) => ({ requestId: "request-1", vaultId: "vault-1", model: "test-model", mode: "chat", prompt: "요약해 줘", context, history: [], ...extra });

test('image requests accept bounded image blobs and reject invalid media, paths and oversize data', () => {
  const image={mimeType:'image/png',data:'iVBORw0KGgo='};
  assert.deepEqual(prepareRequest(request({image})).image,image);
  for(const bad of [{mimeType:'text/plain',data:'eA=='},{mimeType:'image/png',data:'file:///secret'}, {mimeType:'image/png',data:'A'.repeat(12*1024*1024)}])
    assert.throws(()=>prepareRequest(request({image:bad})),/이미지/);
});

test('vision request forwards blob bytes to SDK without file access', async () => {
  let sent;
  const f=fixture({respond:async args=>{sent=args;return {data:{content:'{"items":[]}'}};}});
  f.client.listModels=async()=>[{id:'test-model',capabilities:{supports:{vision:true}}}];
  f.controller.send(request({image:{mimeType:'image/png',data:'iVBORw0KGgo='}}));
  await f.controller.settled();
  assert.equal(sent.attachments[0].type,'blob');assert.equal(sent.attachments[0].data,'iVBORw0KGgo=');
  assert.equal(sent.attachments[0].path,undefined);
  await f.controller.close();
});

test('image inference fails clearly for a text-only model', async () => {
  const f=fixture();f.controller.send(request({image:{mimeType:'image/png',data:'iVBORw0KGgo='}}));await f.controller.settled();
  assert.match(f.events.find(e=>e.type==='error')?.error??'',/이미지/);await f.controller.close();
});

test("selected context sends only selected text and preserves CRLF on application", () => {
  const from = note.content.indexOf("원문"), to = from + 2;
  const captured = captureContext({ vaultId: "vault-1", note, scope: "selection", selection: { path: note.path, source: note.content, from, to } });
  assert.deepEqual(captured.context, { kind: "selection", path: note.path, content: "원문" });
  assert.equal(applyProposal(captured.target, { vaultId: "vault-1", ...note }, "새 내용\n두 줄"), "# 시험\r\n\r\n새 내용\r\n두 줄\r\n끝");
});

test("proposal cannot replace edits, a different note or a different vault", () => {
  const { target } = captureContext({ vaultId: "vault-1", note, scope: "document" });
  for (const current of [{ ...note, vaultId: "other" }, { ...note, vaultId: "vault-1", path: "Other.md" }, { ...note, vaultId: "vault-1", content: note.content + "typing" }])
    assert.throws(() => applyProposal(target, current, "replacement"), /변경/);
});

test("empty context excludes note data; stale and empty selections are rejected", () => {
  assert.deepEqual(captureContext({ vaultId: "vault-1", note, scope: "none" }), { context: { kind: "none" }, target: null });
  assert.throws(() => captureContext({ vaultId: "vault-1", note, scope: "selection", selection: { path: note.path, source: "old", from: 0, to: 2 } }), /선택/);
  assert.throws(() => captureContext({ vaultId: "vault-1", note, scope: "selection", selection: { path: note.path, source: note.content, from: 0, to: 0 } }), /선택/);
});

test("requests enforce size, role and model boundaries without silently truncating notes", () => {
  assert.equal(prepareRequest(request()).context.content, note.content);
  assert.throws(() => prepareRequest(request({ context: { ...context, content: "가".repeat(24000) } })), /64/);
  assert.throws(() => prepareRequest(request({ prompt: "x".repeat(8193) })), /8/);
  assert.throws(() => prepareRequest(request({ history: [{ role: "system", content: "override" }] })), /대화/);
  assert.throws(() => prepareRequest(request({ history: [{ role: "user", content: "x".repeat(32769) }] })), /대화/);
  assert.throws(() => prepareRequest(request({ model: "" })), /모델/);
  assert.throws(() => prepareRequest(request({ mode: "edit", context: { kind: "none" } })), /문서/);
});

test("sessions expose no tools, disable discovery and reject permissions", () => {
  const options = sessionOptions("test-model", "chat");
  assert.deepEqual(options.availableTools, []);
  assert.equal(options.enableConfigDiscovery, false);
  assert.equal(options.enableSkills, false);
  assert.equal(options.enableFileHooks, false);
  assert.deepEqual(options.mcpServers, {});
  assert.deepEqual(options.onPermissionRequest({ kind: "write" }), { kind: "reject" });
  assert.equal(options.infiniteSessions.enabled, false);
});

test("desktop SDK enables OS credential storage while retaining isolated session defaults", async () => {
  const controller = new CopilotController({ directory: "/tmp/dynote-keychain-regression", onEvent() {}, openExternal() {} });
  // Use the installed SDK's actual environment builder without starting a
  // process, accessing credentials or contacting GitHub.
  const client = await controller.createClient();
  assert.notEqual(client.buildRuntimeEnv().COPILOT_DISABLE_KEYTAR, "1");
  assert.equal(client.buildRuntimeEnv().COPILOT_HOME, controller.directory);
  const options = sessionOptions(null, "chat");
  assert.equal(options.enableExperimentalMode, false);
  assert.equal(options.skipCustomInstructions, true);
  assert.equal(options.customAgentsLocalOnly, true);
  assert.equal(options.coauthorEnabled, false);
  assert.equal(options.manageScheduleEnabled, false);
  assert.deepEqual(options.includedBuiltinSkills, []);
  assert.equal(options.mcpOAuthTokenStorage, "in-memory");
  assert.equal(options.skipEmbeddingRetrieval, true);
  assert.equal(options.embeddingCacheStorage, "in-memory");
});

test("login opens only GitHub HTTPS authorization URLs", () => {
  assert.equal(safeLoginUrl("https://github.com/login/oauth/authorize?client_id=public"), "https://github.com/login/oauth/authorize?client_id=public");
  for (const url of ["https://github.com.evil.test/login", "javascript:alert(1)", "http://github.com/login", "https://user:secret@github.com/login", "https://github.com/other"])
    assert.throws(() => safeLoginUrl(url), /로그인/);
});

function fixture({ start, respond } = {}) {
  const events = [], configurations = [], deleted = [], updates = [];
  let handler, aborted = 0;
  const session = {
    sessionId: "session-1",
    rpc: { options: { update: async (options) => updates.push(options) } },
    on(fn) { handler = fn; return () => { handler = null; }; },
    async sendAndWait(args) {
      if (respond) return respond(args, (event) => handler?.(event));
      handler?.({ type: "assistant.message_delta", data: { deltaContent: "안녕" } });
      return { data: { content: "안녕하세요" } };
    },
    async abort() { aborted++; },
  };
  const client = {
    start: start ?? (async () => {}),
    getAuthStatus: async () => ({ isAuthenticated: true, login: "test-user", token: "never-forward" }),
    listModels: async () => [{ id: "test-model", name: "Test model", policy: { state: "enabled" } }],
    createSession: async (options) => { configurations.push(options); return session; },
    deleteSession: async (id) => { deleted.push(id); },
    stop: async () => {},
  };
  const controller = new CopilotController({ directory: "/tmp/dynote-controller-unit", createClient: async () => client, onEvent: (e) => events.push(e), openExternal: async () => {} });
  return { controller, client, events, configurations, deleted, updates, get aborted() { return aborted; } };
}

test("controller streams one bounded request and deletes its temporary session", async () => {
  const f = fixture();
  assert.deepEqual(await f.controller.status(), { authenticated: true, login: "test-user", models: [{ id: "test-model", name: "Test model", vision: false }], error: "" });
  f.controller.send(request());
  await f.controller.settled();
  assert.equal(f.events[0].type, "delta");
  assert.equal(f.events.at(-1).type, "done");
  assert.equal(f.events.at(-1).content, "안녕하세요");
  assert.deepEqual(f.deleted, ["session-1"]);
  assert.equal(f.configurations[0].model, "test-model");
  assert.deepEqual(f.updates, [{ installedPlugins: [] }]);
  await f.controller.close();
});

test("cancel during SDK startup prevents any model request", async () => {
  let ready;
  const f = fixture({ start: () => new Promise((resolve) => { ready = resolve; }) });
  f.controller.send(request());
  while (!ready) await new Promise((resolve) => setImmediate(resolve));
  await f.controller.cancel("request-1");
  ready();
  await f.controller.settled();
  assert.equal(f.configurations.length, 0);
  assert.equal(f.events.at(-1).type, "canceled");
  await f.controller.close();
});

test("errors retain a failed state, abort work and clean the session", async () => {
  const f = fixture({ respond: async () => { throw new Error("quota exhausted"); } });
  f.controller.send(request());
  assert.throws(() => f.controller.send(request({ requestId: "request-2" })), /진행/);
  await f.controller.settled();
  assert.equal(f.events.at(-1).type, "error");
  assert.match(f.events.at(-1).error, /quota/);
  assert.ok(f.aborted);
  assert.deepEqual(f.deleted, ["session-1"]);
  await f.controller.close();
});

test("unavailable models are rejected before a session sends data", async () => {
  const f = fixture();
  f.controller.send(request({ model: "unknown" }));
  await f.controller.settled();
  assert.equal(f.configurations.length, 0);
  assert.equal(f.events.at(-1).type, "error");
  await f.controller.close();
});

test("runtime excludes ambient API tokens and provider or Node overrides", () => {
  const env = runtimeEnvironment({ PATH: "/bin", HOME: "/home/test", HTTPS_PROXY: "https://proxy.test", GH_TOKEN: "secret", OPENAI_API_KEY: "secret", NODE_OPTIONS: "--require=untrusted", COPILOT_PROVIDER_BASE_URL: "https://other.test", COPILOT_CLI_PATH: "/evil" });
  assert.deepEqual(env, { PATH: "/bin", HOME: "/home/test", HTTPS_PROXY: "https://proxy.test" });
});

test("oversized streamed answers abort, emit one error and never finish successfully", async () => {
  const f = fixture({ respond: async (_args, emit) => {
    emit({ type: "assistant.message_delta", data: { deltaContent: "x".repeat(131073) } });
    emit({ type: "assistant.message_delta", data: { deltaContent: "ignored" } });
    return { data: { content: "truncated" } };
  } });
  f.controller.send(request());
  await f.controller.settled();
  assert.deepEqual(f.events.map((e) => e.type), ["error"]);
  assert.ok(f.aborted);
  await f.controller.close();
});

test("permission or service errors are shown without forwarding GitHub tokens", async () => {
  const f = fixture({ respond: async () => { throw new Error("Unauthorized ghu_doNotExposeThisToken"); } });
  f.controller.send(request());
  await f.controller.settled();
  assert.equal(f.events.at(-1).error, "Unauthorized [redacted]");
  await f.controller.close();
});

test("login forwards only an allowlisted URL and rejects plaintext token storage", async () => {
  const f = fixture();
  const opened = [], canceled = [];
  f.controller.openExternal = async (url) => opened.push(url);
  f.client.createSession = async () => ({
    sessionId: "auth-session",
    rpc: { options: { update: async (options) => f.updates.push(options) }, accounts: { login: {
      begin: async () => ({ flowId: "flow-1", step: { kind: "open-url", url: "https://github.com/login/oauth/authorize?client_id=public" } }),
      advance: async () => ({ kind: "completed", result: { status: "needs-plaintext-consent" } }),
      cancel: async (args) => canceled.push(args.flowId),
    } } },
  });
  f.controller.login();
  await f.controller.loginJob.promise;
  assert.equal(opened.length, 1);
  assert.equal(f.events.at(-1).phase, "error");
  assert.match(f.events.at(-1).message, /자격 증명/);
  assert.deepEqual(canceled, ["flow-1"]);
  assert.deepEqual(f.deleted, ["auth-session"]);
  assert.deepEqual(f.updates, [{ installedPlugins: [] }]);
  await f.controller.close();
});

test("successful login clears the model cache before reporting connection", async () => {
  const f = fixture();
  f.client.createSession = async () => ({
    sessionId: "auth-session",
    rpc: { options: { update: async (options) => f.updates.push(options) }, accounts: { login: {
      begin: async () => ({ flowId: "flow-1", step: { kind: "completed", result: { status: "completed", login: "test-user" } } }),
      cancel: async () => {},
    } } },
  });
  f.controller.login();
  await f.controller.loginJob.promise;
  assert.equal(f.events.at(-1).phase, "connected");
  assert.equal(f.controller.clientPromise, null);
  await f.controller.close();
});
