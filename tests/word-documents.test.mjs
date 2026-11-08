import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchNotes } from "../core/knowledge.mjs";
import { Vault, validFilePath } from "../core/vault.mjs";
import { readWordContent } from "../core/word-documents.mjs";

const original = new URL("./fixtures/word-roundtrip.docx", import.meta.url);
const updated = new URL("./fixtures/word-roundtrip-updated.docx", import.meta.url);
const documentPath = "내려받은 문서/SWRS 초안.DOCX";

function combineDirectories(first, second) {
  const split = bytes => {
    const end = bytes.lastIndexOf(Buffer.from("504b0506", "hex"));
    const offset = bytes.readUInt32LE(end + 16);
    return { data: bytes.subarray(0, offset), directory: bytes.subarray(offset, end), footer: bytes.subarray(end) };
  };
  const left = split(first), right = split(second);
  assert.equal(left.directory.length, right.directory.length);
  const width = Math.max(left.data.length, right.data.length);
  const footer = Buffer.from(left.footer);
  footer.writeUInt32LE(width, 16);
  return Buffer.concat([
    left.data, Buffer.alloc(width - left.data.length), left.directory,
    right.data, Buffer.alloc(width - right.data.length), right.directory, footer,
  ]);
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "dynote-word-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = await realpath(directory);
  const vaultRoot = join(root, "vault");
  await mkdir(join(vaultRoot, "내려받은 문서"), { recursive: true });
  const file = join(vaultRoot, documentPath);
  await copyFile(original, file);
  return { root, file, vault: await Vault.open(vaultRoot, join(root, "recovery")) };
}

test("lists and indexes Word body text without treating round-trip documents as writable vault files", async (t) => {
  const { file, vault } = await fixture(t);
  const originalBytes = await readFile(file);
  const { notes, attachments, wordDocuments } = await vault.snapshot();
  assert.deepEqual(notes, []);
  assert.deepEqual(attachments, []);
  assert.deepEqual(wordDocuments.map(document => document.path), [documentPath]);
  assert.equal(searchNotes(wordDocuments, "SWRS-240")[0].path, documentPath);
  assert.equal(searchNotes(wordDocuments, "절연감시")[0].path, documentPath);
  const preview = await vault.readWordDocument(documentPath);
  assert.match(preview.html, /<h1>SWRS 검토 문서<\/h1>/);
  assert.match(preview.html, /<table>/);
  assert.match(preview.html, /data:image\/png;base64,/);
  assert.equal(await vault.wordFilePath(documentPath), file);
  assert.equal(validFilePath(documentPath), false);
  assert.deepEqual(await readFile(file), originalBytes);
});

test("detects a Word save that replaces the original and reindexes its new body", async (t) => {
  const { file, vault } = await fixture(t);
  const before = await vault.readWordDocument(documentPath);
  assert.equal(await vault.readWordDocument(documentPath, before.revision), null);
  await copyFile(updated, file + ".tmp");
  await rename(file + ".tmp", file);
  const after = await vault.readWordDocument(documentPath, before.revision);
  assert.notEqual(after.revision, before.revision);
  assert.match(after.html, /과전류차단/);
  const { wordDocuments } = await vault.snapshot();
  assert.equal(searchNotes(wordDocuments, "과전류차단")[0].path, documentPath);
  assert.deepEqual(searchNotes(wordDocuments, "절연감시"), []);
  assert.deepEqual(await readFile(file), await readFile(updated));
});

test("excludes Word lock files and refuses paths outside the vault", async (t) => {
  const { root, vault } = await fixture(t);
  await copyFile(original, join(vault.root, "~$SWRS.docx"));
  await copyFile(original, join(root, "outside.docx"));
  await symlink(join(root, "outside.docx"), join(vault.root, "alias.docx"));
  await writeFile(join(vault.root, "손상.docx"), "Not a Word document");
  const { wordDocuments } = await vault.snapshot();
  assert.deepEqual(wordDocuments.map(document => document.path).sort(), [documentPath, "손상.docx"].sort());
  assert.equal(searchNotes(wordDocuments, "손상")[0].path, "손상.docx");
  for (const path of ["../outside.docx", "alias.docx", "~$SWRS.docx", "missing.docx", "note.md"]) {
    await assert.rejects(vault.wordFilePath(path));
    await assert.rejects(vault.readWordDocument(path));
  }
  await assert.rejects(vault.readWordDocument("손상.docx"), /Word/);
});

test("converts the ZIP directory that was actually validated", async () => {
  const first = await readFile(original), second = await readFile(updated);
  const expected = await readWordContent(first, false);
  const actual = await readWordContent(combineDirectories(first, second), true);
  assert.equal(actual.content, expected.content);
  assert.match(actual.html, /절연감시/);
  assert.doesNotMatch(actual.html, /과전류차단/);
});

test("indexes manual Word line breaks as whitespace between requirement terms", async () => {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await readFile(original));
  const xml = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", xml.replace(
    "<w:t>240</w:t>",
    "<w:t>240</w:t><w:br/><w:t>VoltageGuard</w:t><w:br/>",
  ));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const { content, html } = await readWordContent(bytes, true);
  const file = { path: "SWRS.docx", title: "SWRS.docx", content };
  assert.match(html, /SWRS-240<br \/>VoltageGuard<br \/>/);
  for (const query of ["SWRS-240", "VoltageGuard", "절연감시"]) {
    assert.equal(searchNotes([file], query)[0]?.path, file.path, query);
  }
});
