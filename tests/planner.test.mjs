import test from 'node:test';
import assert from 'node:assert/strict';
import { validDate, parseCapture, parseIdeas, readBoard, writeBoard, registerItems, evidenceIssues, reschedule, normalizeItem } from '../core/planner.mjs';

const item = (extra = {}) => normalizeItem({ id:'one', title:'DV review', target:'Link', stage:'DV', start:'2026-11-20', end:'2026-11-21', ...extra });
test('calendar dates reject rollover and preserve missing years as undated', () => {
  assert.equal(validDate('2024-02-29'), true);
  for (const date of ['2026-02-29','2026-13-01','11/20','2026-2-01']) assert.equal(validDate(date), false);
  const rows = parseCapture(JSON.stringify({items:[{title:'DV',start:null,end:null,uncertainty:'연도 없음',sourceText:'11/20 DV'}]}));
  assert.equal(rows[0].start,''); assert.match(rows[0].uncertainty,/연도/);
  assert.throws(()=>item({end:'2026-11-19'}),/종료/);
});
test('model data is validated; literal tasks never become recommendations', () => {
  const rows=parseCapture('```json\n'+JSON.stringify({items:[{title:'Review',tasks:['시험 준비'],bbox:[0.1,0.2,0.5,0.3]}]})+'\n```');
  assert.equal(rows[0].tasks[0].origin,'source'); assert.equal(rows[0].tasks[0].done,false);
  assert.throws(()=>parseCapture('{"items":[{"title":"","start":"tomorrow"}]}'));
  assert.throws(()=>parseCapture('{"items":{}}'));
  assert.throws(()=>parseIdeas('{"options":[]}'));
  const ideas=parseIdeas(JSON.stringify({options:[{title:'A',reason:'fast',tradeoff:'coverage',tasks:['review']}]}));
  assert.equal(ideas[0].status,'candidate');
});
test('board roundtrip preserves unrelated content and rejects corrupted versions', () => {
  const board={version:1,items:[item()]};
  const text=writeBoard(board,'---\nowner: me\n---\n# Personal notes\nKeep me\n');
  assert.deepEqual(readBoard(text),board); assert.match(text,/owner: me/);assert.match(text,/Keep me/);
  assert.equal(writeBoard(board,text).split('<!-- dynote-planner:start -->').length,2);
  assert.throws(()=>readBoard('---\ndynote_planner: {version: 999, items: []}\n---\n'),/버전/);
  assert.throws(()=>readBoard('# Existing unrelated note'),/일정/);
});
test('registration deduplicates source items without dropping different stages', () => {
  const a=item({source:{path:'_attachments/a.png',hash:'abc',text:'DV review',bbox:null}});
  const result=registerItems({version:1,items:[a]},[a,item({...a,id:'two',stage:'PV'})]);
  assert.equal(result.skipped,1);assert.equal(result.board.items.length,2);
  const reviewed=item({...a,start:'2026-11-19'});
  assert.equal(registerItems({version:1,items:[reviewed]},[a]).skipped,1);
});
test('corrupt persisted boards cannot silently become an empty board',()=>{
  assert.throws(()=>readBoard('---\ndynote_planner: {version: 1}\n---\n'),/일정/);
  assert.throws(()=>readBoard('---\ndynote_planner: {version: 1, items: [{title: Test}]}\n---\n'),/ID/);
});
test('changed evidence does not mean passed and missing links stay visible', () => {
  const row=item({evidence:[{kind:'requirement',path:'REQ.md',revision:'old',status:'unknown'},{kind:'result',path:'result.md',revision:'r',status:'unknown'}]});
  const issues=evidenceIssues(row,[{path:'REQ.md',revision:'new'}]);
  assert.ok(issues.some(i=>i.includes('변경')));assert.ok(issues.some(i=>i.includes('찾을 수')));assert.ok(issues.some(i=>i.includes('시험')));
});
test('rescheduling preserves inclusive duration across month boundaries', () => {
  const moved=reschedule(item({start:'2026-11-29',end:'2026-12-02'}),'2026-12-30');
  assert.equal(moved.end,'2027-01-02');
  assert.throws(()=>reschedule(item(),'2026-02-30'));
});
