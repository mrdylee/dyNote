// Real native Copilot SDK tool dispatch with synthetic auth/model/generation.
// Isolated home/profile, no keychain, account inference or external MCP service.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { CopilotController } from "../electron/copilot-controller.mjs";

const require = createRequire(import.meta.url), platform = `${process.platform}-${process.arch}`;
const packageRoot = path.dirname(require.resolve(`@github/copilot-sdk-${platform}/package.json`));
const runtimePath = path.join(packageRoot, "prebuilds", platform, process.platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime");
const root = await mkdtemp(path.join(tmpdir(), "dynote-copilot-extensions-"));
const home = path.join(root, "home"), workspace = path.join(root, "workspace"), skillDirectory = path.join(root, "selected-skills");
const reportPath = path.resolve("output/verification/copilot-extensions.json");
const report = { actualNativeSession: true, nativeTransport: "stdio", realAccount: false, paidInference: false, keychainDisabled: true, modelTransport: "Synthetic auth/model/generation; real production controller and native SDK tool dispatch", checks: [], events: [], permissions: [] };
for (const directory of [home, workspace, path.join(skillDirectory, "fixture-skill"), path.join(home, ".agents", "skills", "ambient-sentinel"), path.join(home, ".copilot", "skills", "ambient-sentinel")]) await mkdir(directory, { recursive: true });
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(path.join(skillDirectory, "fixture-skill", "SKILL.md"), "---\nname: fixture-skill\ndescription: Public selected skill fixture\n---\nPUBLIC_SKILL_FIXTURE\nRead references.md for details.");
await writeFile(path.join(skillDirectory, "fixture-skill", "references.md"), "PUBLIC_SKILL_RESOURCE");
for (const directory of [".agents", ".copilot"]) await writeFile(path.join(home, directory, "skills", "ambient-sentinel", "SKILL.md"), "---\nname: ambient-sentinel\ndescription: Must not be discovered\n---\nUnselected fixture skill.");
const original = "PUBLIC_NOTE_FIXTURE", notePath = path.join(workspace, "Public.md");
await writeFile(notePath, original);
const serverPath = path.join(root, "mcp.mjs");
await writeFile(serverPath, `import {createInterface} from 'node:readline';for await(const line of createInterface({input:process.stdin})){let request;try{request=JSON.parse(line)}catch{continue}if(request.id===undefined)continue;let result;if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};else if(request.method==='tools/list')result={tools:[{name:'echo',description:'Public fixture echo',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};else if(request.method==='tools/call')result={content:[{type:'text',text:'PUBLIC_MCP_FIXTURE '+request.params.arguments.text}]};else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n')}`);
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: runtimePath }), mode: "empty",
  baseDirectory: path.join(root, "runtime"), workingDirectory: workspace, enableRemoteSessions: false,
  env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) }, logLevel: "error",
});
assert.equal(client.buildRuntimeEnv().COPILOT_DISABLE_KEYTAR, "1");
// No real account/auth/model backend is contacted; the native tool bridge remains real.
client.getAuthStatus = async () => ({ isAuthenticated: true });
client.listModels = async () => [{ id: "fixture-model", capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low"] }];
const createSession = client.createSession.bind(client);
client.createSession = async options => {
  assert.equal(options.reasoningEffort, "low");
  const permission = options.onPermissionRequest;
  const session = await createSession({ ...options, onPermissionRequest(request, invocation) {
    report.permissions.push({ kind: request.kind, serverName: request.serverName, toolName: request.toolName });
    return permission(request, invocation);
  } });
  session.sendAndWait = async () => {
    await session.rpc.tools.initializeAndValidate();
    report.tools = (await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name).sort();
    assert.deepEqual(report.tools, ["dynote_create_note", "dynote_edit_note", "dynote_list_skills", "dynote_read_note", "dynote_search_notes", "dynote_use_skill", "fixture-echo", "skill"].sort());
    const catalog = await session.rpc.skills.list();
    assert.deepEqual(catalog.skills.map(skill => skill.name), ["fixture-skill"]);
    const configured = await session.rpc.mcp.listConfigured();
    assert.deepEqual(configured.servers.map(server => server.name), ["fixture"]);
    report.checks.push("Exact native tool catalog preserves four note tools, selected MCP, native skill and bounded resource bridge; ambient sentinel is absent");
    const invoke = (name, args) => session.rpc.tools.execute({ name, arguments: args });
    const mcp = await invoke("fixture-echo", { text: "controller" });
    assert.match(JSON.stringify(mcp), /PUBLIC_MCP_FIXTURE controller/);
    assert.ok(report.permissions.some(permission => permission.kind === "mcp" && permission.serverName === "fixture"));
    const skill = await invoke("skill", { skill: "fixture-skill" });
    assert.match(JSON.stringify(skill), /PUBLIC_SKILL_FIXTURE/);
    assert.deepEqual((await session.rpc.skills.getInvoked()).skills.map(skill => skill.name), ["fixture-skill"]);
    assert.match(JSON.stringify(await invoke("dynote_list_skills", {})), /fixture-skill/);
    assert.match(JSON.stringify(await invoke("dynote_use_skill", { name: "fixture-skill", resource: "references.md" })), /PUBLIC_SKILL_RESOURCE/);
    assert.equal((await invoke("dynote_use_skill", { name: "fixture-skill", resource: "../outside.md" })).resultType, "failure");
    report.checks.push("Scoped MCP permission dispatch, native skill invocation, selected resource reads and traversal denial work through the native SDK");
    await invoke("dynote_read_note", { path: "Public.md" });
    await invoke("dynote_edit_note", { path: "Public.md", operation: "append", content: "\nPending draft" });
    return { data: { content: "Controlled native extension fixture complete" } };
  };
  return session;
};
const controller = new CopilotController({
  directory: path.join(root, "controller"), createClient: async () => client,
  getExtensions: async () => ({ mcpServers: { fixture: { type: "local", command: process.execPath, args: [serverPath], tools: ["echo"] } }, skillDirectories: [skillDirectory] }),
  onEvent: event => report.events.push(event), openExternal() { throw new Error("No login permitted"); },
});
try {
  controller.send({ requestId: "native-extension-probe", vaultId: "fixture", model: "fixture-model", mode: "agent", reasoningEffort: "low", prompt: "Controlled fixture", context: { kind: "document", path: "Public.md", content: original }, history: [] });
  await controller.settled();
  assert.equal(report.events.at(-1).type, "done", JSON.stringify(report.events));
  assert.equal(report.events.find(event => event.type === "proposal")?.proposal.content, `${original}\nPending draft`);
  assert.equal(await readFile(notePath, "utf8"), original);
  report.runtime = await client.getStatus();
  report.checks.push("Selected effort reaches native session; note edit remains a pending proposal and the source file stays byte-for-byte unchanged");
  report.verified = true;
} catch (error) { report.failure = error.message; throw error; }
finally {
  await controller.close();
  await rm(root, { recursive: true, force: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify({ verified: report.verified, runtime: report.runtime, tools: report.tools, checks: report.checks, paidInference: false, keychainDisabled: true, reportPath }, null, 2));
