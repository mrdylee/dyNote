import test from 'node:test';
import assert from 'node:assert/strict';
import * as tools from '../core/outliner.mjs';
const original='- Parent\n  - Child\n- Sibling\n';
test('OUTLINE-01 subtree movement matches actual Obsidian execution',()=>{
 assert.equal(typeof tools.outlineEdit,'function');
 const moved='- Sibling\n- Parent\n  - Child\n';
 assert.equal(tools.outlineEdit(original,2,'down').content,moved);
 assert.equal(tools.outlineEdit(original,original.indexOf('Sibling'),'up').content,moved);
 assert.equal(tools.outlineEdit('- A\n- B',2,'down').content,'- B\n- A');
 assert.equal(tools.outlineEdit('- A\n\nParagraph',2,'down'),null);
});
test('OUTLINE-01 indent/outdent keep descendants, checkboxes and CRLF',()=>{
 assert.equal(typeof tools.outlineEdit,'function');
 assert.equal(tools.outlineEdit(original,original.indexOf('Sibling'),'indent').content,'- Parent\n  - Child\n  - Sibling\n');
 assert.equal(tools.outlineEdit(original,original.indexOf('Child'),'outdent').content,'- Parent\n- Child\n- Sibling\n');
 const text='- A\r\n- [ ] B\r\n  - C\r\n';
 const result=tools.outlineEdit(text,text.indexOf('B'),'indent');
 assert.equal(result.content,'- A\r\n  - [ ] B\r\n    - C\r\n');
 assert.equal(tools.outlineEdit(result.content,result.offset,'outdent').content,text);
 assert.equal(tools.outlineEdit(original,2,'up'),null);
 assert.equal(tools.outlineEdit(original,2,'outdent'),null);
});
test('OUTLINE-01 range ignores YAML and fenced examples; folding excludes next sibling',()=>{
 assert.equal(typeof tools.outlineRange,'function');
 for(const text of ['---\n- not a list\n---\n','```md\n- not a list\n```\n','~~~\n- not a list\n~~~'])assert.equal(tools.outlineRange(text,text.indexOf('- ')),null);
 const range=tools.outlineRange(original,2);
 assert.equal(original.slice(range.from,range.to),'- Parent\n  - Child\n');
 assert.equal(original.slice(range.foldFrom,range.foldTo),'\n  - Child');
});
