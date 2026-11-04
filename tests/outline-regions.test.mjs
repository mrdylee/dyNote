import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {history,undo} from '@codemirror/commands';
import {renderMarkdown} from '../core/knowledge.mjs';
import {journalOutline,journalEnter,journalIndent} from '../src/journal-outline.mjs';
const core=await import('../core/outline-regions.mjs').catch(()=>({}));
const extension=await import('../src/outline-regions.mjs').catch(()=>({}));
const open='<!-- dynote:journal -->',close='<!-- /dynote:journal -->';
const wrapped=body=>`${open}\n${body}\n${close}\n`;
function call(name,...args){assert.equal(typeof core[name],'function',name);return core[name](...args);}
function apply(source,edit){assert.ok(edit);for(const change of [...edit.changes].sort((a,b)=>b.from-a.from))source=source.slice(0,change.from)+change.insert+source.slice(change.to??change.from);return source;}
function editor(doc,anchor=doc.length,head=anchor){let state=EditorState.create({doc,selection:{anchor,head},extensions:[markdown(),history(),journalOutline({journal:false})]});return {get state(){return state;},dispatch(spec){state=state.update(spec).state;},focus(){},composing:false};}
test('paired regions expose only their body in unified journal mode',()=>{
 const source='Intro\n\n'+wrapped('- Parent\n  - Child')+'\n'+wrapped('- Other');
 const regions=call('outlineRegions',source);assert.equal(regions.length,2);assert.equal(source.slice(regions[0].from,regions[0].to),'- Parent\n  - Child\n');assert.equal(regions[0].mode,'journal');assert.equal(regions[1].mode,'journal');
});
test('fenced, indented code, YAML, unpaired and nested markers stay literal',()=>{
 const valid=wrapped('- A');
 for(const source of ['```md\n'+valid+'```\n','    '+open+'\n    - A\n    '+close+'\n','---\nvalue: |\n  '+open+'\n  '+close+'\n---\n',open+'\n- A',close,open+'\n'+valid+close+'\n'])assert.deepEqual(call('outlineRegions',source),[],source);
});
test('wrapping full lines preserves body and all neighboring text',()=>{
 const source='Before\n\n- Parent\n  - Child\n\nAfter\n',from=source.indexOf('Parent'),to=source.indexOf('Child')+3;
 const changed=apply(source,call('outlineRegionEdit',source,from,to,'journal'));
 assert.match(changed,/Before\n\n<!-- dynote:journal -->\n- Parent\n  - Child\n<!-- \/dynote:journal -->\n\nAfter\n/);
 const region=call('outlineRegions',changed)[0];assert.equal(apply(changed,call('outlineRegionEdit',changed,region.from,region.from,'normal')),source);
});
test('CRLF and a missing EOF newline survive create and remove byte-exactly',()=>{
 for(const source of ['- Parent\r\n  - Child','- Parent\r\n  - Child\r\n','- Parent\n  - Child','- Parent\n  - Child\n']){
  const changed=apply(source,call('outlineRegionEdit',source,0,source.length,'journal')),region=call('outlineRegions',changed)[0];assert.ok(region);
  assert.equal(apply(changed,call('outlineRegionEdit',changed,region.from,region.from,'normal')),source);
  if(source.includes('\r\n'))assert.equal(changed.replaceAll('\r\n','').includes('\n'),false);
 }
});
test('switching to normal mode removes only the journal boundaries',()=>{
 const source=wrapped('- Parent\n  - Child'),region=call('outlineRegions',source)[0];
 const changed=apply(source,call('outlineRegionEdit',source,region.from+3,region.from+3,'normal'));
 assert.equal(changed,'- Parent\n  - Child\n');
});
test('overlapping regions and partial code or metadata selections are refused',()=>{
 const source=wrapped('- A')+'\n'+wrapped('- B');assert.equal(call('outlineRegionEdit',source,0,source.length,'journal'),null);
 const code='```md\n- code\n```\n';assert.equal(call('outlineRegionEdit',code,code.indexOf('code'),code.indexOf('code')+4,'journal'),null);
 const yaml='---\ntitle: Value\n---\nText';assert.equal(call('outlineRegionEdit',yaml,0,10,'journal'),null);
});
test('rendering hides only valid region markers and retains literal code and raw HTML escaping',()=>{
 const html=renderMarkdown(wrapped('- Parent\n  - Child')+'\n```md\n'+open+'\n```\n<script>alert(1)</script>');
 assert.match(html,/<li>Parent/);assert.equal((html.match(/dynote:journal/g)||[]).length,1);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.match(renderMarkdown(open+'\n- Unclosed'),/dynote:journal/);
});
test('regular documents get journal commands only inside a journal-mode region',()=>{
 const source='- Outside\n\n'+wrapped('- Parent\n  - Child');
 let view=editor(source,source.indexOf('Outside')+7);assert.equal(journalEnter(view),false);assert.equal(journalIndent(view,'indent'),false);
 view=editor(source,source.indexOf('Parent')+6);assert.equal(journalEnter(view),true);assert.match(view.state.doc.toString(),/- Parent\n  - \n  - Child/);
});
test('the region policy enables journal editing and threading as one mode',()=>{
 assert.equal(typeof extension.outlineOptionsAt,'function');const source=wrapped('- A\n  - B'),view=editor(source,source.indexOf('B')+1),options=extension.outlineOptionsAt(view.state,view.state.selection.main.head);assert.equal(options.mode,'journal');
 const outside=editor('- Ordinary');assert.equal(extension.outlineOptionsAt(outside.state,3).mode,'normal');
});
test('region application and removal are one-step undoable and include selected descendants',()=>{
 assert.equal(typeof extension.applyOutlineRegion,'function');const source='- Parent\n  - Child\n\nAfter\n',view=editor(source,2,7);
 assert.equal(extension.applyOutlineRegion(view,'journal'),true);const regions=call('outlineRegions',view.state.doc.toString());assert.equal(regions.length,1);assert.match(view.state.doc.sliceString(regions[0].from,regions[0].to),/  - Child/);
 assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),source);
});

