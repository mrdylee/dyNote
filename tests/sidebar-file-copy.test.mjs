import assert from "node:assert/strict";
import test from "node:test";
import fs, { mkdir, mkdtemp, readFile, realpath, rm, truncate, readdir, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { ExternalDocuments } from "../core/external-documents.mjs";
import { Vault } from "../core/vault.mjs";

test("OS drops copy original bytes, reserve distinct names and stay within the target folder", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-drop-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "vault");
  await mkdir(path.join(destination, "Reports"), { recursive: true });
  const vault = await Vault.open(destination, path.join(root, "recovery"));
  const name = "README", source = path.join(root, name), bytes = Buffer.from([0, 3, 255, 163]);
  await writeFile(source, bytes);
  await writeFile(path.join(destination, "Reports", name), "existing");
  const copies = (await Promise.all([vault.transferDroppedFile(source, "Reports", "copy"), vault.transferDroppedFile(source, "Reports", "copy")])).map(result => result.path);
  assert.deepEqual(copies, ["Reports/README (복사본)", "Reports/README (복사본 2)"]);
  for (const copy of copies) assert.deepEqual(await readFile(path.join(destination, copy)), bytes);
  assert.deepEqual(await readFile(source), bytes);
  assert.equal(await readFile(path.join(destination, "Reports", name), "utf8"), "existing");
  await assert.rejects(vault.transferDroppedFile(source, "../outside", "move"));
  await assert.rejects(vault.transferDroppedFile(destination, "", "move"));
});

test("drop publication, move, same-folder, extensionless names and restore limits", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-transfer-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "vault");
  await mkdir(dir);
  const vault = await Vault.open(dir, path.join(root, "recovery"));
  const source = path.join(root, "html");
  await writeFile(source, "extensionless");
  assert.deepEqual(await vault.transferDroppedFile(source, "", "move"), { path: "html" });
  await assert.rejects(readFile(source), { code: "ENOENT" });
  assert.equal(await vault.readOtherFile("html"), "extensionless");
  assert.deepEqual((await vault.snapshot()).otherFiles, [{ path: "html", kind: "other" }]);
  assert.deepEqual(await vault.transferDroppedFile(path.join(dir, "html"), "", "move"), { path: "html", unchanged: true });
  const large = path.join(root, "report.pdf");
  await writeFile(large, "%PDF-1.7");
  await truncate(large, 26 * 1024 * 1024);
  await assert.rejects(vault.transferDroppedFile(large, "", "move"), /25MB/);
  assert.deepEqual(await readdir(dir), ["html"]);
  await vault.captureFiles();
});

test("Korean HTML is decoded identically on import, external preview and drop", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-html-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "vault");
  await mkdir(dir);
  const vault = await Vault.open(dir, path.join(root, "recovery"));
  const external = new ExternalDocuments(root);
  const source = path.join(root, "report.htm");
  const bytes = Buffer.concat([Buffer.from('<meta charset="euc-kr"><p>'), Buffer.from([0xc7,0xd1,0xb1,0xdb]), Buffer.from("</p>")]);
  await writeFile(source, bytes);
  const imported = await vault.importAttachment("report.htm", bytes);
  const expected = '<meta charset="euc-kr"><p>한글</p>';
  assert.equal(await vault.readOtherFile(imported.path), expected);
  const tab = await external.open(source);
  assert.equal(tab.content, expected);
  await vault.transferDroppedFile(source, "", "copy");
  assert.deepEqual(await readFile(path.join(dir, "report.htm")), bytes);
  const invalid = Buffer.from([0xff, 0]);
  await writeFile(source, invalid);
  await assert.rejects(external.read(tab.id, tab.revision), /인코딩/);
  const saved = await external.copyToVault(tab.id, vault, "", tab.revision);
  assert.equal(saved.path, "report (복사본).htm");
  assert.deepEqual(await readFile(path.join(dir, saved.path)), bytes);
  await assert.rejects(vault.importAttachment("invalid.html", invalid), /인코딩/);
  await assert.rejects(vault.transferDroppedFile(source, "", "move"), /인코딩/);
  assert.deepEqual(await readFile(source), invalid);
  assert.deepEqual((await readdir(dir)).sort(), ["_attachments", "report (복사본).htm", "report.htm"]);
  await writeFile(source, "<p>Updated</p>");
  const refreshed = await external.read(tab.id, tab.revision);
  await assert.rejects(external.copyToVault(tab.id, vault, "", tab.revision), /미리보기/);
  const latest = await external.copyToVault(tab.id, vault, "", refreshed.revision);
  assert.equal(latest.path, "report (복사본 2).htm");
  assert.equal(await readFile(path.join(dir, latest.path), "utf8"), "<p>Updated</p>");
  await external.dispose();
});

test("a competing file at publication keeps its contents and the move source", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-publish-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "vault"), source = path.join(root, "archive.bin");
  await mkdir(dir);
  await writeFile(source, "original");
  const vault = await Vault.open(dir, path.join(root, "recovery"));
  const nativeLink = fs.link;
  fs.link = async (staged, destination) => {
    assert.deepEqual(await readdir(dir), [path.basename(staged)]);
    assert.equal(await readFile(staged, "utf8"), "original");
    await writeFile(destination, "competing file", { flag: "wx" });
    return nativeLink(staged, destination);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(vault.transferDroppedFile(source, "", "move"), { code: "EEXIST" });
  } finally {
    fs.link = nativeLink;
    syncBuiltinESMExports();
  }
  assert.deepEqual(await readdir(dir), ["archive.bin"]);
  assert.equal(await readFile(path.join(dir, "archive.bin"), "utf8"), "competing file");
  assert.equal(await readFile(source, "utf8"), "original");
});
