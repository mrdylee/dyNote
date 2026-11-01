// Exercise the installed native Codex runtime against a local fixture. No
// personal credentials, vault files, or paid model requests are involved.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { CodexRpc } from "../electron/codex-rpc.mjs";
import { safeCodexLoginUrl } from "../electron/codex-controller.mjs";

const directory = await mkdtemp(`${tmpdir()}/dynote-codex-protocol-`);
const report = { liveAccountLoginVerified: false, liveModelResponseVerified: false, checks: [] };
const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  try { for await (const chunk of req) chunks.push(chunk); }
  catch (error) { if (error.code === "ECONNRESET") return; throw error; }
  const body = Buffer.concat(chunks).toString();
  requests.push(JSON.parse(body));
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const item = { id: "fixture-message", type: "message", status: "completed", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "검증 응답", annotations: [] }] };
  for (const event of [
    { type: "response.created", response: { id: "fixture-response", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: "검증 응답" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "fixture-response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
  ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const events = [];
let finish;
let completed = new Promise((resolve) => { finish = resolve; });
const rpc = new CodexRpc({
  directory,
  spawnProcess: (command, args, options) => spawn(command, [...args,
    "-c", 'model_provider="fixture"',
    "-c", `model_providers.fixture={name="Fixture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
  ], options),
  onNotification: (method, params) => {
    events.push({ method, params });
    if (method === "turn/completed") finish(params);
  },
  onClose: error => finish?.({ transportError: error.message }),
});
let timeout;
try {
  await rpc.start();
  const status = await rpc.request("account/read", { refreshToken: false });
  assert.equal(status.account, null);
  report.checks.push("Native CLI starts with isolated app home and no existing account");
  const login = await rpc.request("account/login/start", { type: "chatgpt" });
  safeCodexLoginUrl(login.authUrl);
  await rpc.request("account/login/cancel", { loginId: login.loginId });
  report.checks.push("Native browser login URL passes allowlist; flow canceled without opening browser");
  const { thread } = await rpc.request("thread/start", {
    model: "fixture-model", modelProvider: "fixture",
    cwd: `${directory}/workspace`, ephemeral: true,
    environments: [], dynamicTools: [], sandbox: "read-only", approvalPolicy: "untrusted",
    baseInstructions: "Reply with the requested text without tools.", developerInstructions: "Use only the supplied text.",
  });
  assert.equal(thread.ephemeral, true);
  await rpc.request("turn/start", { threadId: thread.id, environments: [], input: [{ type: "text", text: "검증 응답", text_elements: [] }] });
  const result = await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Native fixture timeout")), 20000); })]);
  assert.equal(result.turn.status, "completed", JSON.stringify(result.turn.error));
  assert.equal(requests.length, 1);
  const tools = requests[0].tools ?? [];
  report.modelVisibleTools = tools.map((tool) => tool.name ?? tool.type);
  // Plan/context utilities may remain; environment, connector and hosted tools must not.
  const forbidden = /shell|exec|patch|file|image|browser|search|mcp|agent|skill|plugin|computer|code_mode/;
  assert.ok(!tools.some((tool) => forbidden.test(JSON.stringify(tool))), JSON.stringify(report.modelVisibleTools));
  assert.ok(!JSON.stringify(requests[0]).includes("/.agents/"));
  assert.ok(events.some((e) => e.method === "item/agentMessage/delta" && e.params.delta === "검증 응답"));
  report.checks.push("Ephemeral no-environment thread reaches only the local fixture backend");
  report.checks.push("Actual native runtime exposes no file, shell, browser, connector or agent tools");
  report.checks.push("Native streaming and successful turn completion confirmed with synthetic answer");
  // Deterministic noisy RGB pixels keep this valid PNG above the old 2 MiB
  // RPC frame limit while remaining inside Dynote's supported image bound.
  const pngChunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const width = 1200, height = 900, pixels = Buffer.alloc((width * 3 + 1) * height); let seed = 42;
  for (let y = 0; y < height; y++) for (let x = 1; x <= width * 3; x++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[y * (width * 3 + 1) + x] = seed >>> 24; }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const image = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
  const data = image.toString("base64"); assert.ok(data.length > 2 * 1024 * 1024 && data.length < 8 * 1024 * 1024);
  completed = new Promise(resolve => { finish = resolve; });
  await rpc.request("turn/start", { threadId: thread.id, environments: [], input: [{ type: "text", text: "Describe this synthetic image", text_elements: [] }, { type: "image", url: `data:image/png;base64,${data}` }] });
  clearTimeout(timeout);
  const imageResult = await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Native image fixture timeout")), 20000); })]);
  assert.equal(imageResult.transportError, undefined);
  assert.equal(imageResult.turn.status, "completed", JSON.stringify(imageResult.turn.error));
  assert.ok(events.some(event => event.params.item?.type === "userMessage" && event.params.item.content.some(input => input.type === "image" && input.url?.length > 2 * 1024 * 1024)));
  assert.ok(JSON.stringify(requests.at(-1)).includes("data:image/png;base64,"));
  report.checks.push("Native large-image echo does not count as model output or overflow the RPC frame");
  report.syntheticImageBytes = image.length;
  await rpc.request("thread/unsubscribe", { threadId: thread.id });
  await mkdir("output/verification", { recursive: true });
  await writeFile("output/verification/codex-protocol.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  await rpc.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
