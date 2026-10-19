import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue } from "../src/saveQueue.mjs";

test("a newer edit arriving during IO uses the saved revision and is not lost", async () => {
  let release;
  const started = new Promise((r) => {
    release = r;
  });
  const calls = [];
  let queue;
  queue = new SaveQueue(async (path, content, revision) => {
    calls.push({ path, content, revision });
    if (calls.length === 1) {
      await started;
    }
    return { path, content, revision: `revision-${calls.length}` };
  });
  queue.set({ path: "note.md", content: "first", revision: "old" });
  const flushing = queue.flush();
  await Promise.resolve();
  queue.set({ path: "note.md", content: "newer", revision: "old" });
  release();
  await flushing;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].revision, "revision-1");
  assert.equal(calls[1].content, "newer");
  assert.equal(queue.dirty, false);
});

test("failed saves retain drafts and a subsequent retry can succeed", async () => {
  let fail = true;
  const queue = new SaveQueue(async (path, content) => {
    if (fail) throw new Error("disk full");
    return { path, content, revision: "next" };
  });
  queue.set({ path: "note.md", content: "draft", revision: "old" });
  await assert.rejects(queue.flush(), /disk full/);
  assert.equal(queue.dirty, true);
  assert.equal(queue.get("note.md").content, "draft");
  fail = false;
  await queue.flush();
  assert.equal(queue.dirty, false);
});

test("multiple paths save independently and flush waits for all notes", async () => {
  const calls = [];
  const queue = new SaveQueue(async (path, content) => {
    calls.push(path);
    return { path, content, revision: "saved" };
  });
  queue.set({ path: "one.md", content: "one", revision: "r" });
  queue.set({ path: "two.md", content: "two", revision: "r" });
  await queue.flush();
  assert.deepEqual(calls, ["one.md", "two.md"]);
});
