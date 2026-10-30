import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ClaudeController, claudeEnvironment, claudeArguments, claudeCandidates } from "../electron/claude-controller.mjs";

const request = (extra = {}) => ({ requestId: "req-1", vaultId: "v1", model: "sonnet", mode: "edit", prompt: "다듬어 줘", context: { kind: "document", path: "Note.md", content: "원본" }, references: [{ path: "Ref.md", content: "참고" }], history: [], ...extra });
function fixture({ auth = true, loginExit = 0 } = {}) {
  const calls = [], events = [];
  const spawnProcess = (_command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit("close", null, "SIGTERM")); return true; };
    const call = { args, options, child, input: "" }; calls.push(call);
    child.stdin.on("data", chunk => { call.input += chunk; });
    queueMicrotask(() => {
      if (args.includes("--version")) { child.stdout.write("2.1.314 (Claude Code)\n"); child.emit("close", 0); }
      if (args.includes("status")) { child.stdout.write(JSON.stringify({ loggedIn: auth, authMethod: auth ? "claude.ai" : "none", email: "user@example.test", accessToken: "private-token" })); child.emit("close", auth ? 0 : 1); }
      if (args.includes("login")) child.emit("close", loginExit);
    });
    return child;
  };
  const controller = new ClaudeController({ directory: "/tmp/dynote-claude-test", onEvent: event => events.push(event), resolveCli: async () => ({ command: "mock", args: [] }), spawnProcess });
  return { controller, calls, events };
}
async function waitFor(f, predicate) {
  for (let i = 0; i < 100; i++) { const found = f.calls.find(predicate); if (found) return found; await new Promise(r => setTimeout(r, 5)); }
  throw new Error("Expected subprocess did not start");
}

test("Claude status strips credentials and offers explicit model aliases", async () => {
  const f = fixture(); const status = await f.controller.status();
  assert.equal(status.authenticated, true); assert.equal(status.login, "user@example.test");
  assert.deepEqual(status.models.map(m => m.id), ["sonnet", "opus", "haiku"]);
  assert.ok(!JSON.stringify(status).includes("private-token")); await f.controller.close();
});
test("Claude streams bounded text, sends references through stdin, and completes only on successful exit", async () => {
  const f = fixture(); f.controller.send(request());
  const call = await waitFor(f, c => c.args.includes("--print"));
  assert.equal(JSON.parse(call.input).references[0].content, "참고");
  assert.ok(!call.args.includes("원본"));
  const emit = x => call.child.stdout.write(JSON.stringify(x) + "\n");
  emit({ type: "system", subtype: "init", tools: [] });
  emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "수정안" } } });
  assert.equal(f.events.at(-1).type, "delta");
  emit({ type: "result", subtype: "success", result: "수정안" });
  assert.notEqual(f.events.at(-1).type, "done"); call.child.emit("close", 0);
  await f.controller.settled(); assert.equal(f.events.at(-1).content, "수정안"); assert.equal(f.events.at(-1).type, "done");
  await f.controller.close();
});
test("Claude cancellation is terminal and does not publish partial edits", async () => {
  const f = fixture(); f.controller.send(request());
  await waitFor(f, c => c.args.includes("--print")); await f.controller.cancel("req-1"); await f.controller.settled();
  assert.equal(f.events.at(-1).type, "canceled"); assert.ok(!f.events.some(e => e.type === "done")); await f.controller.close();
});
test("Claude rejects unsupported modes and fails closed if runtime exposes tools or malformed output", async () => {
  const f = fixture(); assert.throws(() => f.controller.send(request({ mode: "agent" })), /Ask.*Edit/);
  for (const data of ['not-json\n', JSON.stringify({ type: "system", subtype: "init", tools: ["Bash"] }) + "\n"]) {
    const g = fixture(); g.controller.send(request()); const call = await waitFor(g, c => c.args.includes("--print"));
    call.child.stdout.write(data); await g.controller.settled(); assert.equal(g.events.at(-1).type, "error"); await g.controller.close();
  }
});
test("Claude requires account login before inference and reports login failure", async () => {
  const f = fixture({ auth: false, loginExit: 1 }); f.controller.send(request()); await f.controller.settled();
  assert.equal(f.events.at(-1).type, "error"); assert.ok(!f.calls.some(c => c.args.includes("--print")));
  await f.controller.login(); await f.controller.loginJob?.promise;
  assert.equal(f.events.at(-1).phase, "error"); await f.controller.close();
});
test("Claude environment and arguments isolate configuration, tools, hooks and credentials", () => {
  const env = claudeEnvironment("/app/claude", { HOME: "/home/u", PATH: "/bin", ANTHROPIC_API_KEY: "private", CLAUDE_CODE_OAUTH_TOKEN: "private", NODE_OPTIONS: "bad" });
  assert.equal(env.CLAUDE_CONFIG_DIR, "/app/claude"); assert.equal(env.ANTHROPIC_API_KEY, undefined); assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(claudeEnvironment("C:\\app", { Path: "C:\\Program Files\\Git\\bin", SystemRoot: "C:\\Windows" }).Path, "C:\\Program Files\\Git\\bin");
  const args = claudeArguments(request());
  for (const flag of ["--tools", "--setting-sources"]) assert.equal(args[args.indexOf(flag) + 1], "");
  assert.ok(args.includes("--strict-mcp-config")); assert.ok(args.includes("--no-session-persistence"));
  assert.equal(JSON.parse(args[args.indexOf("--settings") + 1]).disableAllHooks, true);
});
test("Windows discovery includes native and npm installations without executing cmd shims", () => {
  const candidates = claudeCandidates({ platform: "win32", home: "C:\\Users\\A", env: { APPDATA: "C:\\Users\\A\\AppData\\Roaming", PATH: "C:\\Program Files\\nodejs" } });
  assert.ok(candidates.some(p => p.endsWith(".local\\bin\\claude.exe")));
  assert.ok(candidates.some(p => p.endsWith("npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js")));
  assert.ok(!candidates.some(p => p.endsWith(".cmd")));
  assert.ok(claudeCandidates({ platform: "win32", home: "C:\\Users\\A", env: { PATH: "C:\\npm" } }).includes("C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"));
});
