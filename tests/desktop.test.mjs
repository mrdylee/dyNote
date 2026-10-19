import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Vault } from "../core/vault.mjs";
import * as knowledge from "../core/knowledge.mjs";
const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082",
  "hex",
);
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dynote-desktop-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "vault");
  await mkdir(root);
  return { root, store: await Vault.open(root, join(dir, "recovery")) };
}
test("local attachments preserve bytes and reject active formats and traversal", async (t) => {
  const { store } = await fixture(t);
  assert.equal(typeof store.importAttachment, "function");
  const asset = await store.importAttachment("시험.png", png);
  assert.match(asset.path, /\.png$/);
  assert.deepEqual(
    Buffer.from((await store.readAttachment(asset.path)).bytes),
    png,
  );
  assert.equal((await store.snapshot()).attachments.length, 1);
  await assert.rejects(
    store.importAttachment("evil.svg", Buffer.from("<svg/>")),
  );
  await assert.rejects(
    store.importAttachment("fake.png", Buffer.from("<html/>")),
  );
  await assert.rejects(store.readAttachment("../secret.png"));
});
test("attachment symlinks never expose files outside the vault", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(typeof store.readAttachment, "function");
  await writeFile(join(root, "outside.png"), png);
  await symlink(join(root, "outside.png"), join(root, "link.png"));
  await assert.rejects(store.readAttachment("link.png"));
});
test("moving a note updates ordinary and wiki incoming links and its relative outgoing link", async (t) => {
  const { root, store } = await fixture(t);
  await mkdir(join(root, "old"));
  await writeFile(join(root, "old/A.md"), "# A\n[guide](../Guide.md)");
  await writeFile(join(root, "Guide.md"), "# Guide");
  await writeFile(
    join(root, "Home.md"),
    "[[old/A#A|別名]]\n[A](old/A.md#A)\n`[[old/A]]`\n```md\n[[old/A]]\n```",
  );
  assert.equal(typeof store.moveFile, "function");
  const a = (await store.snapshot()).notes.find((n) => n.path === "old/A.md");
  await store.moveFile(a.path, "new/deep/A.md", a.revision);
  const snapshot = await store.snapshot();
  assert(!snapshot.notes.some((n) => n.path === "old/A.md"));
  const home = await readFile(join(root, "Home.md"), "utf8");
  assert.match(home, /\[\[new\/deep\/A#A\|別名\]\]/);
  assert.match(home, /new\/deep\/A\.md#A/);
  assert.match(home, /`\[\[old\/A\]\]`/);
  const moved = await readFile(join(root, "new/deep/A.md"), "utf8");
  assert.match(moved, /\.\.\/\.\.\/Guide\.md/);
  assert.equal(
    knowledge.buildKnowledge(snapshot.notes).backlinks["new/deep/A.md"].length,
    1,
  );
});
test("a move cannot replace an existing file or accept a stale revision", async (t) => {
  const { root, store } = await fixture(t);
  const a = await store.create("A.md");
  await store.create("B.md");
  assert.equal(typeof store.moveFile, "function");
  await assert.rejects(store.moveFile("A.md", "B.md", a.revision));
  await writeFile(join(root, "A.md"), "external");
  await assert.rejects(store.moveFile("A.md", "C.md", a.revision));
  assert.equal(await readFile(join(root, "A.md"), "utf8"), "external");
});
test("trash has an explicit undo without overwriting an existing file", async (t) => {
  const { root, store } = await fixture(t);
  const a = await store.create("A.md");
  assert.equal(typeof store.trashFile, "function");
  const item = await store.trashFile(a.path, a.revision);
  assert(!(await store.snapshot()).notes.length);
  await store.restoreTrash(item.id);
  assert.equal(await readFile(join(root, "A.md"), "utf8"), a.content);
  const again = await store.trashFile(a.path, a.revision);
  await store.create("A.md");
  await assert.rejects(store.restoreTrash(again.id));
});
test("metadata is parsed separately, aliases resolve, and edits preserve the body", () => {
  assert.equal(typeof knowledge.parseMetadata, "function");
  const content =
    "---\ntags: [시험, battery]\naliases: [BMS]\nstatus: draft\n---\n# 제목\nbody";
  const note = knowledge.buildKnowledge([{ path: "Battery.md", content }])
    .notes[0];
  assert.deepEqual(note.tags, ["시험", "battery"]);
  assert.equal(note.properties.status, "draft");
  assert.equal(
    knowledge.resolveLink("BMS", "Home.md", [note]).path,
    "Battery.md",
  );
  assert.match(
    knowledge.updateMetadata(content, "status: done\ntags: [시험]"),
    /status: done/,
  );
  assert.match(
    knowledge.updateMetadata(content, "status: done"),
    /# 제목\nbody$/,
  );
});
test("ordinary Markdown links join the same backlink index and ignore external links", () => {
  const model = knowledge.buildKnowledge([
    { path: "A.md", content: "[B](B.md) [web](https://example.org) `[[B]]`" },
    { path: "B.md", content: "# B" },
  ]);
  assert.equal(model.backlinks["B.md"].length, 1);
});
test("completion inserts a distinct real path for duplicate display names", () => {
  assert.equal(typeof knowledge.suggestNotes, "function");
  const suggestions = knowledge.suggestNotes(
    [
      { path: "a/Test.md", title: "시험" },
      { path: "b/Test.md", title: "시험" },
    ],
    "시험",
  );
  assert.equal(suggestions.length, 2);
  assert.notEqual(suggestions[0].insert, suggestions[1].insert);
});
test("advanced search supports Korean phrases, tag/path and excluded words", () => {
  const notes = knowledge.buildKnowledge([
    { path: "project/A.md", content: "# A\n배터리 시험 절차 #bms" },
    { path: "other/B.md", content: "# B\n배터리 시험 실패 #bms" },
  ]).notes;
  assert.deepEqual(
    knowledge
      .searchNotes(notes, '"배터리 시험" tag:bms path:project/ -실패')
      .map((n) => n.path),
    ["project/A.md"],
  );
});
test("preview supports local images, bounded embeds, tasks, callouts, footnotes and math", () => {
  const notes = knowledge.buildKnowledge([
    { path: "A.md", content: "# A\n![[B]]" },
    { path: "B.md", content: "# B\n![[A]]" },
  ]).notes;
  const html = knowledge.renderMarkdown(
    "![x](assets/x.png)\n\n![[B]]\n\n- [ ] task\n\n> [!note]\n> callout\n\nFoot[^1]\n\n[^1]: value\n\n$E=mc^2$",
    notes,
    "A.md",
    { vaultId: "test", attachments: [{ path: "assets/x.png" }] },
  );
  assert.match(html, /notes:\/\/vault\/test/);
  assert.match(html, /note-embed/);
  assert.match(html, /data-task-line/);
  assert.match(html, /callout/);
  assert.match(html, /footnote/);
  assert.match(html, /katex/);
  assert(html.length < 30000);
});
test("a task toggle uses the original source line and preserves YAML", () => {
  assert.equal(typeof knowledge.toggleTask, "function");
  const source = "---\nstatus: draft\n---\n# A\n- [ ] task";
  assert.equal(
    knowledge.toggleTask(source, 4, true),
    "---\nstatus: draft\n---\n# A\n- [x] task",
  );
});
test("attachment relocation updates image links without changing binary data", async (t) => {
  const { root, store } = await fixture(t);
  const image = await store.importAttachment("sample.png", png);
  await writeFile(join(root, "A.md"), `![x](${image.path})`);
  await store.moveFile(image.path, "pictures/new.png", image.revision);
  assert.deepEqual(
    Buffer.from((await store.readAttachment("pictures/new.png")).bytes),
    png,
  );
  assert.match(await readFile(join(root, "A.md"), "utf8"), /pictures\/new.png/);
});
test("metadata rejects alias expansion and invalid YAML without changing input", () => {
  assert.throws(() => knowledge.updateMetadata("# Body", "a: &a [1]\nb: *a"));
  assert.throws(() => knowledge.updateMetadata("# Body", "a: 1\na: 2"));
  const source = "\uFEFF---\r\nstatus: draft\r\n---\r\n# Body\r\n";
  assert.match(
    knowledge.updateMetadata(source, "status: done"),
    /^\uFEFF---\r\nstatus: done\r\n---\r\n# Body\r\n$/,
  );
});
test("remote images remain blocked even when local image display is enabled", () => {
  const html = knowledge.renderMarkdown(
    "![remote](https://example.org/pixel) ![[../secret.png]]",
    [],
    "A.md",
    { vaultId: "test", attachments: [] },
  );
  assert(!html.includes("<img"));
});
test("a trash operation rejects a stale document and keeps the external change", async (t) => {
  const { root, store } = await fixture(t);
  const a = await store.create("A.md");
  await writeFile(join(root, "A.md"), "external");
  await assert.rejects(store.trashFile("A.md", a.revision));
  assert.equal(await readFile(join(root, "A.md"), "utf8"), "external");
});
test("moving a note rewrites the destination rather than an identical link label", async (t) => {
  const { root, store } = await fixture(t);
  const b = await store.create("B.md");
  await writeFile(join(root, "A.md"), "[B.md](B.md)");
  await store.moveFile("B.md", "C.md", b.revision);
  assert.equal(await readFile(join(root, "A.md"), "utf8"), "[B.md](C.md)");
});
test("reference-style Markdown links retain backlinks after a move", async (t) => {
  const { root, store } = await fixture(t);
  const b = await store.create("B.md");
  await writeFile(join(root, "A.md"), "[target][ref]\n\n[ref]: B.md");
  const model = knowledge.buildKnowledge((await store.snapshot()).notes);
  assert.equal(model.backlinks["B.md"].length, 1);
  await store.moveFile("B.md", "C.md", b.revision);
  assert.match(await readFile(join(root, "A.md"), "utf8"), /\[ref\]: C.md/);
});
test("canonical wiki paths and relative Markdown paths retain different meanings", () => {
  const notes = knowledge.buildKnowledge([
    { path: "B.md", content: "# Root" },
    { path: "folder/B.md", content: "# Local" },
    { path: "folder/A.md", content: "[[B]] [local](B.md)" },
  ]).notes;
  const model = knowledge.buildKnowledge(notes);
  assert.equal(model.backlinks["B.md"].length, 1);
  assert.equal(model.backlinks["folder/B.md"].length, 1);
});
test("same-note heading links have a rendered anchor target", () => {
  const html = knowledge.renderMarkdown("# 시험 절차\n[이동](#시험-절차)");
  assert.match(html, /id="시험-절차"/);
  assert.match(html, /data-anchor="시험-절차"/);
});