test('journal mode converts each selected prose paragraph into a bullet and keeps soft lines in that block',()=>{
 const source='Before\n\nFirst paragraph\nContinuation\n\nSecond paragraph\n\nAfter\n';
 const changed=apply(source,call('outlineRegionEdit',source,source.indexOf('First'),source.indexOf('Second')+4,'journal'));
 const region=call('outlineRegions',changed)[0];assert.ok(region);
 assert.equal(changed.slice(region.from,region.to),'- First paragraph\n  Continuation\n\n- Second paragraph\n');
 const normal=apply(changed,call('outlineRegionEdit',changed,region.from,region.from,'normal'));
 assert.equal(normal,'Before\n\n- First paragraph\n  Continuation\n\n- Second paragraph\n\nAfter\n');
});
test('prose conversion preserves existing headings and lists and is undoable',()=>{
 const source='## Heading\n\nParagraph\n\n- Existing\n  - Child\n',view=editor(source,0,source.length);
 assert.equal(extension.applyOutlineRegion(view,'journal'),true);const text=view.state.doc.toString();
 assert.match(text,/## Heading\n\n- Paragraph\n\n- Existing\n  - Child/);
 assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),source);
});

test('a nested selected region cannot outdent its logical root past an unselected parent',()=>{
 const source='- Outside parent\n  <!-- dynote:journal -->\n  - Selected child\n    - Descendant\n  <!-- /dynote:journal -->\n- Outside peer\n';
 const view=editor(source,source.indexOf('Selected child')+5);assert.equal(journalIndent(view,'outdent'),true);assert.equal(view.state.doc.toString(),source);
});
test('normal mode can remove a source selection containing its own boundary lines',()=>{
 const source=wrapped('- Parent\n  - Child');assert.equal(apply(source,call('outlineRegionEdit',source,0,source.length,'normal')),'- Parent\n  - Child\n');
});
test('BOM and nested-list selection keep their surrounding Markdown intact',()=>{
 const bom='\uFEFF- Parent\n  - Child';let changed=apply(bom,call('outlineRegionEdit',bom,0,bom.length,'journal'));assert.ok(changed.startsWith('\uFEFF<!--'));
 let region=call('outlineRegions',changed)[0];assert.equal(apply(changed,call('outlineRegionEdit',changed,region.from,region.from,'normal')),bom);
 const source='- Outside parent\n  - Child\n    - Descendant\n- Outside peer\n',view=editor(source,source.indexOf('Child'),source.indexOf('Child')+3);
 assert.equal(extension.applyOutlineRegion(view,'journal'),true);changed=view.state.doc.toString();region=call('outlineRegions',changed)[0];assert.ok(region);assert.equal(changed.slice(region.from,region.to),'  - Child\n    - Descendant\n');assert.ok(changed.startsWith('- Outside parent\n  <!--'));
});

test('a drag crossing region boundaries is not presented as one current journal region',()=>{
 const source=wrapped('- A')+'\n'+wrapped('- B'),view=editor(source,source.indexOf('- A'),source.indexOf('- B')+3);
 assert.equal(extension.selectedOutlineRegion(view.state),null);
});

test('an EOF region remains removable after its entire body is deleted in source mode',()=>{
 const wrappedSource=apply('- Content',call('outlineRegionEdit','- Content',0,9,'journal'));
 const region=call('outlineRegions',wrappedSource)[0],view=editor(wrappedSource,region.from);
 view.dispatch({changes:{from:region.from,to:region.to,insert:''}});
 assert.doesNotThrow(()=>assert.equal(extension.applyOutlineRegion(view,'normal'),true));
 assert.equal(view.state.doc.toString(),'');
});
test('all regions inside a malformed nested group remain literal',()=>{
 const source=open+'\n'+wrapped('- Nested A')+'\n'+wrapped('- Nested B')+close+'\n';
 assert.deepEqual(call('outlineRegions',source),[]);
});
test('a selection ending at the next list line start does not capture that sibling',()=>{
 const source='- Selected\n- Untouched\n  - Child\n',view=editor(source,2,source.indexOf('- Untouched'));
 assert.equal(extension.applyOutlineRegion(view,'journal'),true);
 const changed=view.state.doc.toString(),region=call('outlineRegions',changed)[0];
 assert.equal(changed.slice(region.from,region.to),'- Selected\n');
 assert.ok(changed.endsWith('- Untouched\n  - Child\n'));
});
