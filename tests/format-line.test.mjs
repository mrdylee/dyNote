import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { wikiSyntax } from "../src/live-preview.mjs";
import { runMarkdownFormat, runTextColor } from "../src/editorCommands.mjs";
import { runSelectionOrLine } from "../src/format-line.mjs";

function editor(doc, anchor, head = anchor, readOnly = false) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor, head }, extensions: [
      markdown({ base: markdownLanguage, extensions: [wikiSyntax] }), history(), EditorState.readOnly.of(readOnly),
    ] }),
    dispatch(spec) { view.state = view.state.update(spec).state; },
    focus() {},
  };
  return view;
}
const bold = view => runSelectionOrLine(view, target => runMarkdownFormat(target, "bold"));

test("the toolbar formats just the current line's prose and undoes back to the original caret", () => {
  for (const [doc, text] of [
    ["앞\n회의 내용\n뒤", "회의 내용"],
    ["> 1. 회의 내용", "회의 내용"],
    ["- [x] 회의 내용  ", "회의 내용"],
    ["> ### 회의 내용 ###", "회의 내용"],
    ["> 앞\n> 회의 내용\n> 뒤", "회의 내용"],
    ["- 앞\n  회의 내용", "회의 내용"],
    ["회의 내용\n===", "회의 내용"],
  ]) {
    const caret = doc.indexOf(text) + 2;
    const view = editor(doc, caret);
    assert.equal(bold(view), true, doc);
    assert.equal(view.state.doc.toString(), doc.replace(text, "**" + text + "**"));
    assert.equal(undo(view), true);
    assert.equal(view.state.doc.toString(), doc);
    assert.equal(view.state.selection.main.head, caret);
    assert.equal(view.state.selection.main.empty, true);
  }
});

test("an empty prose line keeps the insertion point between formatting markers", () => {
  const view = editor("", 0);
  assert.equal(bold(view), true);
  assert.equal(view.state.doc.toString(), "****");
  assert.equal(view.state.selection.main.head, 2);
  assert.ok(view.state.selection.main.empty);
});

test("an explicit selection retains its scope; a complete style wrapper retains its nesting", () => {
  const partial = editor("가운데 단어", 4, 6);
  bold(partial);
  assert.equal(partial.state.doc.toString(), "가운데 **단어**");
  const text = '<span style="color:#abcdef">**회의 내용**</span>';
  const view = editor(text, text.indexOf("회의"));
  bold(view);
  assert.equal(view.state.doc.toString(), '<span style="color:#abcdef">회의 내용</span>');
});

test("line color applies to text without consuming the checkbox", () => {
  const view = editor("- [ ] 예정", 0);
  runSelectionOrLine(view, target => runTextColor(target, "#abcdef"));
  assert.equal(view.state.doc.toString(), '- [ ] <span style="color:#abcdef">예정</span>');
});

test("implicit formatting leaves metadata, code, non-prose lines and read-only or composing views alone", () => {
  for (const [doc, caret] of [
    ["---\ntitle: 노트\n---\n본문", 7], ["\uFEFF---\ntitle: 노트\n---\n본문", 8],
    ["\n```md\n# 코드\n```", 8], ["    코드", 6], ["제목\n===", 4],
    ["---", 2], ["- ", 1], ["   ", 1], ["```\n\n```", 4],
  ]) {
    const view = editor(doc, caret);
    assert.equal(bold(view), false, doc);
    assert.equal(view.state.doc.toString(), doc);
    assert.equal(view.state.selection.main.head, caret);
  }
  assert.equal(bold(editor("읽기 전용", 1, 3, true)), false);
  const composing = editor("한글 입력", 1);
  composing.composing = true;
  assert.equal(bold(composing), false);
});
