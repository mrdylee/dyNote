import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('');globalThis.window=dom.window;globalThis.document=dom.window.document;
const {default:mermaid}=await import('mermaid');mermaid.initialize({startOnLoad:false,securityLevel:'strict'});
import * as tools from '../core/diagram-tools.mjs';
test('DIAGRAM-01 twenty independently authored samples parse with installed Mermaid',async()=>{
 assert.equal(tools.diagramSamples?.length,20);
 for(const sample of tools.diagramSamples)assert.ok(await mermaid.parse(sample.code),sample.id);
});
test('DIAGRAM-01 insertion distinguishes an existing Mermaid block from plain Markdown',()=>{
 assert.equal(typeof tools.diagramInsertion,'function');
 assert.equal(tools.diagramInsertion('Text',4,'flowchart LR\n A-->B'),'\n```mermaid\nflowchart LR\n A-->B\n```\n');
 assert.equal(tools.diagramInsertion('```mermaid\nflowchart LR\n\n```',23,' A-->B'),' A-->B');
 assert.equal(tools.diagramInsertion('~~~mermaid\nflowchart LR\n',23,' A-->B'),' A-->B');
});
