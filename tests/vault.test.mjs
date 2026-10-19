import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../core/vault.mjs";

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "open-notes-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "vault");
  const recovery = join(dir, "recovery");
  await mkdir(root);
  await writeFile(join(root, "한글.md"), "# 시작\n안녕하세요");
  return { dir, root, recovery, store: await Vault.open(root, recovery) };
}

test("Korean content round-trips and original bytes are backed up outside the vault", async (t) => {
  const { store, recovery, root } = await fixture(t);
  const { notes } = await store.snapshot();
  const saved = await store.save(
    "한글.md",
    "# 변경\n배터리 시험 ✅",
    notes[0].revision,
  );
  assert.equal(saved.content, "# 변경\n배터리 시험 ✅");
  assert.notEqual(saved.revision, notes[0].revision);
  assert.equal(await readFile(join(root, "한글.md"), "utf8"), saved.content);
  const files = await readdir(recovery, { recursive: true });
  const backup = files.find((f) => f.endsWith(".md"));
  assert.ok(backup);
  assert.equal(
    await readFile(join(recovery, backup), "utf8"),
    "# 시작\n안녕하세요",
  );
});

test("a stale revision cannot overwrite another editor’s changes", async (t) => {
  const { store, root } = await fixture(t);
  const note = (await store.snapshot()).notes[0];
  await writeFile(join(root, note.path), "다른 편집기의 변경");
  await assert.rejects(
    store.save(note.path, "my draft", note.revision),
    /외부|변경|conflict/i,
  );
  assert.equal(
    await readFile(join(root, note.path), "utf8"),
    "다른 편집기의 변경",
  );
});

test("rejects traversal, hidden settings, absolute paths and non-Markdown writes", async (t) => {
  const { store } = await fixture(t);
  for (const path of [
    "../outside.md",
    "/tmp/out.md",
    "C:/out.md",
    ".obsidian/app.md",
    "a/../b.md",
    "a\\b.md",
    "image.png",
  ]) {
    await assert.rejects(store.create(path), /경로|Markdown/);
  }
});

test("symlink files and directories are excluded and cannot be written", async (t) => {
  const { store, root, dir } = await fixture(t);
  const outside = join(dir, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "outside");
  await symlink(join(outside, "secret.md"), join(root, "linked.md"));
  await symlink(outside, join(root, "linked-dir"));
  assert.deepEqual(
    (await store.snapshot()).notes.map((n) => n.path),
    ["한글.md"],
  );
  await assert.rejects(store.save("linked.md", "overwrite", "x"));
  await assert.rejects(store.create("linked-dir/new.md"));
  assert.equal(await readFile(join(outside, "secret.md"), "utf8"), "outside");
});

test("exclusive note creation preserves existing notes and binary attachments", async (t) => {
  const { store, root } = await fixture(t);
  const bytes = Buffer.from([137, 80, 78, 71, 255, 0]);
  await writeFile(join(root, "image.png"), bytes);
  await mkdir(join(root, ".obsidian"));
  await writeFile(join(root, ".obsidian", "config.md"), "hidden");
  await store.create("프로젝트/새 문서.md");
  await assert.rejects(store.create("한글.md"), /이미|exist/i);
  assert.deepEqual(await readFile(join(root, "image.png")), bytes);
  assert.equal((await store.snapshot()).notes.length, 2);
});

test("simultaneous saves do not both accept the same old revision", async (t) => {
  const { store } = await fixture(t);
  const note = (await store.snapshot()).notes[0];
  const results = await Promise.allSettled([
    store.save(note.path, "first", note.revision),
    store.save(note.path, "second", note.revision),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const current = (await store.snapshot()).notes[0];
  assert.equal(current.content, "first");
  await store.save(note.path, "after failed operation", current.revision);
});

test("recovery preserves UTF-8 BOM and original CRLF bytes", async (t) => {
  const { store, root, recovery } = await fixture(t);
  const original = Buffer.from("\ufeff# 문서\r\n한글\r\n");
  await writeFile(join(root, "bom.md"), original);
  const note = (await store.snapshot()).notes.find((n) => n.path === "bom.md");
  await store.save("bom.md", "# 변경", note.revision);
  const backup = (await readdir(recovery, { recursive: true })).find((f) =>
    f.endsWith(".md"),
  );
  assert.deepEqual(await readFile(join(recovery, backup)), original);
});

test("rejects Windows device names and trailing-dot directory aliases", async (t) => {
  const { store } = await fixture(t);
  for (const relative of ["CON.md", "a/NUL.md", "COM1.md", "folder./note.md"]) {
    await assert.rejects(store.create(relative), /경로/);
  }
});
