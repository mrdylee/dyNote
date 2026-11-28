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

test('new Markdown panes default to live preview while explicit modes survive navigation',()=>{
 let state=workspace.workspaceAction(null,{type:'open',path:'General.md'});assert.equal(state.modes['General.md'],'live');
 state=workspace.workspaceAction(state,{type:'mode',mode:'read'});state=workspace.workspaceAction(state,{type:'add',path:'Journal/2026-11-04.md',side:'right'});assert.equal(state.modes['Journal/2026-11-04.md'],'live');
 state=workspace.workspaceAction(state,{type:'open',path:'General.md'});assert.equal(state.modes['General.md'],'read');
 state=workspace.workspaceAction(state,{type:'reset',path:'Other.md'});assert.equal(state.modes['Other.md'],'live');
});

test('finishing a folder rename maps the current panes and their saved view modes', () => {
  const vaultId = '1111111111111111', other = '2222222222222222';
  const key = (path, id = vaultId) => workspace.documentKey(id, path);
  const paths = [key('Old/note.md'), key('Older/note.md'), key('Old/note.md', other)];
  const modes = { [paths[0]]: 'edit', [key('New/note.md')]: 'read', [key('Old/closed.md')]: 'read', [paths[2]]: 'live' };
  const action = { type: 'rename-tree', vaultId, from: 'Old', to: 'New' };
  for (const active of paths) {
    const updated = workspace.workspaceAction({ paths, modes, active }, action);
    assert.deepEqual(updated.paths, [key('New/note.md'), ...paths.slice(1)]);
    assert.equal(updated.active, active === paths[0] ? key('New/note.md') : active);
    assert.deepEqual(updated.modes, { [key('New/note.md')]: 'edit', [key('New/closed.md')]: 'read', [paths[2]]: 'live' });
  }
});

test('a saved layout keeps available tabs and panes when the active file or its vault is gone', () => {
  const id = '1111111111111111', key = name => workspace.documentKey(id, name);
  const gone = workspace.documentKey('2222222222222222', 'Left.md');
  const left = key('Left.md'), right = key('Right.md'), hidden = key('Hidden.md');
  const vaults = { [id]: { id, notes: ['Left.md','Right.md','Hidden.md'].map(path => ({path})) } };
  const saved = {tabs:[hidden,right,gone,left], paths:[left,gone,right], active:gone,
    widths:{[left]:255,[gone]:360}, modes:{[right]:'split',[gone]:'read'}, viewingDocuments:true};
  assert.deepEqual(workspace.documentSession(saved, vaults), {
    tabs:[hidden,right,left], paths:[left,right], active:left, widths:{[left]:255}, modes:{[right]:'split'}, viewingDocuments:true,
  });
  assert.equal(workspace.documentSession(saved, {}), null);
});
