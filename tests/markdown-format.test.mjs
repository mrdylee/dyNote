import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { renderMarkdown } from "../core/knowledge.mjs";
import { history, undo, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { runBulletFormat, runMarkdownFormat } from "../src/editorCommands.mjs";

function editor(doc, anchor, head = anchor, readOnly = false) {
  const view = { state: EditorState.create({doc, selection: {anchor, head}, extensions: [history(), markdown({base: markdownLanguage}), EditorState.readOnly.of(readOnly)]}),
    dispatch: spec => { view.state = view.state.update(spec).state; }, focus() {} };
  return view;
}
for (const [format, marker] of [["bold", "**"], ["italic", "*"], ["strike", "~~"], ["code", "`"]]) {
  test(`${format} preserves selection and toggles with one-step undo/redo`, () => {
    const view = editor("앞 한글 뒤", 2, 4);
    assert.equal(runMarkdownFormat(view, format), true);
    assert.equal(view.state.doc.toString(), `앞 ${marker}한글${marker} 뒤`);
    assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "한글");
    assert.equal(undo(view), true); assert.equal(view.state.doc.toString(), "앞 한글 뒤");
    assert.equal(redo(view), true); runMarkdownFormat(view, format);
    assert.equal(view.state.doc.toString(), "앞 한글 뒤");
    const selected = editor(`${marker}한글${marker}`, 0, marker.length * 2 + 2);
    runMarkdownFormat(selected, format); assert.equal(selected.state.doc.toString(), "한글");
  });
}
test("empty insertion positions cursor between markers; read-only and unknown actions cannot edit", () => {
  const view = editor("", 0); runMarkdownFormat(view, "bold");
  assert.equal(view.state.doc.toString(), "****"); assert.equal(view.state.selection.main.head, 2);
  assert.equal(runMarkdownFormat(view, "unknown"), false);
  const locked = editor("private", 0, 7, true);
  assert.equal(runMarkdownFormat(locked, "bold"), false); assert.equal(locked.state.doc.toString(), "private");
});
test("inline code uses a fence longer than existing backticks and toggles it", () => {
  const view = editor("a`b", 0, 3); runMarkdownFormat(view, "code");
  assert.equal(view.state.doc.toString(), "``a`b``");
  runMarkdownFormat(view, "code"); assert.equal(view.state.doc.toString(), "a`b");
});
test("separate selections retain their own content and undo together", () => {
  const view = editor("one two", 0, 3);
  view.state = EditorState.create({doc:"one two", selection:EditorSelection.create([EditorSelection.range(0,3),EditorSelection.range(4,7)]), extensions:[history(),EditorState.allowMultipleSelections.of(true)]});
  runMarkdownFormat(view, "bold"); assert.equal(view.state.doc.toString(), "**one** **two**");
  undo(view); assert.equal(view.state.doc.toString(), "one two");
});

test("italic toggles inside bold while preserving bold markers", () => {
  const view=editor("**한글**",2,4);
  runMarkdownFormat(view,"italic");assert.equal(view.state.doc.toString(),"***한글***");
  runMarkdownFormat(view,"italic");assert.equal(view.state.doc.toString(),"**한글**");
  const selected=editor("***한글***",0,8);runMarkdownFormat(selected,"italic");assert.equal(selected.state.doc.toString(),"**한글**");
});
test("word selection with boundary whitespace produces valid Markdown formatting", () => {
  const view=editor(" 한글 ",0,4);runMarkdownFormat(view,"bold");
  assert.equal(view.state.doc.toString()," **한글** ");
  assert.equal(view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),"한글");
});

test("bullet conversion preserves soft lines, frontmatter, headings and code", () => {
  const text = "\uFEFF---\ntitle: Example\n---\n\n# Heading\n\nFirst line\nsoft line\n\n```md\n- Code\n```\n";
  const bullets = text.replace("First line\nsoft line", "- First line\n  soft line");
  const view = editor(text, 0, text.length);
  assert.equal(runBulletFormat(view, "bullet-list"), true);
  assert.equal(view.state.doc.toString(), bullets);
  assert.equal(runBulletFormat(view, "paragraph"), true);
  assert.equal(view.state.doc.toString(), text);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), bullets);
});

