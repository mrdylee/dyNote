import test from "node:test";
import assert from "node:assert/strict";
import { sendBlock, defaultCopilotModel } from "../core/copilot-send-state.mjs";
const note={path:"Home.md",content:"현재 노트"};
const ready={connection:{authenticated:true,models:[{id:"auto",name:"Auto"}]},model:"auto",prompt:"요약해 줘",vaultId:"vault",note,scope:"document",mode:"agent",ready:true,blocked:false};
test("current-note prompt becomes sendable; missing vault has an actionable reason",()=>{
  assert.equal(sendBlock(ready),null);
  assert.equal(sendBlock({...ready,vaultId:null}).code,"vault");
  assert.match(sendBlock({...ready,note:null}).message,/현재.*노트|Markdown/);
});
test("Ask can read current note with pending drafts while writing modes remain protected",()=>{
  assert.equal(sendBlock({...ready,mode:"chat",blocked:true,ready:false}),null);
  for(const mode of ["agent","edit"])assert.equal(sendBlock({...ready,mode,blocked:true}).code,"drafts");
});
test("missing/stale model, expired auth and transitional states explain disabled send",()=>{
  assert.equal(sendBlock({...ready,model:"stale"}).code,"model");
  assert.equal(sendBlock({...ready,connection:{authenticated:false,models:[]}}).code,"auth");
  for(const key of ["checking","authBusy","busy","applying","running"])assert.ok(sendBlock({...ready,[key]:true}));
  assert.equal(sendBlock({...ready,prompt:"  "}).code,"prompt");
});
test("selected scope must match the actual current note and document bounds remain enforced",()=>{
  assert.equal(sendBlock({...ready,scope:"selection",selection:{path:"Old.md",source:note.content,from:0,to:2}}).code,"context");
  assert.equal(sendBlock({...ready,note:{...note,content:"x".repeat(65537)}}).code,"context");
});
test("fresh connection uses advertised Auto; valid explicit choice survives refresh",()=>{
  const models=[{id:"other"},{id:"auto"}];
  assert.equal(defaultCopilotModel(models,""),"auto");
  assert.equal(defaultCopilotModel(models,"other"),"other");
  assert.equal(defaultCopilotModel([{id:"other"}],"stale"),"");
});
