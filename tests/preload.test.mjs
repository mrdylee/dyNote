import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("desktop bridge routes each AI provider through its own channel", async () => {
  let api;
  const calls = [], listeners = new Map();
  runInNewContext(await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "notes"); api = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); }, on: (name, fn) => listeners.set(name, fn), removeListener: name => listeners.delete(name) },
    }),
  });
  for (const provider of ["copilot", "codex", "claude"]) {
    const label = provider[0].toUpperCase() + provider.slice(1);
    let received;
    const dispose = api[`on${label}Event`](value => { received = value; });
    listeners.get(`notes:${provider}-event`)({}, { type: "done" });
    assert.deepEqual(received, { type: "done" });
    dispose(); assert.equal(listeners.size, 0);
    for (const suffix of ["Status", "Login", "CancelLogin", "Send", "Cancel"]) assert.equal(typeof api[provider + suffix], "function");
  }
  assert.equal(typeof api.onCopilotEvent, "function");
  await api.copilotStatus();
  await api.copilotSend({ prompt: "write" });
  await api.codexSend({ prompt: "codex" });
  await api.claudeSend({ prompt: "claude" });
  await api.createNote({ path: "New.md", content: "# New" });
  assert.deepEqual(calls, [
    ["notes:copilot-status", undefined],
    ["notes:copilot-send", { prompt: "write" }],
    ["notes:codex-send", { prompt: "codex" }],
    ["notes:claude-send", { prompt: "claude" }],
    ["notes:create", { path: "New.md", content: "# New" }],
  ]);
});
