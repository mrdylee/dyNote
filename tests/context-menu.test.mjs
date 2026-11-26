import test from "node:test";
import assert from "node:assert/strict";
import { fileForElement, fileLocationRef } from "../src/file-location.mjs";
import { contextMenuTemplate } from "../electron/context-menu.mjs";
test("contenteditable menu uses editor history and formatting; form fields retain native roles", () => {
  const actions=[];
  const menu=contextMenuTemplate({isEditable:true,formControlType:"none",editFlags:{canCopy:true,canPaste:true}},action=>actions.push(action),()=>actions.push("fonts"));
  const submenu=menu.find(item=>item.label==="서식").submenu;
  submenu.find(item=>item.id==="format-bold").click();
  assert.deepEqual(actions,["bold"]);
  const undo=menu.find(item=>item.id==="editor-undo");assert.equal(undo.enabled,true);undo.click();
  assert.deepEqual(actions,["bold","undo"]);
  menu.find(item=>item.id==="format-bullet-list").click();
  menu.find(item=>item.id==="format-paragraph").click();
  assert.deepEqual(actions,["bold","undo","bullet-list","paragraph"]);
  const field=contextMenuTemplate({isEditable:true,formControlType:"input-text",editFlags:{canUndo:true}},()=>{},()=>{});
  assert.equal(field.find(item=>item.role==="undo").enabled,true);assert.ok(!field.some(item=>item.label==="서식"));
  assert.ok(!field.some(item=>item.id==="format-bullet-list"||item.id==="format-paragraph"));
});
test("reading menu cannot cut or paste and offers copy only when available", () => {
  const menu=contextMenuTemplate({isEditable:false,formControlType:"none",editFlags:{canCut:true,canPaste:true,canCopy:true}},()=>{},()=>{});
  assert.equal(menu.find(item=>item.role==="cut").enabled,false);
  assert.equal(menu.find(item=>item.role==="paste").enabled,false);
  assert.equal(menu.find(item=>item.role==="copy").enabled,true);
  assert.ok(!menu.some(item=>item.label==="서식"));
});
test("file location is offered only for a file and keeps the edit menu", () => {
  const params = { isEditable: true, formControlType: "none" };
  let clicks = 0;
  const menu = contextMenuTemplate(params, () => {}, () => {}, () => {}, () => clicks++);
  assert.ok(menu.some(item => item.role === "copy"));
  menu.find(item => item.label === "파일 위치 열기").click();
  assert.equal(clicks, 1);
  assert.ok(!contextMenuTemplate(params).some(item => item.label === "파일 위치 열기"));
});
test("workspace sync is available in the editor, form fields and reading view", () => {
  for (const params of [
    { isEditable: true, formControlType: "none" },
    { isEditable: true, formControlType: "input-text" },
    { isEditable: false },
  ]) {
    let calls = 0;
    const menu = contextMenuTemplate(params, () => {}, () => {}, () => calls++);
    const sync = menu.find(item => item.label === "지금 동기화");
    assert.ok(sync);
    sync.click();
    assert.equal(calls, 1);
  }
});

test("only file views registered by the app identify the clicked document", () => {
  const pane = {};
  const content = { parentElement: pane, dataset: { fileLocation: "other.md" } };
  assert.equal(fileForElement(content), null);
  fileLocationRef("original.md")(pane);
  assert.equal(fileForElement(content), "original.md");
  fileLocationRef(null)(pane);
  assert.equal(fileForElement(content), null);
});

test("AI suggestion opens only from an editable Markdown surface", () => {
  const actions = [];
  const item = params => contextMenuTemplate(params, action => actions.push(action)).find(entry => entry.id === "ai-suggestion");
  const common = { isEditable: true, formControlType: "none" };
  assert.equal(item(common), undefined);
  assert.equal(item({ ...common, markdownEditor: true, isEditable: false }), undefined);
  item({ ...common, markdownEditor: true }).click();
  assert.deepEqual(actions, ["ai-suggestion"]);
});
