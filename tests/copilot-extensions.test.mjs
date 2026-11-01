import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CopilotController } from "../electron/copilot-controller.mjs";

const request = extra => ({ requestId: "extension-probe", vaultId: "fixture-vault", model: "fixture-model", mode: "agent", prompt: "Use the configured tools", context: { kind: "document", path: "Public.md", content: "Public fixture" }, history: [], ...extra });
const skillDirectory = mkdtempSync(path.join(tmpdir(), "dynote-copilot-skills-unit-"));
mkdirSync(path.join(skillDirectory, "fixture-skill"));
writeFileSync(path.join(skillDirectory, "fixture-skill", "SKILL.md"), "---\nname: fixture-skill\ndescription: Public skill fixture\n---\nUse references.md for more details.");
writeFileSync(path.join(skillDirectory, "fixture-skill", "references.md"), "PUBLIC_SKILL_RESOURCE");
after(() => rmSync(skillDirectory, { recursive: true, force: true }));
const extensions = { mcpServers: { selected: { type: "local", command: "fixture-node", args: ["server.mjs"], cwd: "/fixture", tools: ["echo"] } }, skillDirectories: [skillDirectory] };

function fixture({ getExtensions = async () => extensions, respond } = {}) {
  const events = [], options = []; let handler;
  const session = {
    sessionId: "fixture-session", rpc: { options: { update: async () => {} } },
    on(callback) { handler = callback; return () => {}; }, async abort() {},
    async sendAndWait() { await respond?.(options.at(-1), event => handler(event)); return { data: { content: "Completed fixture" } }; },
  };
  const client = {
    async start() {}, async stop() {}, async getAuthStatus() { return { isAuthenticated: true }; },
    async listModels() { return [{ id: "fixture-model" }]; },
    async createSession(config) { options.push(config); return session; }, async deleteSession() {},
  };
  const controller = new CopilotController({ directory: "/tmp/dynote-extensions-unit", createClient: async () => client, getExtensions, onEvent: event => events.push(event), openExternal() {} });
  return { controller, events, options };
}

test("Copilot Agent adds explicitly configured MCP and skill tools beside its note tools", async () => {
  const f = fixture();
  try {
    f.controller.send(request()); await f.controller.settled();
    const options = f.options[0];
    assert.ok(options.availableTools.includes("mcp:*"));
    assert.ok(options.availableTools.includes("builtin:skill"));
    assert.ok(options.availableTools.includes("dynote_edit_note"));
    assert.ok(options.availableTools.includes("dynote_list_skills"));
    assert.ok(options.availableTools.includes("dynote_use_skill"));
    assert.deepEqual(options.skillDirectories, [skillDirectory]);
    assert.equal(options.enableSkills, true);
    assert.equal(options.mcpServers.selected.workingDirectory, "/fixture");
    assert.equal(options.enableConfigDiscovery, false);
    assert.match(options.systemMessage.content, /configured MCP tools and skills/);
    assert.ok(!options.systemMessage.content.includes("Use only the Dynote tools"));
    assert.match(options.systemMessage.content, /Keep or Undo/);
  } finally { await f.controller.close(); }
});

test("Copilot skill bridge reads selected relative resources while retaining note scope", async () => {
  const f = fixture({ respond: async options => {
    const invoke = options.tools.find(tool => tool.name === "dynote_use_skill");
    assert.ok(invoke);
    const result = await invoke.handler({ name: "fixture-skill", resource: "references.md" });
    assert.match(JSON.stringify(result), /PUBLIC_SKILL_RESOURCE/);
    const traversal = await invoke.handler({ name: "fixture-skill", resource: "../outside.md" });
    assert.equal(traversal.resultType, "failure");
  } });
  try { f.controller.send(request()); await f.controller.settled(); assert.equal(f.events.at(-1).type, "done"); }
  finally { await f.controller.close(); }
});

test("Copilot Ask and Edit do not load Agent extensions", async () => {
  for (const mode of ["chat", "edit"]) {
    const f = fixture({ getExtensions: async () => { throw new Error("Must not load extensions"); } });
    try {
      f.controller.send(request({ mode })); await f.controller.settled();
      assert.equal(f.events.at(-1).type, "done");
      assert.deepEqual(f.options[0].mcpServers, {});
      assert.equal(f.options[0].enableSkills, false);
    } finally { await f.controller.close(); }
  }
});

test("Copilot extension permission grants match a selected server/tool and honor cancellation and managed policy", async () => {
  const f = fixture({ respond: async options => {
    const permission = options.onPermissionRequest;
    assert.deepEqual(permission({ kind: "mcp", serverName: "selected", toolName: "selected-echo" }), { kind: "approve-once" });
    for (const bad of [
      { kind: "mcp", serverName: "unknown", toolName: "unknown-echo" },
      { kind: "mcp", serverName: "selected", toolName: "selected-delete" },
      { kind: "mcp", serverName: "selected", toolName: "selected-echo", managedApprovalRequired: true },
      { kind: "shell", serverName: "selected", toolName: "selected-echo" },
    ]) assert.deepEqual(permission(bad), { kind: "reject" });
    assert.deepEqual(permission({ kind: "mcp", serverName: "selected", toolName: "selected-echo" }, { promptRequest: { managedApprovalRequired: true } }), { kind: "reject" });
    await f.controller.cancel("extension-probe");
    assert.deepEqual(permission({ kind: "mcp", serverName: "selected", toolName: "selected-echo" }), { kind: "reject" });
  } });
  try { f.controller.send(request()); await f.controller.settled(); assert.equal(f.events.at(-1).type, "canceled"); }
  finally { await f.controller.close(); }
});

test("Copilot reports extension tool progress without forwarding tool arguments", async () => {
  const f = fixture({ respond: async (_options, emit) => {
    emit({ type: "tool.execution_start", data: { toolCallId: "mcp-1", toolName: "selected-echo", arguments: { secret: "not-in-progress" } } });
    emit({ type: "tool.execution_complete", data: { toolCallId: "mcp-1", success: true } });
    emit({ type: "tool.execution_start", data: { toolCallId: "skill-1", toolName: "skill" } });
    emit({ type: "tool.execution_complete", data: { toolCallId: "skill-1", success: false } });
  } });
  try {
    f.controller.send(request()); await f.controller.settled();
    const progress = f.events.filter(event => event.type === "tool");
    assert.equal(progress.length, 4);
    assert.match(progress[0].message, /selected-echo/);
    assert.match(progress[3].message, /실패/);
    assert.ok(!JSON.stringify(progress).includes("not-in-progress"));
  } finally { await f.controller.close(); }
});

test("Copilot cancellation during extension loading does not start a session", async () => {
  let finish;
  const f = fixture({ getExtensions: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.controller.send(request());
    for (let i = 0; i < 20 && !finish; i++) await new Promise(setImmediate);
    assert.ok(finish, "Agent must load selected extensions");
    await f.controller.cancel("extension-probe"); finish(extensions); await f.controller.settled();
    assert.equal(f.options.length, 0); assert.equal(f.events.at(-1).type, "canceled");
  } finally { await f.controller.close(); }
});
