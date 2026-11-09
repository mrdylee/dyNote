import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExternalDocuments } from "../core/external-documents.mjs";

const original = new URL("./fixtures/word-roundtrip.docx", import.meta.url);
const updated = new URL("./fixtures/word-roundtrip-updated.docx", import.meta.url);

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-external-word-test-")));
  const cache = path.join(root, "cache");
  await mkdir(cache);
  const file = path.join(root, "SWRS 검토 # % &.DOCX");
  await copyFile(original, file);
  const documents = new ExternalDocuments(cache);
  t.after(async () => { await documents.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, cache, file, documents };
}

test("opens an external Word copy without changing the original and cleans temporary files", async t => {
  const { cache, file, documents } = await fixture(t);
  const before = await readFile(file);
  const opened = await documents.open(file);
  assert.equal(opened.name, path.basename(file));
  assert.match(opened.html, /SWRS 검토 문서/);
  assert.match(opened.content, /절연감시/);
  assert.equal(await documents.sourcePath(opened.id), file);
  const folders = await readdir(cache);
  assert.equal(folders.length, 1);
  assert.deepEqual(await readFile(path.join(cache, folders[0], "document.docx")), before);
  assert.deepEqual(await readFile(file), before);
  await documents.dispose();
  assert.deepEqual(await readdir(cache), []);
  assert.deepEqual(await readFile(file), before);
});

test("refreshes the temporary preview after Word replaces the source file", async t => {
  const { file, documents } = await fixture(t);
  const before = await documents.open(file);
  assert.equal(await documents.read(before.id, before.revision), null);
  await copyFile(updated, file + ".tmp");
  await rename(file + ".tmp", file);
  const after = await documents.read(before.id, before.revision);
  assert.notEqual(after.revision, before.revision);
  assert.match(after.html, /과전류차단/);
  assert.doesNotMatch(after.content, /절연감시/);
  assert.equal(await documents.sourcePath(before.id), file);
  assert.deepEqual(await readFile(file), await readFile(updated));
});

test("keeps files with the same name separate and rejects unknown document IDs", async t => {
  const { root, file, documents } = await fixture(t);
  await mkdir(path.join(root, "other"));
  const other = path.join(root, "other", path.basename(file));
  await copyFile(updated, other);
  const first = await documents.open(file), second = await documents.open(other);
  assert.notEqual(first.id, second.id);
  assert.equal(await documents.sourcePath(first.id), file);
  assert.equal(await documents.sourcePath(second.id), other);
  await assert.rejects(documents.read("../outside"), /임시 문서/);
  await assert.rejects(documents.sourcePath(file), /임시 문서/);
});

test("refuses unsupported, locked, missing, linked and oversized external files", async t => {
  const { root, cache, file, documents } = await fixture(t);
  const locked = path.join(root, "~$SWRS.docx"), linked = path.join(root, "linked.docx");
  await copyFile(original, locked);
  await symlink(file, linked);
  for (const invalid of ["relative.docx", path.join(root, "missing.docx"), path.join(root, "note.md"), locked, linked, root])
    await assert.rejects(documents.open(invalid));
  const oversized = path.join(root, "large.docx");
  await writeFile(oversized, "");
  await truncate(oversized, 25 * 1024 * 1024 + 1);
  await assert.rejects(documents.open(oversized), /25MB/);
  assert.equal((await stat(oversized)).size, 25 * 1024 * 1024 + 1);
  assert.deepEqual(await readdir(cache), []);
});

test("removes a failed temporary copy and never rewrites malformed sources", async t => {
  const { root, cache, documents } = await fixture(t);
  const file = path.join(root, "broken.docx");
  await writeFile(file, "not a Word document");
  await assert.rejects(documents.open(file), /Word/);
  assert.equal(await readFile(file, "utf8"), "not a Word document");
  assert.deepEqual(await readdir(cache), []);
});
