import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import { fenceHighlighter, fenceLanguage } from "../core/code-highlighting.mjs";
import { renderMarkdown } from "../core/knowledge.mjs";

const codeBlock = (language, body) => JSDOM.fragment(
  renderMarkdown(`~~~${language}\n${body}\n~~~`, [], "Example.md")
).querySelector("pre code");

test("reading view highlights C tokens while preserving the exact code", () => {
  const body = '// 예시\nint main(void) {\n  puts("<b>&</b>");\n  return 42;\n}';
  const code = codeBlock("C example", body);
  assert.equal(code.textContent, body + "\n");
  assert.equal(code.querySelector("b"), null);
  for (const [token, text] of [["comment", "// 예시"], ["typeName", "int"], ["keyword", "return"], ["string", '"<b>&</b>"'], ["number", "42"]]) {
    assert.equal(code.querySelector(`.tok-${token}`)?.textContent, text);
  }
});

test("untagged, unknown and Mermaid fences stay literal", () => {
  for (const language of ["", "unknown", "constructor", "mermaid"]) {
    const code = codeBlock(language, "<b>return 42;</b>");
    assert.equal(code.childElementCount, 0);
    assert.equal(code.textContent, "<b>return 42;</b>\n");
  }
});

test("editing a fence language updates code tokens without coloring surrounding prose", () => {
  let state = EditorState.create({
    doc: "return\n\n~~~c\nreturn 42;\n~~~",
    extensions: [markdown({ codeLanguages: fenceLanguage })],
  });
  function keywords() {
    const ranges = [];
    highlightTree(ensureSyntaxTree(state, state.doc.length), fenceHighlighter, (from, to, classes) => {
      if (classes.includes("tok-keyword")) ranges.push([from, state.sliceDoc(from, to)]);
    });
    return ranges;
  }
  assert.deepEqual(keywords(), [[13, "return"]]);
  const tag = state.doc.toString().indexOf("~~~") + 3;
  state = state.update({ changes: { from: tag, to: tag + 1, insert: "text" } }).state;
  assert.deepEqual(keywords(), []);
});

test("JavaScript aliases, file extensions and catalog languages resolve in fenced blocks", async () => {
  for (const [tag, source] of [
    ["javascript", "const x = 42"], ["JS", "const x = 42"], ["mjs", "const x = 42"],
    ["csharp", "return 42;"], ["rust", "let x = 42;"], ["sql", "SELECT 42;"],
    ["json", '{"x": 42}'], ["tsx", "const x = <p>{42}</p>;"],
  ]) {
    const mode = fenceLanguage(tag);
    assert.ok(mode, tag);
    if (mode.load) await mode.load();
    const code = codeBlock(tag, source);
    assert.equal(code.textContent, source + "\n");
    assert.ok(code.querySelector(".tok-number"), tag);
  }
});

test("large eager and loaded catalog fences render intact without synchronous token markup", async () => {
  for (const [tag, line] of [["js", "const sensor = read(42);"], ["json", '{"reading": 42}']]) {
    const mode = fenceLanguage(tag);
    if (mode.load) await mode.load();
    const source = (line + "\n").repeat(5000) + '"<b>&</b>"';
    const code = codeBlock(tag, source);
    assert.equal(code.textContent, source + "\n");
    assert.equal(code.querySelector("[class^=tok-], b"), null);
  }
});
