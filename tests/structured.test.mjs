import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../core/vault.mjs";
import { buildKnowledge } from "../core/knowledge.mjs";
const load = async (name) =>
  import(`../core/${name}.mjs`).catch((e) => {
    if (e.code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "dynote-structured-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "vault");
  await mkdir(root);
  return { root, store: await Vault.open(root, join(dir, "recovery")) };
}
const canvas = (file = "A.md") =>
  JSON.stringify({
    custom: { keep: true },
    nodes: [
      {
        id: "a",
        type: "file",
        file,
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        custom: "keep",
      },
      {
        id: "b",
        type: "text",
        text: "[[A]]",
        x: 400,
        y: 0,
        width: 300,
        height: 200,
      },
    ],
    edges: [{ id: "ab", fromNode: "a", toNode: "b", label: "관련" }],
  });

test("structured documents have independent create/save, conflict and syntax checks", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(typeof store.createDocument, "function");
  const created = await store.createDocument("설계/Board.canvas");
  assert.equal(created.kind, "canvas");
  const saved = await store.saveDocument(
    created.path,
    canvas(),
    created.revision,
  );
  assert.equal(JSON.parse(saved.content).custom.keep, true);
  await assert.rejects(
    store.saveDocument(created.path, "{}", created.revision),
    /변경/,
  );
  await assert.rejects(store.saveDocument(created.path, "{", saved.revision));
  assert.equal(await readFile(join(root, created.path), "utf8"), canvas());
  await assert.rejects(store.createDocument(created.path));
  await assert.rejects(store.save(created.path, "markdown", saved.revision));
  await assert.rejects(store.createDocument("../Outside.base"));
  const base = await store.createDocument("문서.base");
  const snap = await store.snapshot();
  assert.equal(snap.notes.length, 0);
  assert.equal(snap.documents.length, 2);
  assert.equal(base.kind, "base");
});
test("Canvas references and Markdown links follow a note move without losing unknown JSON", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(typeof store.createDocument, "function");
  const a = await store.create("A.md");
  const board = await store.createDocument("Board.canvas");
  await store.saveDocument(board.path, canvas(), board.revision);
  await writeFile(join(root, "Home.md"), "[[Board.canvas]]");
  await store.moveFile(a.path, "프로젝트/B.md", a.revision);
  const data = JSON.parse(await readFile(join(root, board.path), "utf8"));
  assert.equal(data.nodes[0].file, "프로젝트/B.md");
  assert.equal(data.nodes[0].custom, "keep");
  assert.match(data.nodes[1].text, /\[\[프로젝트\/B\]\]/);
  assert.deepEqual(data.custom, { keep: true });
  const doc = (await store.snapshot()).documents.find(
    (d) => d.path === board.path,
  );
  await store.moveFile(board.path, "설계/Board.canvas", doc.revision);
  assert.match(
    await readFile(join(root, "Home.md"), "utf8"),
    /\[\[설계\/Board.canvas\]\]/,
  );
  const moved = (await store.snapshot()).documents.find((d) =>
    d.path.endsWith(".canvas"),
  );
  const item = await store.trashFile(moved.path, moved.revision);
  await store.restoreTrash(item.id);
  assert.equal((await store.snapshot()).documents.length, 1);
});
test("structured symlinks and invalid files cannot bypass the vault boundary", async (t) => {
  const { root, store } = await fixture(t);
  assert.equal(typeof store.saveDocument, "function");
  await writeFile(join(root, "Board.canvas"), canvas());
  await symlink(join(root, "Board.canvas"), join(root, "Link.canvas"));
  await assert.rejects(store.saveDocument("Link.canvas", canvas(), "old"));
  assert.equal((await store.snapshot()).documents.length, 1);
});
test("Canvas rejects malformed nodes, unsafe paths and broken edges; unknown types are read-only", async () => {
  const { parseCanvas } = await load("canvas");
  assert.equal(typeof parseCanvas, "function");
  assert.equal(parseCanvas(canvas()).readOnly, false);
  const data = JSON.parse(canvas());
  assert.throws(() =>
    parseCanvas(
      JSON.stringify({ ...data, nodes: [...data.nodes, data.nodes[0]] }),
    ),
  );
  assert.throws(() => parseCanvas(canvas("../private.md")));
  assert.throws(() =>
    parseCanvas(JSON.stringify({ nodes: [], edges: data.edges })),
  );
  const future = {
    nodes: [{ id: "x", type: "future", x: 0, y: 0, width: 10, height: 10 }],
    custom: 1,
  };
  assert.equal(parseCanvas(JSON.stringify(future)).readOnly, true);
  assert.deepEqual(parseCanvas(JSON.stringify(future)).data, future);
});
test("Bases filters/formulas use Korean properties and table sorting/grouping", async () => {
  const { evaluateBase } = await load("bases");
  assert.equal(typeof evaluateBase, "function");
  const notes = buildKnowledge([
    {
      path: "시험/A.md",
      content:
        "---\nproject: BMS\nstatus: 검토중\nprice: 3\ncount: 4\ntags: [시험]\n---\n# A",
    },
    {
      path: "시험/B.md",
      content: "---\nproject: BMS\nstatus: 완료\nprice: 2\ncount: 5\n---\n# B",
    },
  ]).notes;
  const source =
    "filters: 'project == \"BMS\"'\nformulas:\n  total: price * count\nviews:\n  - type: table\n    name: 시험 목록\n    order: [file.name, note.status, formula.total]\n    groupBy: {property: note.status, direction: ASC}\n    sort: [{property: formula.total, direction: DESC}]\n";
  const result = evaluateBase(source, notes);
  assert.deepEqual(result.columns, [
    "file.name",
    "note.status",
    "formula.total",
  ]);
  assert.equal(result.rows[0].values["formula.total"], 12);
  assert.equal(result.groups.length, 2);
  const filtered = evaluateBase(
    source.replace('project == "BMS"', 'status != "완료"'),
    notes,
  );
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].path, "시험/A.md");
});
test("unsupported Bases layouts and malformed expressions are visible rather than silently rewritten", async () => {
  const { parseBase, evaluateBase } = await load("bases");
  assert.equal(typeof parseBase, "function");
  assert.equal(parseBase("views:\n  - type: map\n").readOnly, true);
  assert.throws(() => parseBase("views: &v [*v]"));
  assert.throws(() =>
    evaluateBase("filters: 'status =='\nviews: [{type: table}]", []),
  );
});
test("editing a Base cell preserves YAML comments, BOM, CRLF and body, with explicit types", async () => {
  const { patchProperty } = await load("bases");
  assert.equal(typeof patchProperty, "function");
  const source =
    "\uFEFF---\r\n# keep comment\r\nstatus: draft # keep inline\r\ncount: 3\r\n---\r\n# 본문\r\n[[A]]\r\n";
  const next = patchProperty(source, "status", "완료");
  assert.match(next, /# keep comment/);
  assert.match(next, /status: 완료 # keep inline/);
  assert.equal(
    next.slice(next.indexOf("# 본문")),
    source.slice(source.indexOf("# 본문")),
  );
  assert(next.startsWith("\uFEFF---\r\n"));
  assert.match(patchProperty(source, "count", "4"), /count: 4/);
  assert.throws(() => patchProperty(source, "count", "four"));
  assert.throws(() => patchProperty("---\na: [\n---\nbody", "status", "x"));
});

test("Canvas validates optional display values instead of crashing the renderer", async () => {
  const { parseCanvas } = await load("canvas");
  const data = JSON.parse(canvas());
  data.nodes[0].color = { unsafe: true };
  assert.throws(() => parseCanvas(JSON.stringify(data)));
  delete data.nodes[0].color;
  data.nodes[0].subpath = { heading: "invalid" };
  assert.throws(() => parseCanvas(JSON.stringify(data)), /subpath/);
});
test("Bases file properties reflect snapshot metadata and resolved backlinks", async () => {
  const { evaluateBase } = await load("bases");
  const notes = buildKnowledge([
    {
      path: "A.md",
      content: "[[B]]",
      metadata: { size: 5, mtime: 1234, ctime: 1000 },
    },
    {
      path: "B.md",
      content: "# B",
      metadata: { size: 3, mtime: 2345, ctime: 2000 },
    },
  ]).notes;
  const result = evaluateBase(
    "views: [{type: table, order: [file.name, file.size, formula.incoming]}]\nformulas:\n  incoming: file.backlinks.length\n",
    notes,
  );
  assert.equal(
    result.rows.find((r) => r.path === "B.md").values["file.size"],
    3,
  );
  assert.equal(
    result.rows.find((r) => r.path === "B.md").values["formula.incoming"],
    1,
  );
});
test("unsupported Base settings are read-only, and display names must be strings", async () => {
  const { parseBase } = await load("bases");
  assert.equal(
    parseBase("futureSetting: true\nviews: [{type: table}]\n").readOnly,
    true,
  );
  assert.throws(() =>
    parseBase(
      "properties: {status: {displayName: [bad]}}\nviews: [{type: table}]\n",
    ),
  );
});
test("Bases backlinks resolve aliases and relative paths once per source and exclude ambiguous names", async () => {
  const { evaluateBase } = await load("bases");
  const notes = buildKnowledge([
    { path: "A.md", content: "[[별칭]] [[folder/B]] [relative](folder/B.md) [[Duplicate]]" },
    { path: "folder/B.md", content: "---\naliases: [별칭]\n---\n[B](B.md)" },
    { path: "one/Duplicate.md", content: "" },
    { path: "two/Duplicate.md", content: "" },
  ]).notes;
  const result = evaluateBase("views: [{type: table, order: [file.path, formula.incoming]}]\nformulas:\n  incoming: file.backlinks.length\n", notes);
  assert.equal(result.rows.find((r) => r.path === "folder/B.md").values["formula.incoming"], 2);
  assert.equal(result.rows.find((r) => r.path === "one/Duplicate.md").values["formula.incoming"], 0);
});
test("file metadata returned after edits matches actual UTF-8 bytes", async (t) => {
  const { store } = await fixture(t);
  const created = await store.create("A.md");
  const saved = await store.save(
    created.path,
    "# 한글 메모\n",
    created.revision,
  );
  assert.equal(saved.metadata?.size, Buffer.byteLength("# 한글 메모\n"));
});
