// Actual installed Codex app-server and its tool dispatch, against local public
// fixtures only. No account credentials or paid inference are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexController } from "../electron/codex-controller.mjs";
import { CodexRpc } from "../electron/codex-rpc.mjs";

const root = await mkdtemp(path.join(tmpdir(), "dynote-codex-agent-tools-"));
const directory = path.join(root, "codex"), skills = path.join(root, "skills"), skill = path.join(skills, "fixture-skill");
const mcp = path.join(root, "mcp.mjs"), mcpCalls = path.join(root, "mcp-calls.jsonl");
await mkdir(path.join(skill, "references"), { recursive: true });
await writeFile(path.join(skill, "SKILL.md"), "---\nname: fixture-skill\ndescription: Public native-tool fixture\n---\nPUBLIC_SKILL_INSTRUCTIONS\nRead references/detail.md when needed.\n");
await writeFile(path.join(skill, "references", "detail.md"), "PUBLIC_SKILL_RESOURCE\n");
await writeFile(mcp, `import {createInterface} from 'node:readline';
import {appendFile} from 'node:fs/promises';
for await(const line of createInterface({input:process.stdin})){
 let request;try{request=JSON.parse(line)}catch{continue}if(request.id===undefined)continue;
 let result;if(request.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(request.method==='tools/list')result={tools:[{name:'echo',description:'Echo public fixture text',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};
 else if(request.method==='tools/call'){await appendFile(process.argv[2],JSON.stringify(request.params)+'\\n');result={content:[{type:'text',text:'PUBLIC_MCP_RESULT '+request.params.arguments.text}]};}
 else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
}`);

