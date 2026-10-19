import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  extractLinks,
  resolveLink,
  buildKnowledge,
  searchNotes,
  renderMarkdown,
} from "../core/knowledge.mjs";

const notes = [
  { path: "Home.md", content: "# 시작\n[[area/Test|시험]] [[Guide#절차]]" },
  { path: "area/Test.md", content: "# 시험\n[[../Guide]] #BMS" },
  { path: "Guide.md", content: "# 가이드\n## 절차\n배터리 시험 절차" },
];

test("extracts aliases and ignores fenced/inline code", () => {
  assert.deepEqual(
    extractLinks("[[Guide|안내]] `[[fake]]`\n```md\n[[also-fake]]\n```").map(
      (l) => l.target,
    ),
    ["Guide"],
  );
});

test("resolves relative, root, heading links and does not guess ambiguous names", () => {
  assert.equal(resolveLink("../Guide", "area/Test.md", notes).path, "Guide.md");
  assert.equal(resolveLink("Guide#절차", "Home.md", notes).path, "Guide.md");
  assert.equal(resolveLink("Test", "Home.md", notes).path, "area/Test.md");
  const duplicate = [...notes, { path: "other/Test.md", content: "" }];
  assert.equal(resolveLink("Test", "Home.md", duplicate).status, "ambiguous");
  assert.equal(
    resolveLink("../../outside", "Home.md", notes).status,
    "missing",
  );
});

test("backlinks and graph share the same resolved relationships", () => {
  const data = buildKnowledge(notes);
  assert.equal(data.edges.length, 3);
  assert.deepEqual(data.backlinks["Guide.md"].map((n) => n.path).sort(), [
    "Home.md",
    "area/Test.md",
  ]);
  assert.equal(
    data.notes.find((n) => n.path === "Guide.md").headings[1].text,
    "절차",
  );
});

test("search matches Korean content and ranks matching titles first", () => {
  const result = searchNotes(buildKnowledge(notes).notes, "시험");
  assert.equal(result[0].path, "area/Test.md");
  assert.ok(result.some((n) => n.path === "Guide.md"));
  assert.equal(searchNotes(notes, "없는단어").length, 0);
});

test("Markdown cannot emit active HTML, remote images or unsafe protocols", () => {
  const source =
    '<img src=x onerror=alert(1)>\n\n![tracking](https://example.invalid/pixel)\n\n[x](javascript:alert(1))\n\n<iframe src="file:///etc/passwd"></iframe>';
  const html = renderMarkdown(source, notes, "Home.md");
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll("img,script,iframe,object").length, 0);
  assert.equal(document.querySelectorAll("[onerror],[onclick]").length, 0);
  assert.equal(document.querySelector('a[href^="javascript:"]'), null);
  assert.match(document.body.textContent, /이미지/);
});

test("wikilinks are escaped and carry a navigation target", () => {
  const html = renderMarkdown(
    "[[Guide|가이드]] [[<img src=x onerror=alert(1)>]]",
    notes,
    "Home.md",
  );
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector("a").dataset.note, "Guide");
  assert.equal(doc.querySelector("img"), null);
});

test("a wikilink alias inside a table does not split the cell or lose backlinks", () => {
  const source =
    "| 문서 | 설명 |\n| --- | --- |\n| [[Guide|안내]] | 가이드 문서 |";
  const doc = new JSDOM(renderMarkdown(source, notes, "Home.md")).window
    .document;
  assert.equal(doc.querySelector("tbody a")?.textContent, "안내");
  assert.equal(doc.querySelector("tbody tr").children.length, 2);
  assert.deepEqual(
    extractLinks(source).map((l) => l.target),
    ["Guide"],
  );
});
