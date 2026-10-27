import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,truncate,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {Vault} from '../core/vault.mjs';
import {parseMetadata} from '../core/metadata.mjs';
import * as tools from '../core/note-composer.mjs';
async function fixture(t,files){const dir=await mkdtemp(`${tmpdir()}/dynote-compose-`);t.after(()=>rm(dir,{recursive:true,force:true}));const root=`${dir}/vault`;await mkdir(root);for(const [path,content]of Object.entries(files)){const folders=path.split('/').slice(0,-1);if(folders.length)await mkdir(`${root}/${folders.join('/')}`,{recursive:true});await writeFile(`${root}/${path}`,content);}const vault=await Vault.open(root,`${dir}/recovery`);return {root,vault,composer:new tools.NoteComposer(vault)};}
test('CORE-COMPOSER merge matches original metadata precedence and retains recoverable source',async t=>{
 assert.equal(typeof tools.NoteComposer,'function');const source='---\nstatus: source\ntags: [source]\n---\n# Source\n\n[PDF](./manual.pdf#page=2)\n',target='---\nstatus: target\ntags: [target]\n---\n# Target\n\nKeep.\n';
 const {root,vault,composer}=await fixture(t,{'Source.md':source,'Target.md':target,'Incoming.md':'[[Source#Source|old label]]\n'});
 const input={kind:'merge',sourcePath:'Source.md',targetPath:'Target.md',position:'append'};
 const preview=await composer.preview(input);assert.equal(await readFile(`${root}/Source.md`,'utf8'),source);assert.equal(preview.changes.length,3);
 const result=await composer.apply(preview.input,preview.revision),merged=await readFile(`${root}/Target.md`,'utf8');
 assert.equal(parseMetadata(merged).properties.status,'source');assert.deepEqual(parseMetadata(merged).properties.tags,['target','source']);assert.match(merged,/Keep\.\n\n# Source/);
 await assert.rejects(readFile(`${root}/Source.md`));assert.equal(await readFile(`${result.recoveryPath}/files/Source.md`,'utf8'),source);assert.match(await readFile(`${root}/Incoming.md`,'utf8'),/\[\[Target#Source\|old label\]\]/);
});
test('CORE-COMPOSER extraction rebases attachments and moved anchors while preserving source YAML and CRLF',async t=>{
 assert.equal(typeof tools.NoteComposer,'function');const source='---\r\nowner: keep\r\n---\r\n# Root\r\n\r\n## Move\r\nText [PDF](../manual.pdf#page=2) ^block\r\n\r\n## Keep\r\n[[#Move]] [[#Keep]]\r\n';
 const {root,composer}=await fixture(t,{'old/Source.md':source,'manual.pdf':'%PDF-fixture','Incoming.md':'[[old/Source#Move]] [[old/Source#^block]] [[old/Source#Keep]]\n```md\n[[old/Source#Move]]\n```'});
 const from=source.indexOf('## Move'),to=source.indexOf('## Keep');const preview=await composer.preview({kind:'extract',sourcePath:'old/Source.md',targetPath:'new/deep/Extracted.md',from,to,replacement:'link'});
 await composer.apply(preview.input,preview.revision);const remaining=await readFile(`${root}/old/Source.md`,'utf8'),extracted=await readFile(`${root}/new/deep/Extracted.md`,'utf8');
 assert.match(remaining,/owner: keep\r\n/);assert.match(extracted,/\[PDF\]\(\.\.\/\.\.\/manual.pdf#page=2\)/);assert.match(remaining,/\[\[new\/deep\/Extracted/);assert.match(remaining,/\[\[#Keep\]\]/);
 const incoming=await readFile(`${root}/Incoming.md`,'utf8');assert.match(incoming,/\[\[new\/deep\/Extracted#Move\]\]/);assert.match(incoming,/\[\[new\/deep\/Extracted#\^block\]\]/);assert.match(incoming,/\[\[old\/Source#Keep\]\]/);assert.match(incoming,/```md\n\[\[old\/Source#Move\]\]\n```/);
});
test('CORE-COMPOSER heading extraction includes child headings and resolves aliased incoming links',async t=>{
 assert.equal(typeof tools.NoteComposer,'function');const source='---\naliases: [Alias]\n---\n# Root\n\n## Move\nA\n### Child\nB\n## Keep\nC\n';
 const {root,composer}=await fixture(t,{'Source.md':source,'Incoming.md':'[[Alias#Move]] [[Alias#Keep]]'});
 const preview=await composer.preview({kind:'extract-heading',sourcePath:'Source.md',targetPath:'Extract.md',headingLine:6,replacement:'embed'});await composer.apply(preview.input,preview.revision);
 assert.match(await readFile(`${root}/Extract.md`,'utf8'),/### Child\nB/);assert.doesNotMatch(await readFile(`${root}/Extract.md`,'utf8'),/## Keep/);assert.match(await readFile(`${root}/Source.md`,'utf8'),/!\[\[Extract\]\]/);assert.match(await readFile(`${root}/Incoming.md`,'utf8'),/\[\[Extract#Move\]\]/);
});
test('CORE-COMPOSER rejects collisions, invalid ranges and stale preview without touching files',async t=>{
 assert.equal(typeof tools.NoteComposer,'function');const {root,composer}=await fixture(t,{'Source.md':'# Source\nContent\n','Target.md':'# Existing\n'});
 await assert.rejects(composer.preview({kind:'extract',sourcePath:'Source.md',targetPath:'Target.md',from:0,to:8}),/이미|같은/);
 await assert.rejects(composer.preview({kind:'extract',sourcePath:'Source.md',targetPath:'target.md',from:0,to:8}),/이미|같은/);
 await assert.rejects(composer.preview({kind:'extract',sourcePath:'Source.md',targetPath:'../outside.md',from:0,to:8}),/경로/);
 await assert.rejects(composer.preview({kind:'extract',sourcePath:'Source.md',targetPath:'New.md',from:8,to:2}),/선택/);
 const preview=await composer.preview({kind:'merge',sourcePath:'Source.md',targetPath:'Target.md'});await writeFile(`${root}/Target.md`,'external\n');await assert.rejects(composer.apply(preview.input,preview.revision),/변경/);
 assert.equal(await readFile(`${root}/Target.md`,'utf8'),'external\n');assert.equal(await readFile(`${root}/Source.md`,'utf8'),'# Source\nContent\n');
});

test('CORE-COMPOSER refuses an oversized merged result without changing either source',async t=>{
 const source='s'.repeat(5*1024*1024),target='t'.repeat(4*1024*1024),{root,composer}=await fixture(t,{'Source.md':source,'Target.md':target});
 await assert.rejects(composer.preview({kind:'merge',sourcePath:'Source.md',targetPath:'Target.md'}),/8MB/);
 assert.equal(await readFile(`${root}/Source.md`,'utf8'),source);assert.equal(await readFile(`${root}/Target.md`,'utf8'),target);
});

test('CORE-COMPOSER does not read or back up unrelated large PDF bytes',async t=>{
 const {root,composer}=await fixture(t,{'Source.md':'# Source\nBody\n','Target.md':'# Target\n','large.pdf':'%PDF-'});
 await truncate(`${root}/large.pdf`,600*1024*1024);
 const preview=await composer.preview({kind:'merge',sourcePath:'Source.md',targetPath:'Target.md'});const result=await composer.apply(preview.input,preview.revision);
 assert.equal((await stat(`${root}/large.pdf`)).size,600*1024*1024);await assert.rejects(readFile(`${result.recoveryPath}/files/large.pdf`));assert.match(await readFile(`${root}/Target.md`,'utf8'),/Body/);
});

test('CORE-COMPOSER Canvas references follow merged and extracted document anchors',async t=>{
 const canvas=JSON.stringify({nodes:[{id:'node',type:'file',file:'Source.md',subpath:'#Move',x:0,y:0,width:200,height:100},{id:'other',type:'file',file:'Source.md',subpath:'#Keep',x:200,y:0,width:200,height:100}],edges:[]});
 const source='# Root\n\n## Move\nA\n## Keep\nB\n';const {root,composer}=await fixture(t,{'Source.md':source,'Board.canvas':canvas});
 const preview=await composer.preview({kind:'extract-heading',sourcePath:'Source.md',targetPath:'Extract.md',headingLine:2});await composer.apply(preview.input,preview.revision);
 const saved=JSON.parse(await readFile(`${root}/Board.canvas`,'utf8'));assert.equal(saved.nodes[0].file,'Extract.md');assert.equal(saved.nodes[1].file,'Source.md');
});
test('CORE-COMPOSER later write failure rolls back source deletion and target merge',{skip:process.platform==='win32'||process.getuid?.()===0},async t=>{
 const source='# Source\nBody\n',target='# Target\n';const {root,composer}=await fixture(t,{'Source.md':source,'Target.md':target,'locked/Ref.md':'[[Source]]\n'});
 const preview=await composer.preview({kind:'merge',sourcePath:'Source.md',targetPath:'Target.md'});await chmod(`${root}/locked`,0o555);
 try{await assert.rejects(composer.apply(preview.input,preview.revision),/복구 사본/);}finally{await chmod(`${root}/locked`,0o755);}
 assert.equal(await readFile(`${root}/Source.md`,'utf8'),source);assert.equal(await readFile(`${root}/Target.md`,'utf8'),target);assert.equal(await readFile(`${root}/locked/Ref.md`,'utf8'),'[[Source]]\n');
});
