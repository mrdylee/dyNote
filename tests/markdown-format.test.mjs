import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { runMarkdownFormat } from "../src/editorCommands.mjs";

function editor(doc, anchor, head = anchor, readOnly = false) {
  const view = { state: EditorState.create({doc, selection: {anchor, head}, extensions: [history(), EditorState.readOnly.of(readOnly)]}),
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
