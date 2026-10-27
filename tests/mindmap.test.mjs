import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as tools from '../core/mindmap.mjs';
const basic='---\r\nmindmap-plugin: basic\r\nowner: keep\r\n---\r\n# Root\r\n\r\nProse stays.\r\n\r\n## First ^stable\r\n- Child\r\n## Second\r\n';
const rich=await readFile(new URL('./fixtures/markmind-rich.md',import.meta.url),'utf8');
test('MAP-01 parses heading/list parents and edits only selected node preserving CRLF, prose and block ID',()=>{
 assert.equal(typeof tools.parseMindmap,'function');
 const model=tools.parseMindmap(basic);assert.equal(model.kind,'basic');
 const first=model.nodes.find(n=>n.text==='First'),child=model.nodes.find(n=>n.text==='Child');
 assert.equal(child.parent,first.id);
 const changed=tools.editMindmap(basic,first.id,'rename','Renamed');
 assert.equal(changed.content,basic.replace('First ^stable','Renamed ^stable'));
 const added=tools.editMindmap(changed.content,first.id,'add-child','Added');
 const parsed=tools.parseMindmap(added.content);assert.equal(parsed.nodes.find(n=>n.text==='Added').parent,first.id);
 assert.match(added.content,/owner: keep\r\n/);assert.match(added.content,/Prose stays\./);
 const removed=tools.editMindmap(basic,first.id,'delete');assert.doesNotMatch(removed.content,/First|Child/);assert.match(removed.content,/Second/);
});
test('MAP-02 original generated rich format roundtrips edits and preserves unknown fields',()=>{
 assert.equal(typeof tools.parseMindmap,'function');
 const model=tools.parseMindmap(rich);assert.equal(model.kind,'rich');assert.equal(model.nodes.length,4);
 const first=model.nodes.find(n=>n.text==='First'),child=model.nodes.find(n=>n.text==='Child');assert.equal(child.parent,first.id);
 const renamed=tools.editMindmap(rich,first.id,'rename','Updated');
 const parsed=tools.parseMindmap(renamed.content);assert.equal(parsed.nodes.find(n=>n.id===first.id).text,'Updated');
 assert.deepEqual(parsed.data.opt,model.data.opt);assert.deepEqual(parsed.data.relateLinkData,model.data.relateLinkData);
 const moved=tools.editMindmap(renamed.content,first.id,'move',{x:12,y:34});const movedNode=tools.parseMindmap(moved.content).nodes.find(n=>n.id===first.id);
 assert.equal(movedNode.x,12);assert.equal(movedNode.y,34);assert.deepEqual(movedNode.raw.style,first.raw.style);
 assert.throws(()=>tools.editMindmap(rich,first.id,'move',{x:Infinity,y:0}),/위치/);
});
test('MAP-02 malformed and cyclic rich data fail visibly instead of producing an empty replacement',()=>{
 assert.equal(typeof tools.parseMindmap,'function');
 assert.throws(()=>tools.parseMindmap('---\nmindmap-plugin: rich\n---\n```json\n{broken}\n```'),/JSON/);
 const bad='---\nmindmap-plugin: rich\n---\n```json\n'+JSON.stringify({mindData:[[{id:'a',pid:'b',text:'A'},{id:'b',pid:'a',text:'B'}]]})+'\n```';
 assert.throws(()=>tools.parseMindmap(bad),/순환/);
});
test('MAP-01/02 conversions preserve hierarchy and original metadata',()=>{
 assert.equal(typeof tools.convertMindmap,'function');
 const converted=tools.convertMindmap(basic,'rich');assert.equal(tools.parseMindmap(converted).kind,'rich');
 const restored=tools.convertMindmap(converted,'basic');const nodes=tools.parseMindmap(restored).nodes;
 assert.equal(nodes.find(n=>n.text==='Child').parent,nodes.find(n=>n.text==='First').id);
 assert.match(restored,/owner: keep/);assert.equal(tools.parseMindmap(basic).kind,'basic');
});

test('MAP-02 deleting a decorated rich subtree leaves unsupported relationships untouched',()=>{
 const model=tools.parseMindmap(rich),first=model.nodes.find(n=>n.text==='First');
 model.data.relateLinkData=[{startNodeId:first.id,endNodeId:model.nodes[0].id,custom:'keep'}];
 const decorated=rich.slice(0,model.jsonFrom)+JSON.stringify(model.data)+rich.slice(model.jsonTo);
 assert.throws(()=>tools.editMindmap(decorated,first.id,'delete'),/장식/);
 assert.equal(tools.parseMindmap(decorated).data.relateLinkData[0].custom,'keep');
});
