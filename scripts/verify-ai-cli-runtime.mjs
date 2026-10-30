// Installed native runtimes, isolated profiles; Claude inference uses a loopback fixture only.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexController } from "../electron/codex-controller.mjs";
import { ClaudeController, claudeArguments } from "../electron/claude-controller.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "dynote-ai-cli-"));
const codex = new CodexController({ directory: path.join(root, "codex"), onEvent() {}, openExternal() {} });
const claude = new ClaudeController({ directory: path.join(root, "claude"), onEvent() {}, ...(process.env.DYNOTE_TEST_CLAUDE ? { resolveCli: async () => ({ command: process.env.DYNOTE_TEST_CLAUDE, args: [] }) } : {}) });
let server;
try {
  for (const controller of [codex, claude]) assert.equal((await controller.status()).authenticated, false);
  const cli = await claude.client(), requests = [];
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      requests.push(JSON.parse(body)); res.setHeader("Content-Type", "text/event-stream");
      for (const event of [
        { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-sonnet-4-6", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fixture answer" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  claude.spawnProcess = (command, args, options) => spawn(command, args, { ...options, env: { ...options.env, ANTHROPIC_API_KEY: "fixture-only", ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
  const events = [];
  const result = await claude.process(cli, claudeArguments({ model: "sonnet", mode: "chat" }), { input: '{"request":"say fixture answer","context":{"kind":"none"}}', onLine: event => events.push(event) });
  assert.equal(result.code, 0); assert.equal(events.find(e => e.type === "result")?.result, "fixture answer");
  assert.deepEqual(events.find(e => e.subtype === "init")?.tools, []);
  assert.equal(requests.length, 1); assert.equal(requests[0].tools?.length ?? 0, 0);
  console.log(JSON.stringify({ platform: process.platform, codexAppServer: true, claudeNativeAuthStatus: true, claudeNativeStreaming: true, offeredTools: [], realAccount: false, paidInference: false }));
} finally {
  await Promise.allSettled([codex.close(), claude.close()]); server?.close(); await rm(root, { recursive: true, force: true });
}
