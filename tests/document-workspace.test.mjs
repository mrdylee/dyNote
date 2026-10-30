import test from 'node:test';
import assert from 'node:assert/strict';
const workspace = await import('../core/document-workspace.mjs').catch(() => ({}));
const journal = await import('../core/journal-start.mjs').catch(() => ({}));
test('workspace opens at most three unique documents and focuses existing panes', () => {
  assert.equal(typeof workspace.workspaceAction, 'function');
  let state = workspace.workspaceAction(null, {type:'open',path:'A.md'});
  for (const path of ['B.md','C.md','D.md']) state = workspace.workspaceAction(state,{type:'add',path,side:'right'});
  assert.deepEqual(state.paths,['A.md','B.md','C.md']);
  state = workspace.workspaceAction(state,{type:'add',path:'A.md',side:'right'});
  assert.equal(state.active,'A.md');
  assert.deepEqual(state.paths,['A.md','B.md','C.md']);
  state = workspace.workspaceAction(state,{type:'mode',mode:'edit'});
  state = workspace.workspaceAction(state,{type:'open',path:'B.md'});
  assert.equal(state.modes['A.md'],'edit');
  state = workspace.workspaceAction(state,{type:'close',path:'B.md'});
  assert.deepEqual(state.paths,['A.md','C.md']);
  state = workspace.workspaceAction(state,{type:'reconcile',paths:['C.md','X.md']});
  assert.deepEqual(state.paths,['C.md']);
  assert.equal(state.active,'C.md');
});
test('opening a new document replaces only the focused pane, invalid drops change nothing', () => {
  assert.equal(typeof workspace.workspaceAction,'function');
  let state={paths:['A.md','B.md'],active:'A.md',modes:{}};
  state=workspace.workspaceAction(state,{type:'open',path:'C.md'});
  assert.deepEqual(state.paths,['C.md','B.md']);
  assert.deepEqual(workspace.workspaceAction(state,{type:'add',path:'photo.png',side:'right'}),state);
});
test('journal defaults preserve explicit settings and discover legacy root dates', () => {
  assert.equal(typeof journal.journalPreferences,'function');
  assert.equal(journal.journalPreferences(null,[]).daily.folder,'Journal');
  assert.equal(journal.journalPreferences({daily:{folder:''}},[]).daily.folder,'');
  assert.equal(journal.journalPreferences(null,[{path:'2026-10-29.md'}]).daily.folder,'');
  assert.equal(journal.journalPreferences({daily:{folder:'일기',format:'YYYY.MM.DD'}},[]).daily.format,'YYYY.MM.DD');
});