const calls = [], events = [], failures = [], transport = [], serverRequests = [];
const plan = [
  { name: "dynote_read_note", args: { path: "Synthetic.md" } },
  { name: "dynote_edit_note", args: { path: "Synthetic.md", operation: "append", content: "\nPUBLIC_PENDING_DRAFT" }, expect: "PUBLIC_ORIGINAL_NOTE" },
  { name: "dynote_list_skills", args: {}, expect: "previewing_in_editor" },
  { name: "dynote_use_skill", args: { name: "fixture-skill" }, expect: "fixture-skill" },
  { name: "dynote_use_skill", args: { name: "fixture-skill", resource: "references/detail.md" }, expect: "PUBLIC_SKILL_INSTRUCTIONS" },
  { name: "echo", namespace: "mcp__fixture", args: { text: "PUBLIC_ECHO_INPUT" }, expect: "PUBLIC_SKILL_RESOURCE" },
];
let phase = "agent", step = 0;
const message = text => ({ id: `message-${calls.length}`, type: "message", status: "completed", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text, annotations: [] }] });
const server = createServer(async (request, response) => {
  const chunks = [];
  try { for await (const chunk of request) chunks.push(chunk); }
  catch (error) { if (error.code === "ECONNRESET") return; throw error; }
  let item;
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ phase, body });
    if (phase === "agent") {
      assert.equal(body.reasoning?.effort, "low");
      const next = plan[step];
      if (next?.expect) assert.ok(JSON.stringify(body.input).includes(next.expect), `Missing tool result before step ${step}: ${next.expect}`);
      if (next) {
        const offered = next.namespace ? body.tools.find(tool => tool.name === next.namespace)?.tools : body.tools;
        assert.ok(offered?.some(tool => tool.name === next.name), `Tool not offered: ${next.namespace ?? ""}/${next.name}`);
        item = { id: `function-${step}`, type: "function_call", status: "completed", call_id: `call-${step}`, name: next.name,
          ...(next.namespace ? { namespace: next.namespace } : {}), arguments: JSON.stringify(next.args) };
        step++;
      } else {
        assert.ok(JSON.stringify(body.input).includes("PUBLIC_MCP_RESULT PUBLIC_ECHO_INPUT"));
        item = message("PUBLIC_AGENT_DONE");
      }
    } else {
      assert.ok(!(body.tools ?? []).some(tool => /dynote_|mcp|shell|exec|patch|file|skill|browser|computer/.test(JSON.stringify(tool))), "Ask exposed active tools");
      item = message("PUBLIC_ASK_DONE");
    }
  } catch (error) { failures.push(error.message); item = message("PUBLIC_FIXTURE_FAILURE"); }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const event of [
    { type: "response.created", response: { id: `response-${calls.length}`, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", ...(item.type === "function_call" ? { arguments: "" } : { content: [] }) } },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: `response-${calls.length}`, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
  ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const controller = new CodexController({
  directory, onEvent: event => events.push(event), openExternal() { throw new Error("No login is allowed."); },
  getNotes() { throw new Error("Only the supplied synthetic context may be read."); },
  getExtensions: async () => ({ skillDirectories: [skills], mcpServers: { fixture: { type: "local", command: process.execPath, args: [mcp, mcpCalls], tools: ["echo"] } } }),
  createRpc: options => {
    const rpc = new CodexRpc({ ...options,
      onNotification(method, params) { transport.push({ method, type: params.item?.type }); options.onNotification(method, params); },
      spawnProcess: (command, args, spawnOptions) => spawn(command, [...args,
        "-c", 'model_provider="fixture"', "-c", `model_providers.fixture={name="Fixture",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
      ], spawnOptions),
    });
    const request = rpc.request.bind(rpc);
    const receive = rpc.receive.bind(rpc); let buffer = "";
    rpc.receive = chunk => {
      buffer += chunk;
      let end; while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (line.trim()) { const message = JSON.parse(line); if (message.method && message.id != null) serverRequests.push(message); }
      }
      receive(chunk);
    };
    rpc.request = (method, params) => request(method, method === "thread/start" ? { ...params, modelProvider: "fixture" } : params);
    return rpc;
  },
});
controller.status = async () => ({ authenticated: true, models: [{ id: "fixture-model", vision: false, reasoningEfforts: ["low"] }] });
let timer;
try {
  const rpc = await controller.client();
  assert.equal((await rpc.request("account/read", { refreshToken: false })).account, null);
  const args = { requestId: "agent-fixture", vaultId: "public-fixture-vault", model: "fixture-model", mode: "agent", reasoningEffort: "low", prompt: "Use public fixture tools, then reply.", context: { kind: "document", path: "Synthetic.md", content: "PUBLIC_ORIGINAL_NOTE" }, history: [], references: [] };
  controller.send(args);
  await Promise.race([controller.settled(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native Codex Agent fixture timeout")), 45000); })]);
  clearTimeout(timer);
  assert.deepEqual(failures, []);
  assert.equal(step, plan.length);
  assert.equal(events.at(-1).type, "done"); assert.equal(events.at(-1).content, "PUBLIC_AGENT_DONE");
  const proposal = events.find(event => event.type === "proposal")?.proposal;
  assert.equal(proposal?.content, "PUBLIC_ORIGINAL_NOTE\nPUBLIC_PENDING_DRAFT");
  assert.equal(proposal.target.before, "PUBLIC_ORIGINAL_NOTE");
  const mcpExecuted = (await readFile(mcpCalls, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(mcpExecuted.map(({ name, arguments: args }) => ({ name, arguments: args })), [{ name: "echo", arguments: { text: "PUBLIC_ECHO_INPUT" } }]);
  assert.ok(transport.some(event => event.type === "dynamicToolCall"));
  assert.ok(events.some(event => event.type === "tool" && event.message.includes("MCP")));
  phase = "ask";
  controller.send({ ...args, requestId: "ask-fixture", mode: "chat" });
  await Promise.race([controller.settled(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native Codex Ask fixture timeout")), 20000); })]);
  clearTimeout(timer);
  assert.deepEqual(failures, []); assert.equal(events.at(-1).content, "PUBLIC_ASK_DONE");
  const report = { nativeRuntime: true, loopbackOnly: true, realAccount: false, paidInference: false, checks: [
    "Controller reasoning low reaches the actual native backend request",
    "Native read_note then edit_note dispatch stages the exact pending draft without saving",
    "Native skill catalog, SKILL.md and relative text resource reach subsequent backend turns",
    "Selected synthetic MCP server executes echo through the native namespace and returns its marker",
    "Ask exposes no Dynote note/skill, MCP or environment tools after the Agent turn",
  ], agentBackendRequests: calls.filter(call => call.phase === "agent").length, askToolNames: calls.find(call => call.phase === "ask").body.tools.map(tool => tool.name ?? tool.type) };
  await mkdir("output/verification", { recursive: true });
  await writeFile("output/verification/codex-agent-tools.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await mkdir("output/verification", { recursive: true });
  await writeFile("output/verification/codex-agent-tools-failure.json", JSON.stringify({ error: error.message, calls, events, transport, serverRequests }, null, 2));
  throw error;
} finally {
  clearTimeout(timer); await controller.cancel(); await controller.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true });
}
