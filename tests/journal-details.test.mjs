import test from 'node:test';
import assert from 'node:assert/strict';
import * as tools from '../core/journal-details.mjs';
const clock=new Date(2026,9,27,15,4);
test('JOURNAL-02 timestamps use target-day/current-clock rules and blank-line spacing',()=>{
 assert.equal(typeof tools.timestampInsertion,'function');
 assert.equal(tools.timestampInsertion('',0,'2026-10-27',clock).insert,'— 3:04 오후 —\n\n');
 assert.equal(tools.timestampInsertion('',0,'2020-10-27',clock).insert,'— 10/27/2026 3:04 오후 —\n\n');
 const text='Before\r\nAfter',offset=6;
 const result=tools.timestampInsertion(text,offset,null,clock);
 assert.equal(text.slice(0,offset)+result.insert+text.slice(offset),'Before\r\n\r\n— 10/27/2026 3:04 오후 —\r\n\r\nAfter');
});
test('JOURNAL-02 rating set/remove preserves metadata comments and body bytes',()=>{
 assert.equal(typeof tools.rateJournal,'function');
 const source='---\r\nowner: keep # comment\r\n---\r\n# Journal\r\nText\r\n';
 const rated=tools.rateJournal(source,4);assert.match(rated,/daily rating: 4/);assert.match(rated,/owner: keep # comment/);assert.ok(rated.endsWith('# Journal\r\nText\r\n'));
 assert.doesNotMatch(tools.rateJournal(rated,null),/daily rating/);assert.throws(()=>tools.rateJournal(source,6),/평가/);
});
test('JOURNAL-02 on-this-day includes only valid earlier-year daily notes',()=>{
 assert.equal(typeof tools.onThisDay,'function');
 const notes=['Daily/2020-02-29.md','Daily/2024-02-29.md','Daily/2019-02-29.md','Daily/2028-02-29.md','Other/2020-02-29.md'].map(path=>({path}));
 assert.deepEqual(tools.onThisDay(notes,'2024-02-29',{folder:'Daily'}).map(n=>n.path),['Daily/2020-02-29.md']);
});
test('CORE-02 original mixed-language statistics exclude YAML and count UTF-16 characters',()=>{
 assert.equal(typeof tools.wordStatistics,'function');
 const text='# Hello world\n\n안녕 세상\n😀\n';
 assert.deepEqual(tools.wordStatistics(text),{words:4,characters:24});assert.deepEqual(tools.wordStatistics('---\ntitle: Metadata\n---\n'+text),{words:4,characters:24});
});
