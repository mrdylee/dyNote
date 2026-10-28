import test from 'node:test';
import assert from 'node:assert/strict';
import { validEssTarget, essLabel, noteEssLinks, setEssLink, essMessage } from '../core/ess-links.mjs';

test('ESS targets always include the container and a known device', () => {
  for (const target of ['ess-01/container','ess-06/rack-06','ess-02/bpu-01','ess-03/lcs','ess-04/ebsc','ess-05/switch','ess-06/extended-switch']) assert.equal(validEssTarget(target), true);
  for (const target of [null,{},'rack-01','ess-00/rack-01','ess-07/lcs','ess-01/rack-07','ess-01/../../x','ess-01/lcs\n','ESS-01/LCS']) assert.equal(validEssTarget(target),false);
  assert.equal(essLabel('ess-02/rack-01'),'ESS 02 · RACK 01');
});

test('links preserve Markdown body, YAML comments/properties and separate containers', () => {
  const source='\uFEFF---\r\n# Keep this comment\r\ntitle: "장치 점검"\r\ntags: [ESS]\r\n---\r\n# 점검\r\n본문 그대로\r\n';
  const first=setEssLink(source,'ess-01/rack-01',true);
  const both=setEssLink(first,'ess-02/rack-01',true);
  assert.deepEqual(noteEssLinks(both),['ess-01/rack-01','ess-02/rack-01']);
  assert.ok(both.startsWith('\uFEFF---\r\n'));
  assert.ok(both.endsWith('# 점검\r\n본문 그대로\r\n'));
  assert.match(both,/# Keep this comment/);assert.match(both,/title: "장치 점검"/);assert.match(both,/tags: \[\s*ESS\s*\]/);
  assert.equal(setEssLink(both,'ess-01/rack-01',true),both);
  const remaining=setEssLink(both,'ess-01/rack-01',false);
  assert.deepEqual(noteEssLinks(remaining),['ess-02/rack-01']);
  assert.deepEqual(noteEssLinks(setEssLink(remaining,'ess-02/rack-01',false)),[]);
  const renamed={path:'Moved/Renamed.md',content:both};
  assert.deepEqual(noteEssLinks(renamed.content),noteEssLinks(both));
});

test('plain notes and scalar links round trip; corrupt metadata is never silently replaced', () => {
  const source='# 문서\n그대로\n';
  assert.ok(setEssLink(source,'ess-06/lcs',true).endsWith(source));
  assert.deepEqual(noteEssLinks('---\ness_links: ess-01/lcs\n---\nBody'),['ess-01/lcs']);
  for(const bad of ['---\na: [broken\n---\nBody','---\ness_links: 42\n---\nBody','---\ness_links: [ess-01/lcs, unknown]\n---\nBody','---\nx: &x 4\ny: *x\n---\nBody']) assert.throws(()=>setEssLink(bad,'ess-01/lcs',true));
  assert.throws(()=>setEssLink(source,'ess-09/rack-01',true));
  assert.deepEqual(noteEssLinks('---\ness_links: 42\n---\nBody'),[]);
});

test('frame messages require exact source, origin, channel and target schema', () => {
  const source={},origin='notes://ess';
  const event={source,origin,data:{channel:'dynote-ess',type:'select',target:'ess-02/rack-01',activate:true}};
  assert.deepEqual(essMessage(event,source,origin),{type:'select',target:'ess-02/rack-01',activate:true});
  for(const bad of [{...event,source:{}},{...event,origin:'notes://app'},{...event,data:{...event.data,target:'ess-99/lcs'}},{...event,data:{...event.data,activate:'true'}},{...event,data:{...event.data,channel:'other'}},{...event,data:{type:'open-note',path:'/private/x'}}])assert.equal(essMessage(bad,source,origin),null);
  assert.deepEqual(essMessage({...event,data:{channel:'dynote-ess',type:'ready'}},source,origin),{type:'ready'});
});
