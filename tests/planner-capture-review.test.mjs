import test from 'node:test';
import assert from 'node:assert/strict';
import * as planner from '../core/planner.mjs';

const source={path:'_attachments/capture.jpg',hash:'source-hash'};
const rawRow=(title,extra={})=>({title,target:'LCS',stage:title,sourceText:title,start:'',end:'',...extra});
const payload=items=>JSON.stringify({items});
const audit=groups=>JSON.stringify({groups});

test('99 capture items retain all rows in review pages of 60 while single-batch bounds remain',()=>{
  const input=Array.from({length:99},(_,i)=>rawRow(`일정 ${i+1}`));
  const items=planner.parseCaptureBatches(payload(input),source);
  assert.equal(items.length,99);assert.equal(new Set(items.map(i=>i.id)).size,99);
  assert.equal(planner.captureReviewPage(items,0).length,60);
  assert.equal(planner.captureReviewPage(items,60).length,39);
  assert.equal(planner.captureReviewPage(items,98).at(-1).title,'일정 99');
  assert.equal(items[98].source.hash,'source-hash');
  assert.throws(()=>planner.parseCapture(payload(input.slice(0,61))),/일정/);
});

test('multi-batch parsing preserves board and response limits and rejects invalid rows without dropping them',()=>{
  assert.throws(()=>planner.parseCaptureBatches(payload(Array.from({length:501},()=>rawRow('일정')))),/500/);
  assert.throws(()=>planner.parseCaptureBatches('x'.repeat(128*1024+1)),/크기/);
  assert.throws(()=>planner.parseCaptureBatches('{"items":{}}'),/일정/);
  assert.throws(()=>planner.parseCaptureBatches(payload([...Array.from({length:60},()=>rawRow('정상')),rawRow('오류',{start:'2026-02-30'})])),/날짜/);
});

test('source-row audit identifies missing labels and merged PD/PV instead of accepting a partial result',()=>{
  const input=audit([{target:'LCS',labels:['LCS CV 품평회','LCS DV 품평회','LCS PD 품평회','LCS PV 품평회'],items:[rawRow('LCS DV 품평회'),rawRow('LCS PD·PV 품평회',{sourceText:'LCS PD 품평회 LCS PV 품평회'})]}]);
  const result=planner.parseCaptureAudit(input,source,[]);
  assert.equal(result.items.length,2);
  assert.deepEqual(result.groups[0].missing,['LCS CV 품평회']);
  assert.equal(result.groups[0].merged.length,1);
  assert.ok(result.groups[0].ids.every(id=>result.items.some(item=>item.id===id)));
});

test('audit does not silently discard initial candidates absent from its corrected response',()=>{
  const previous=planner.parseCapture(payload([rawRow('LCS CV 품평회')]),source);
  const result=planner.parseCaptureAudit(audit([{target:'LCS',labels:['LCS CV 품평회','LCS DV 품평회'],items:[rawRow('LCS DV 품평회')]}]),source,previous);
  assert.equal(result.items.length,2);
  assert.ok(result.items.some(i=>i.id===previous[0].id));
  assert.deepEqual(result.groups[0].retained,[previous[0].id]);
  assert.deepEqual(result.groups[0].missing,[]);
});

test('audit replaces one merged candidate with its separate atomic milestones',()=>{
  const previous=planner.parseCapture(payload([rawRow('LCS PD·PV 품평회',{sourceText:'LCS PD 품평회 LCS PV 품평회'})]),source);
  const result=planner.parseCaptureAudit(audit([{target:'LCS',labels:['LCS PD 품평회','LCS PV 품평회'],items:[rawRow('LCS PD 품평회'),rawRow('LCS PV 품평회')]}]),source,previous);
  assert.equal(result.items.length,2);assert.deepEqual(result.groups[0].merged,[]);assert.deepEqual(result.groups[0].retained,[]);
  assert.ok(result.items.every(i=>i.source.path===source.path));
});

test('audit rejects missing row inventory, missing labels and aggregate overflow',()=>{
  assert.throws(()=>planner.parseCaptureAudit('{"items":[]}',source,[]),/대상|행|대조/);
  assert.throws(()=>planner.parseCaptureAudit(audit([{target:'LCS',items:[rawRow('DV')]}]),source,[]),/라벨|원문|대조/);
  assert.throws(()=>planner.parseCaptureAudit(audit([{target:'LCS',labels:['DV'],items:Array.from({length:501},()=>rawRow('DV'))}]),source,[]),/500/);
});

test('audit context contains only current capture labels and refuses oversized context',()=>{
  const rows=planner.parseCapture(payload([rawRow('LCS DV 품평회')]),source);
  const context=planner.captureAuditContext(rows);
  assert.ok(context.includes('LCS DV 품평회'));assert.equal(context.includes('_attachments'),false);
  assert.throws(()=>planner.captureAuditContext(Array.from({length:40},()=>({...rows[0],source:{...source,text:'가'.repeat(2000)}}))),/64KB/);
});

test('exact short source labels are reconciled without duplicate retained candidates',()=>{
  const rows=[rawRow('CV'),rawRow('DV')];
  const previous=planner.parseCapture(payload(rows),source);
  const result=planner.parseCaptureAudit(audit([{target:'LCS',labels:['CV','DV'],items:rows}]),source,previous);
  assert.equal(result.items.length,2);assert.deepEqual(result.groups[0].retained,[]);
});

test('overlapping source labels use the longest match instead of reporting a false merge',()=>{
  const result=planner.parseCaptureAudit(audit([{target:'LCS',labels:['일정 1','일정 10'],items:[rawRow('일정 1'),rawRow('일정 10')]}]),source,[]);
  assert.deepEqual(result.groups[0].missing,[]);assert.deepEqual(result.groups[0].merged,[]);
  const missing=planner.parseCaptureAudit(audit([{target:'LINK',labels:['CV 시험','LINK CV 시험 시작'],items:[rawRow('LINK CV 시험 시작')]}]),source,[]);
  assert.deepEqual(missing.groups[0].missing,['CV 시험']);assert.deepEqual(missing.groups[0].merged,[]);
});
