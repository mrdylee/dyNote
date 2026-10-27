import test from 'node:test';
import assert from 'node:assert/strict';
import * as periodic from '../core/periodic-notes.mjs';
import * as navigation from '../core/navigation.mjs';

test('JOURNAL-01 local period paths and bracket literals match original default naming', () => {
  assert.equal(typeof periodic.periodicNote, 'function', 'period path service is implemented');
  const {periodicNote}=periodic;
  assert.equal(periodicNote('daily','2026-10-27',{folder:'Daily'}).path,'Daily/2026-10-27.md');
  assert.equal(periodicNote('quarterly','2026-10-27').path,'2026-Q4.md');
  assert.equal(periodicNote('yearly','2026-10-27').path,'2026.md');
  assert.equal(periodicNote('monthly','2026-10-27',{folder:'Journal',format:'YYYY/[Month] MM'}).path,'Journal/2026/Month 10.md');
  assert.equal(periodicNote('daily','2024-02-29').path,'2024-02-29.md');
  assert.throws(()=>periodicNote('daily','2025-02-29'), /날짜/);
  assert.throws(()=>periodicNote('daily','2026-10-27',{folder:'../private'}), /경로/);
});
test('JOURNAL-01 locale week-year and ISO tokens differ at year boundaries without global locale changes', () => {
  assert.equal(typeof periodic.periodicNote, 'function');
  assert.equal(periodic.periodicNote('weekly','2021-01-01',{locale:'en'}).path,'2021-W01.md');
  assert.equal(periodic.periodicNote('weekly','2021-01-01',{locale:'en-gb'}).path,'2020-W53.md');
  assert.equal(periodic.periodicNote('weekly','2021-01-01',{locale:'en',format:'GGGG-[W]WW'}).path,'2020-W53.md');
});
test('TEMPLATE-01 historical date and current time use separate clocks and preserve CRLF', () => {
  assert.equal(typeof periodic.renderTemplate,'function');
  const p=periodic.periodicNote('daily','2024-02-29');
  const now=new Date(2026,9,27,15,4);
  assert.equal(periodic.renderTemplate('{{title}}\r\n{{date}} / {{date:YYYY/MM/DD}} / {{time:HH:mm}}\r\n{{date+1d:YYYY-MM-DD}} / {{yesterday}}',p,now),
    '2024-02-29\r\n2024-02-29 / 2024/02/29 / 15:04\r\n2024-03-01 / 2024-02-28');
});
test('JOURNAL-01 next/previous navigate existing notes only, not missing periods', () => {
  assert.equal(typeof periodic.periodicEntries,'function');
  const notes=['2026-10-04.md','2026-10-01.md','2026-10-02 draft.md','2026-02-30.md'].map(path=>({path}));
  const entries=periodic.periodicEntries(notes,'daily',{});
  assert.deepEqual(entries.map(n=>n.path),['2026-10-01.md','2026-10-04.md']);
  assert.equal(periodic.adjacentEntry(entries,'2026-10-01.md',1)?.path,'2026-10-04.md');
  assert.equal(periodic.adjacentEntry(entries,'2026-10-01.md',-1),null);
});
test('NAV-01 visits deduplicate, cap at 50, rename/delete reconcile both lists', () => {
  assert.equal(typeof navigation.navigationAction,'function');
  let state={recent:[],bookmarks:[]};
  const action=navigation.navigationAction;
  for(let i=0;i<55;i++)state=action(state,{type:'visit',path:`${i}.md`});
  assert.equal(state.recent.length,50);
  state=action(state,{type:'bookmark',path:'54.md'});
  state=action(state,{type:'visit',path:'50.md'});
  state=action(state,{type:'rename',from:'54.md',to:'Renamed.md'});
  assert.equal(state.recent[0],'50.md');
  assert.deepEqual(state.bookmarks,['Renamed.md']);
  state=action(state,{type:'remove',path:'50.md'});
  state=navigation.reconcileNavigation(state,['Renamed.md']);
  assert.deepEqual(state,{recent:['Renamed.md'],bookmarks:['Renamed.md']});
  assert.deepEqual(navigation.normalizeNavigation({recent:['A.md','A.md',null],bookmarks:[]}),{recent:['A.md'],bookmarks:[]});
});