test("task-like plain text becomes an ordinary bullet and returns to the original paragraph", () => {
  for (const text of ["[x] 확인 사항", "[ ] 초안 메모", "[X] 완료 표기"]) {
    const view = editor(text, text.length);
    assert.equal(runBulletFormat(view, "bullet-list"), true);
    assert.equal(view.state.doc.toString(), "- \\" + text);
    assert.equal(runBulletFormat(view, "paragraph"), true);
    assert.equal(view.state.doc.toString(), text);
  }
});

test("removing a parent bullet promotes its child list without changing task or numbered markers", () => {
  const text = "- Root\n  - Parent\n    - Child\n      - [x] Task\n  - Sibling\n\n1. Numbered\n";
  const view = editor(text, text.indexOf("Parent"));
  assert.equal(runBulletFormat(view, "paragraph"), true);
  assert.equal(view.state.doc.toString(), "- Root\n\n  Parent\n\n  - Child\n    - [x] Task\n  - Sibling\n\n1. Numbered\n");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), text);
  const selected = editor(text, text.indexOf("Parent"), text.indexOf("Task") + 4);
  assert.equal(runBulletFormat(selected, "paragraph"), true);
  assert.equal(selected.state.doc.toString(), "- Root\n\n  Parent\n\n  Child\n\n  - [x] Task\n  - Sibling\n\n1. Numbered\n");
});

for (const [format, tag] of [["bold", "strong"], ["italic", "em"], ["strike", "s"]]) {
  test(`multiline ${format} renders on selected prose without changing block syntax`, () => {
    const doc = ["---", "title: 메모", "---", "", "# 제목", "", "- [ ] 첫째", "- 둘째", "", "```md", "# 예시", "```", "", "마지막 문단"].join("\n");
    const end = doc.indexOf(" 문단");
    const view = editor(doc, end, 0);
    assert.equal(runMarkdownFormat(view, format), true);
    const formatted = view.state.doc.toString();
    const html = renderMarkdown(formatted, [], "메모.md");
    for (const part of ["제목", "첫째", "둘째", "마지막"]) assert.ok(html.includes(`<${tag}>${part}</${tag}>`), html);
    assert.ok(formatted.startsWith("---\ntitle: 메모\n---\n"));
    assert.ok(formatted.includes("```md\n# 예시\n```"));
    assert.ok(formatted.endsWith(" 문단"));
    assert.match(html, /<input[^>]*type="checkbox"/);
    assert.ok(view.state.selection.main.anchor > view.state.selection.main.head);
    runMarkdownFormat(view, format);
    assert.equal(view.state.doc.toString(), doc);
    undo(view);
    assert.equal(view.state.doc.toString(), formatted);
    undo(view);
    assert.equal(view.state.doc.toString(), doc);
    assert.equal(view.state.selection.main.anchor, end);
    assert.equal(view.state.selection.main.head, 0);
  });
}

test("multiline formatting fills mixed styles and stops at a trailing line boundary", () => {
  const doc = "**기존**\n일반\n끝";
  const view = editor(doc, 0, doc.indexOf("끝"));
  runMarkdownFormat(view, "bold");
  assert.equal(view.state.doc.toString(), "**기존**\n**일반**\n끝");
});

for (const [format, marker, tag] of [["bold", "**", "strong"], ["italic", "*", "em"], ["strike", "~~", "s"]]) {
  test(`applying ${format} across separately styled words includes the plain words between them`, () => {
    const plain = "하나 중간 둘";
    const line = marker + "하나" + marker + " 중간 " + marker + "둘" + marker;
    const source = line + "\n\n다음 줄";
    const view = editor(source, 0, source.length);
    assert.ok(runMarkdownFormat(view, format));
    const saved = view.state.doc.toString();
    assert.equal(saved, marker + plain + marker + "\n\n" + marker + "다음 줄" + marker);
    assert.ok(renderMarkdown(saved, [], "메모.md").includes(`<${tag}>${plain}</${tag}>`));
    assert.ok(undo(view));
    assert.equal(view.state.doc.toString(), source);
  });
}

test("toggling existing underscore and nested emphasis removes only the requested marks", () => {
  for (const [source, format, expected] of [
    ["__메모__", "bold", "메모"], ["_메모_", "italic", "메모"], ["***메모***", "bold", "*메모*"]
  ]) {
    const view = editor(source, 0, source.length);
    runMarkdownFormat(view, format);
    assert.equal(view.state.doc.toString(), expected);
  }
});
