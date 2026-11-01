import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {captureContext,prepareRequest,applyProposal} from '../core/copilot.mjs';
const journal=await import('../src/journal-outline.mjs').catch(()=>({}));
function editor(doc,anchor=doc.length,readonly=false){
 let state=EditorState.create({doc,selection:{anchor},extensions:[markdown(),history(),EditorState.readOnly.of(readonly)]});
 return {get state(){return state;},dispatch(spec){state=state.update(spec).state;},focus(){},composing:false};
}
function run(name,view,...args){assert.equal(typeof journal[name],'function');return journal[name](view,...args);}
test('journal Enter continues sibling blocks, split content and unchecked tasks',()=>{
 for(const [before,anchor,after]of [['- Parent',8,'- Parent\n- '],['- AlphaBeta',7,'- Alpha\n- Beta'],['- [x] Done',10,'- [x] Done\n- [ ] ']]){
  const view=editor(before,anchor);assert.equal(run('journalEnter',view),true);assert.equal(view.state.doc.toString(),after);
 }
});
test('journal Enter on a parent inserts a child and preserves existing child ownership',()=>{
 const before='- Parent\n  - Existing\n- Other',view=editor(before,8);
 assert.equal(run('journalEnter',view),true);
 assert.equal(view.state.doc.toString(),'- Parent\n  - \n  - Existing\n- Other');
 assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),before);
});
test('splitting a parent in the middle retains its existing children and next siblings',()=>{
 const cases=[
  ['- AlphaBeta\n  - Decision\n- Other','- Alpha\n  - Beta\n  - Decision\n- Other'],
  ['- Root\n  - AlphaBeta\n    - Decision\n      - Task\n  - Peer','- Root\n  - Alpha\n    - Beta\n    - Decision\n      - Task\n  - Peer'],
 ];
 for(const [before,after]of cases){
  const view=editor(before,before.indexOf('Beta'));
  assert.equal(run('journalEnter',view),true);assert.equal(view.state.doc.toString(),after);
  assert.equal(view.state.selection.main.head,after.indexOf('Beta'));
  assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),before);
 }
});
test('Enter inside the list marker retains the prior Markdown behavior',()=>{
 const before='- AlphaBeta\n  - Decision',view=editor(before,1);
 assert.equal(run('journalEnter',view),true);assert.equal(view.state.doc.toString(),'-\n-  AlphaBeta\n  - Decision');
});
test('journal Enter on an empty nested block returns to the parent level',()=>{
 const view=editor('- Parent\n  - ');assert.equal(run('journalEnter',view),true);assert.equal(view.state.doc.toString(),'- Parent\n- ');
});
test('journal Shift Enter keeps a continuation inside its block',()=>{
 const view=editor('- Parent\n  - Child');assert.equal(run('journalSoftBreak',view),true);assert.equal(view.state.doc.toString(),'- Parent\n  - Child\n    ');
});
test('journal Tab on the first root is consumed without inserting literal tabs',()=>{
 const view=editor('- Root');assert.equal(run('journalIndent',view,'indent'),true);assert.equal(view.state.doc.toString(),'- Root');
});
test('journal Tab and Shift Tab move descendants together with one-step undo',()=>{
 const before='- A\n- B\n  - C',view=editor(before,6);
 assert.equal(run('journalIndent',view,'indent'),true);assert.equal(view.state.doc.toString(),'- A\n  - B\n    - C');
 assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),before);
 run('journalIndent',view,'indent');run('journalIndent',view,'outdent');assert.equal(view.state.doc.toString(),before);
});
test('journal indentation from a continuation moves the owning block and keeps the cursor with its text',()=>{
 const before='- A\n- B\n  Continuation\n  - Child',pos=before.indexOf('Continuation')+4,view=editor(before,pos);
 run('journalIndent',view,'indent');
 assert.equal(view.state.doc.toString(),'- A\n  - B\n    Continuation\n    - Child');
 assert.equal(view.state.doc.sliceString(view.state.selection.main.head-4,view.state.selection.main.head),'Cont');
 run('journalIndent',view,'outdent');assert.equal(view.state.doc.toString(),before);assert.equal(view.state.selection.main.head,pos);
});
test('journal commands exclude prose, YAML, fenced and indented code, read-only and composition',()=>{
 for(const doc of ['plain','---\n- metadata\n---\n','\ufeff---\n- metadata\n---\n','```md\n- code\n```','~~~\n- code\n~~~','    - code']){
  const pos=doc.includes('- ')?doc.indexOf('- ')+2:doc.length;
  for(const name of ['journalEnter','journalSoftBreak','journalIndent']){const view=editor(doc,pos);assert.equal(run(name,view,'indent'),false,doc);assert.equal(view.state.doc.toString(),doc);}
 }
 for(const name of ['journalEnter','journalSoftBreak','journalIndent','addJournalBlock']){
  const view=editor('- Root',6,true);assert.equal(run(name,view,'indent'),false);assert.equal(view.state.doc.toString(),'- Root');
  const composing=editor('- Root');composing.composing=true;assert.equal(run(name,composing,'indent'),false);assert.equal(composing.state.doc.toString(),'- Root');
 }
});
test('adding a journal block preserves old prose until an explicit undoable action',()=>{
 const before='# Old journal\n\nKeep this prose.',view=editor(before);
 assert.equal(run('addJournalBlock',view),true);assert.equal(view.state.doc.toString(),before+'\n- ');
 assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),before);
});
test('AI context and edit application retain raw parent/child Markdown and CRLF',()=>{
 const content='# Journal\r\n\r\n- Project A\r\n  - Decision A\r\n    - Pending task\r\n- Project B\r\n',note={path:'Journal/2026-11-01.md',content};
 const captured=captureContext({vaultId:'test',note,scope:'document'});
 const request=prepareRequest({requestId:'outline-context',vaultId:'test',mode:'edit',model:'test',prompt:'Organize the task under its project',context:captured.context,history:[]});
 assert.equal(request.context.content,content);
 const replacement=content.replace('Pending task','Confirmed task').replace(/\r\n/g,'\n');
 assert.equal(applyProposal(captured.target,{vaultId:'test',...note},replacement),content.replace('Pending task','Confirmed task'));
});
