import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("desktop bridge offers Copilot chat and document operations without Codex access", async () => {
  let api;
  const calls = [];
  runInNewContext(await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8"), {
    require: () => ({
      contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "notes"); api = value; } },
      ipcRenderer: { invoke: async (...args) => { calls.push(args); } },
    }),
  });
  assert.deepEqual(Object.keys(api).filter((name) => /codex/i.test(name)), []);
  assert.equal(typeof api.onCopilotEvent, "function");
  await api.copilotStatus();
  await api.copilotSend({ prompt: "write" });
  await api.createNote({ path: "New.md", content: "# New" });
  assert.deepEqual(calls, [
    ["notes:copilot-status", undefined],
    ["notes:copilot-send", { prompt: "write" }],
    ["notes:create", { path: "New.md", content: "# New" }],
  ]);
});
