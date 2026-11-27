import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CopilotHistory } from "../electron/copilot-history.mjs";

test("rewind keeps the selected exchange, rejects a stale tail and persists the new dialogue", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dynote-chat-rewind-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vaultId = "personal", chatId = randomUUID(), first = randomUUID(), second = randomUUID();
  let store = new CopilotHistory(root);
  const run = (action, requestId, extra = {}) => store.run(vaultId, { action, chatId, requestId, ...extra });
  for (const [requestId, prompt] of [[first, "A"], [second, "B"]]) {
    await run("begin", requestId, { prompt, mode: "chat", lastRequestId: requestId === first ? undefined : first });
    await run("finish", requestId, { status: "done", content: prompt + " answer" });
  }
  await assert.rejects(run("rewind", first, { lastRequestId: first }), /변경/);
  assert.equal((await run("open")).length, 4);
  const restored = await run("rewind", first, { lastRequestId: second });
  assert.deepEqual(restored.map(m => m.content), ["A", "A answer"]);
  assert.equal(restored[1].checkpoint, first);
  store = new CopilotHistory(root);
  assert.deepEqual(await run("open"), restored);
  assert.deepEqual(await store.run("team", { action: "list" }), []);
  const next = randomUUID();
  await assert.rejects(run("begin", next, { lastRequestId: second, prompt: "stale" }), /변경/);
  await run("begin", next, { lastRequestId: first, prompt: "unsent" });
  await run("discardUnsent", next);
  assert.deepEqual(await run("open"), restored);
  await run("discardUnsent", first);
  assert.deepEqual(await run("open"), restored);
  await run("begin", next, { lastRequestId: first, prompt: "C", mode: "chat" });
  assert.deepEqual((await run("open")).filter(m => m.role === "user").map(m => m.content), ["A", "C"]);
});

test("old history with file snapshots supports conversation-only rewind", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dynote-chat-legacy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = randomUUID(), second = randomUUID(), chatId = randomUUID(), vaultId = "personal";
  await mkdir(path.join(root, vaultId));
  const turns = [first, second].map(id => ({ id, prompt: id, mode: "agent", status: "done", content: "done",
    changes: [{ path: "Home.md", before: "old", after: "AI", saved: true }] }));
  await writeFile(path.join(root, vaultId, chatId + ".json"), JSON.stringify({ turns, rewinding: second }));
  const history = new CopilotHistory(root);
  const result = await history.run(vaultId, { action: "rewind", chatId, requestId: first, lastRequestId: second });
  assert.deepEqual(result.map(m => m.content), [first, "done"]);
});
