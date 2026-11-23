import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Vault } from "../core/vault.mjs";
import { assetPath, trustedFrame } from "../core/security.mjs";

test("Office attachments select the vault copy, skip owner files, and refresh across invalid and restored packages", async t => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-office-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "vault"));
  const vault = await Vault.open(path.join(root, "vault"), path.join(root, "recovery"));
  const original = await readFile(new URL("./fixtures/office-preview.pptx", import.meta.url));
  const imported = await vault.importAttachment("발표.PPTX", original);
  const file = await vault.officeFilePath(imported.path);
  assert.equal(file, path.join(vault.root, imported.path));
  await copyFile(file, path.join(vault.root, "~$발표.pptx"));
  assert.deepEqual((await vault.snapshot()).attachments.map(entry => entry.path), [imported.path]);
  const first = await vault.readOfficeDocument(imported.path);
  assert.equal(first.kind, "pptx");
  assert.ok(first.bytes.length);
  assert.equal(await vault.readOfficeDocument(imported.path, first.revision), null);
  await writeFile(file, "invalid");
  const invalid = await vault.readOfficeDocument(imported.path, first.revision);
  assert.ok(invalid.previewError);
  await writeFile(file, original);
  assert.ok((await vault.readOfficeDocument(imported.path, invalid.revision)).bytes);
  assert.deepEqual(await readFile(file), original);
  for (const value of ["../발표.pptx", "~$발표.pptx", "발표.exe"]) await assert.rejects(vault.officeFilePath(value));
});

test("slide preview resources have their own origin without main-frame privileges", () => {
  assert.equal(assetPath("notes://slides/slides.html", "/safe/dist"), path.resolve("/safe/dist/slides.html"));
  assert.throws(() => assetPath("notes://slides/index.html", "/safe/dist"));
  assert.equal(trustedFrame("notes://slides/slides.html", true), false);
});
