import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Vault } from "../core/vault.mjs";
import { CopilotHistory } from "../electron/copilot-history.mjs";

test("restore previews later AI changes, preserves a chosen manual edit and trashes a created note", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dynote-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "notes"));
  const vault = await Vault.open(path.join(root, "notes"), path.join(root, "recovery"));
  const directory = path.join(root, "history");
  const chatId = randomUUID(), requestId = randomUUID();
  let store = new CopilotHistory(directory);
  const act = (action, extra = {}) => store.run(vault, { action, chatId, requestId, drafts: [], ...extra });
  await act("begin", { prompt: "검토", mode: "agent" });
  for (const [name, before, after] of [["A.md", "original", "agent"], ["B.md", null, "created"]]) {
    await act("change", { change: { path: name, before, after } });
    await act("keep", { path: name });
    await writeFile(path.join(vault.root, name), after);
  }
  await act("finish", { status: "done", content: "완료" });
  store = new CopilotHistory(directory);
  assert.equal((await act("list"))[0].title, "검토");
  assert.equal((await act("open")).at(-1).content, "완료");
  const stale = await act("preview");
  await writeFile(path.join(vault.root, "A.md"), "manual");
  await assert.rejects(act("apply", { version: stale.version, choices: {} }), /변경/);
  const preview = await act("preview");
  assert.equal(preview.rows.find(r => r.path === "A.md").conflict, true);
  await assert.rejects(act("apply", { version: preview.version, choices: {} }), /선택/);
  await act("apply", { version: preview.version, choices: { "A.md": "keep" } });
  await act("rewind");
  assert.equal((await act("open")).length, 0);
  assert.deepEqual((await vault.snapshot()).notes.map(n => [n.path, n.content]), [["A.md", "manual"]]);
  const trash = await readdir(path.join(vault.recoveryRoot, "trash"));
  assert.equal(trash.length, 1);
  await vault.restoreTrash(trash[0]);
  assert.equal((await vault.readNote("B.md")).content, "created");
});

test("the chosen turn restores an earlier unsaved draft and leaves other vaults and conversations alone", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dynote-chat-drafts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ["one", "two"]) await mkdir(path.join(root, folder));
  const a = await Vault.open(path.join(root, "one"), path.join(root, "recovery"));
  const b = await Vault.open(path.join(root, "two"), path.join(root, "recovery"));
  await a.create("A.md", "original");
  const store = new CopilotHistory(path.join(root, "history"));
  const chatId = randomUUID(), first = randomUUID(), second = randomUUID();
  const run = (action, requestId, extra = {}) => store.run(a, { chatId, action, requestId, ...extra });
  const draft = { id: first, path: "A.md", kind: "edit", original: "original", content: "draft 1", aiContent: "draft 1",
    revision: (await a.readNote("A.md")).revision, requestId: first, history: [{ chatId, requestId: first }] };
  const later = { ...draft, requestId: second, content: "draft 2", aiContent: "draft 2", history: [...draft.history, { chatId, requestId: second }] };
  await run("begin", first, { prompt: "one", mode: "agent" });
  await run("change", first, { change: { path: "A.md", before: "original", after: draft.content } });
  await run("begin", second, { prompt: "two", mode: "agent" });
  await run("change", second, { change: { path: "A.md", before: draft.content, after: later.content, beforeDraft: draft } });
  assert.deepEqual(await store.run(b, { action: "list" }), []);
  const preview = await run("preview", second, { drafts: [later] });
  assert.equal(preview.rows[0].conflict, false);
  const { drafts } = await run("apply", second, { version: preview.version, drafts: [later], choices: {} });
  assert.deepEqual(drafts, [draft]);
  assert.equal((await a.readNote("A.md")).content, "original");
  assert.equal((await run("rewind", second))[0].content, "one");

  const edited = { ...draft, content: "manual", userEdited: true };
  const conflict = await run("preview", first, { drafts: [edited] });
  const keep = await run("apply", first, { version: conflict.version, drafts: [edited], choices: { "A.md": "keep" } });
  assert.equal(keep.drafts[0].content, "manual");
  assert.deepEqual(keep.drafts[0].history, []);
});

test("a saved edit can be restored after an interrupted save acknowledgement, and a restore can be retried", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dynote-chat-retry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "notes"));
  const vault = await Vault.open(path.join(root, "notes"), path.join(root, "recovery"));
  const store = new CopilotHistory(path.join(root, "history"));
  const chatId = randomUUID(), requestId = randomUUID();
  const run = (action, extra = {}) => store.run(vault, { action, chatId, requestId, drafts: [], ...extra });
  const note = await vault.create("A.md", "before");
  await run("begin", { prompt: "change", mode: "edit" });
  await run("change", { change: { path: note.path, before: note.content, after: "after" } });
  await run("saving", { path: note.path });
  await vault.save(note.path, "after", note.revision);
  const preview = await run("preview");
  assert.equal(preview.rows.length, 1);
  await run("apply", { version: preview.version, choices: {} });
  assert.equal((await vault.readNote(note.path)).content, "before");
  const retry = await run("preview");
  await run("apply", { version: retry.version, choices: {} });
  assert.deepEqual(await run("rewind"), []);
});
