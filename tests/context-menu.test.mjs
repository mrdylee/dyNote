import test from "node:test";
import assert from "node:assert/strict";
import { contextMenuTemplate } from "../electron/context-menu.mjs";
test("contenteditable menu uses editor history and formatting; form fields retain native roles", () => {
  const actions=[];
  const menu=contextMenuTemplate({isEditable:true,formControlType:"none",editFlags:{canCopy:true,canPaste:true}},action=>actions.push(action),()=>actions.push("fonts"));
  const submenu=menu.find(item=>item.label==="서식").submenu;
  submenu.find(item=>item.id==="format-bold").click();
  assert.deepEqual(actions,["bold"]);
  const undo=menu.find(item=>item.id==="editor-undo");assert.equal(undo.enabled,true);undo.click();
  assert.deepEqual(actions,["bold","undo"]);
  const field=contextMenuTemplate({isEditable:true,formControlType:"input-text",editFlags:{canUndo:true}},()=>{},()=>{});
  assert.equal(field.find(item=>item.role==="undo").enabled,true);assert.ok(!field.some(item=>item.label==="서식"));
});
test("reading menu cannot cut or paste and offers copy only when available", () => {
  const menu=contextMenuTemplate({isEditable:false,formControlType:"none",editFlags:{canCut:true,canPaste:true,canCopy:true}},()=>{},()=>{});
  assert.equal(menu.find(item=>item.role==="cut").enabled,false);
  assert.equal(menu.find(item=>item.role==="paste").enabled,false);
  assert.equal(menu.find(item=>item.role==="copy").enabled,true);
  assert.ok(!menu.some(item=>item.label==="서식"));
});
