import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Vault} from '../core/vault.mjs';
import {CopilotJournal} from '../electron/copilot-journal.mjs';
import {localDate} from '../core/periodic-notes.mjs';
import {captureId,captureLink} from '../core/copilot-journal.mjs';
import {captureLinkRanges} from '../core/copilot-journal-links.mjs';
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'dynote-capture-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'workspaceStorage'),profile=path.join(root,'profile');
 for(const p of ['vault/Journal','workspaceStorage/project/chatSessions','workspaceStorage/other/chatSessions','profile'])await mkdir(path.join(root,p),{recursive:true});
 await writeFile(path.join(source,'project/workspace.json'),JSON.stringify({folder:pathToFileURL(path.join(root,'Work')).href}));
 await writeFile(path.join(source,'other/workspace.json'),JSON.stringify({folder:pathToFileURL(path.join(root,'Other')).href}));
 const vault=await Vault.open(path.join(root,'vault'),path.join(root,'recovery'));
 let clock=new Date(2026,10,4,12).getTime();
 const controller=new CopilotJournal({file:path.join(profile,'capture.json'),sourceRoot:source,now:()=>clock});await controller.load();
 const date=localDate(clock),journal=`Journal/${date}.md`;
 await writeFile(path.join(vault.root,journal),'# Today\n\n직접 작성한 기록\n');
 const sourceFile=path.join(source,'project/chatSessions/session.json');
 const put=async(id='q',text='질문',time=clock+1,file=sourceFile)=>writeFile(file,JSON.stringify({version:3,sessionId:path.basename(file,'.json'),customTitle:path.basename(file,'.json')==='session'?'검토 대화':'다른 대화',requests:[{requestId:id,timestamp:time,message:{text},modelState:{value:1},response:[{value:'답변'}]}]}));
 const configure=enabled=>controller.configure(vault,{enabled,projects:['project']},true);
 return {root,source,profile,vault,controller,date,journal,put,configure,sourceFile,now:()=>clock,advance:value=>clock+=value};
}
test('automatic collection starts at activation, groups new sessions and keeps unrelated journal text',async t=>{
 const f=await fixture(t);await f.put('old','과거',f.now()-1);await f.configure(true);
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);
 await f.put();const before=await readFile(f.sourceFile,'utf8');const result=await f.controller.sync(f.vault,{});
 assert.equal(result.changed,true);assert.equal(result.status.records.length,1);
 const record=result.status.records[0];assert.match(await readFile(path.join(f.vault.root,record.path),'utf8'),/질문/);
 assert.match(await readFile(path.join(f.vault.root,f.journal),'utf8'),/직접 작성한 기록/);
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);
 assert.equal(await readFile(f.sourceFile,'utf8'),before);
 await f.put('q2','다른 세션',f.now()+2,path.join(f.source,'project/chatSessions/second.json'));
 const next=await f.controller.sync(f.vault,{});assert.equal(next.status.records.length,1);assert.equal(next.status.records[0].sessions.length,2);
 assert.equal((await readFile(path.join(f.vault.root,f.journal),'utf8')).match(/^<!-- dynote:copilot /gm).length,1);
});
test('manual import brings today into the journal with automation off and ignores other projects',async t=>{
 const f=await fixture(t);await f.put('earlier','오늘 대화',f.now()-10000);await f.put('other','수집하면 안됨',f.now(),path.join(f.source,'other/chatSessions/other.json'));await f.configure(false);
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);
 const result=await f.controller.sync(f.vault,{},true);assert.equal(result.status.records.length,1);
 assert.match(await readFile(path.join(f.vault.root,result.status.records[0].path),'utf8'),/오늘 대화/);
 assert.doesNotMatch(JSON.stringify(result.status),/수집하면 안됨/);
});
test('title trash removes the source copy and journal link, stays excluded across restart and supports undo',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();let result=await f.controller.sync(f.vault,{});const record=result.status.records[0];
 const deleted=await f.controller.trash(f.vault,{id:record.id});
 await assert.rejects(readFile(path.join(f.vault.root,record.path)),{code:'ENOENT'});
 assert.doesNotMatch(await readFile(path.join(f.vault.root,f.journal),'utf8'),/dynote:copilot /);
 assert.doesNotMatch(await readFile(path.join(f.profile,'capture.json'),'utf8'),/질문/);
 const restarted=new CopilotJournal({file:path.join(f.profile,'capture.json'),sourceRoot:f.source,now:f.now});await restarted.load();
 assert.equal((await restarted.sync(f.vault,{},true)).status.records.length,0);
 const restored=await restarted.restore(f.vault,deleted.trashId);assert.equal(restored.status.records.length,1);
 assert.match(await readFile(path.join(f.vault.root,record.path),'utf8'),/질문/);
});
test('deleting one conversation preserves the other conversation and blocks future reimport',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();await f.put('two','다른 질문',f.now()+2,path.join(f.source,'project/chatSessions/second.json'));
 const result=await f.controller.sync(f.vault,{}),record=result.status.records[0];
 await f.controller.trash(f.vault,{id:record.id,sessionId:record.sessions.find(s=>s.title==='검토 대화').id});
 const next=await f.controller.sync(f.vault,{},true);assert.equal(next.status.records[0].sessions.length,1);
 assert.match(await readFile(path.join(f.vault.root,record.path),'utf8'),/다른 질문/);
});
test('manual edits, team spaces, source symlinks and changed vault roots cannot be overwritten',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.configure(f.vault,{enabled:true,projects:['project']},false),/개인/);
 await f.configure(true);await f.put();let result=await f.controller.sync(f.vault,{});const record=result.status.records[0];
 await writeFile(path.join(f.vault.root,record.path),'MANUAL EDIT');await f.put('q','새 원문',f.now()+1);
 await assert.rejects(f.controller.sync(f.vault,{}),/변경|수정/);assert.equal(await readFile(path.join(f.vault.root,record.path),'utf8'),'MANUAL EDIT');
 await rm(f.sourceFile);await symlink(path.join(f.root,'vault',record.path),f.sourceFile,process.platform==='win32'?'file':undefined);
 await assert.rejects(f.controller.sync(f.vault,{}),/링크|경로/);
});
test('manual import uses the event date and excludes earlier days',async t=>{
 const f=await fixture(t);await f.put('yesterday','어제 기록',f.now()-86400000);await f.configure(false);
 assert.equal((await f.controller.sync(f.vault,{},true)).status.records.length,0);
 await f.configure(true);f.advance(86400000);await f.put('tomorrow','다음 날 기록',f.now()+1);
 const result=await f.controller.sync(f.vault,{});assert.equal(result.status.records[0].date,localDate(f.now()));
});
test('deleting a record does not recreate a separately deleted journal',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();const result=await f.controller.sync(f.vault,{});
 await rm(path.join(f.vault.root,f.journal));await f.controller.trash(f.vault,{id:result.status.records[0].id});
 await assert.rejects(readFile(path.join(f.vault.root,f.journal)),{code:'ENOENT'});
});
test('reserved workspace names cannot enable an unselected project through inherited properties',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.source,'constructor/chatSessions'),{recursive:true});
 await writeFile(path.join(f.source,'constructor/workspace.json'),JSON.stringify({folder:pathToFileURL(path.join(f.root,'Unselected')).href}));
 await f.put('private','UNSELECTED CONTENT',f.now()+1,path.join(f.source,'constructor/chatSessions/private.json'));
 await f.configure(true);const result=await f.controller.sync(f.vault,{});assert.equal(result.status.records.length,0);
});
test('a rejected title deletion preserves the existing exclusion and undo state',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();const record=(await f.controller.sync(f.vault,{})).status.records[0];
 await writeFile(path.join(f.vault.root,record.path),'MANUAL CONTENT');
 await assert.rejects(f.controller.trash(f.vault,{id:record.id}),/修|수정|변경/);
 const data=JSON.parse(await readFile(path.join(f.profile,'capture.json'),'utf8')).vaults[f.vault.id];
 assert.deepEqual(data.blocked,[]);assert.equal(data.trashId??null,null);
 assert.equal(await readFile(path.join(f.vault.root,record.path),'utf8'),'MANUAL CONTENT');
});
test('empty UI snapshots use the corresponding completed runtime transcript exactly once',async t=>{
 const f=await fixture(t);await f.configure(true);
 await writeFile(f.sourceFile,JSON.stringify({version:3,sessionId:'session',customTitle:'VS Code 제목',requests:[]}));
 const folder=path.join(f.source,'project/GitHub.copilot-chat/transcripts');await mkdir(folder,{recursive:true});
 const timestamp=new Date(f.now()+1).toISOString();
 await writeFile(path.join(folder,'session.jsonl'),[{type:'session.start',data:{sessionId:'session'}},{id:'u',type:'user.message',timestamp,data:{content:'transcript question'}},{id:'a',type:'assistant.message',timestamp,data:{content:'transcript answer',reasoningText:'hidden'}},{type:'assistant.turn_end',data:{}}].map(JSON.stringify).join('\n')+'\n');
 const result=await f.controller.sync(f.vault,{});assert.equal(result.status.records[0].sessions.length,1);assert.equal(result.status.records[0].sessions[0].title,'VS Code 제목');
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);const content=await readFile(path.join(f.vault.root,result.status.records[0].path),'utf8');assert.match(content,/transcript answer/);assert.doesNotMatch(content,/hidden/);
});
test('title deletion keeps manual notes inserted beside the managed journal link',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();const record=(await f.controller.sync(f.vault,{})).status.records[0];
 const journal=path.join(f.vault.root,f.journal),source=await readFile(journal,'utf8');
 await writeFile(journal,source.replace(`<!-- /dynote:copilot ${record.id} -->`,`사용자 메모\n<!-- /dynote:copilot ${record.id} -->`));
 await f.controller.trash(f.vault,{id:record.id});assert.match(await readFile(journal,'utf8'),/사용자 메모/);
});
test('a replaced vault root cannot receive imported private conversations',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();const moved=path.join(f.root,'original-vault'),outside=path.join(f.root,'outside');await mkdir(outside);
 await writeFile(path.join(outside,'keep.txt'),'untouched');await rename(f.vault.root,moved);await symlink(outside,f.vault.root,process.platform==='win32'?'junction':'dir');
 try{await assert.rejects(f.controller.sync(f.vault,{}),/보관함 경로/);assert.equal(await readFile(path.join(outside,'keep.txt'),'utf8'),'untouched');}
 finally{await rm(f.vault.root);await rename(moved,f.vault.root);}
});

test('a literal link example does not prevent the actual journal link from being added',async t=>{
 const f=await fixture(t),key=captureId(pathToFileURL(path.join(f.root,'Work')).href),id=captureId(key,f.date);
 const example='```md\n'+captureLink({id,label:'Work',path:`AI Conversations/${key}/${f.date}.md`})+'```\n';
 await writeFile(path.join(f.vault.root,f.journal),'# Today\n\n'+example);
 await f.configure(true);await f.put();await f.controller.sync(f.vault,{});
 const content=await readFile(path.join(f.vault.root,f.journal),'utf8');
 assert.ok(content.includes(example));assert.equal(captureLinkRanges(content).filter(group=>group.id===id).length,1);
});
