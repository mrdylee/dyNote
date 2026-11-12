import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Vault} from '../core/vault.mjs';
import {CopilotJournal} from '../electron/copilot-journal.mjs';
import {localDate} from '../core/periodic-notes.mjs';
import {captureId,captureLink,renderCapture} from '../core/copilot-journal.mjs';
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
 const record=result.status.records[0];assert.match(await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8'),/질문/);
 assert.match(await readFile(path.join(f.vault.root,f.journal),'utf8'),/직접 작성한 기록/);
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);
 assert.equal(await readFile(f.sourceFile,'utf8'),before);
 await f.put('q2','다른 세션',f.now()+2,path.join(f.source,'project/chatSessions/second.json'));
 const next=await f.controller.sync(f.vault,{});assert.equal(next.status.records.length,1);assert.equal(next.status.records[0].sessions.length,2);
 assert.equal((await readFile(path.join(f.vault.root,f.journal),'utf8')).match(/^<!-- dynote:copilot /gm).length,2);
});
test('manual import brings today into the journal with automation off and ignores other projects',async t=>{
 const f=await fixture(t);await f.put('earlier','오늘 대화',f.now()-10000);await f.put('other','수집하면 안됨',f.now(),path.join(f.source,'other/chatSessions/other.json'));await f.configure(false);
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);
 const result=await f.controller.sync(f.vault,{},true);assert.equal(result.status.records.length,1);
 assert.match(await readFile(path.join(f.vault.root,result.status.records[0].sessions[0].path),'utf8'),/오늘 대화/);
 assert.doesNotMatch(JSON.stringify(result.status),/수집하면 안됨/);
});
test('available sessions are scoped to chosen projects, deduplicated by native ID and ordered by last activity',async t=>{
 const f=await fixture(t);
 await f.put('old','PRIVATE OLD MESSAGE',f.now()-86400000);
 const newer=path.join(f.source,'project/chatSessions/newer.json');
 await f.put('new','PRIVATE NEW MESSAGE',f.now(),newer);
 const renamed=path.join(f.source,'project/chatSessions/renamed.json');
 await writeFile(renamed,await readFile(newer,'utf8'));
 await f.put('other','UNSELECTED MESSAGE',f.now()+1,path.join(f.source,'other/chatSessions/other.json'));
 const before=structuredClone(f.controller.config(f.vault));
 const {sessions}=await f.controller.listSessions(f.vault,['project']);
 const key=captureId(pathToFileURL(path.join(f.root,'Work')).href);
 assert.deepEqual(sessions.map(session=>session.id),[captureId(key,'newer'),captureId(key,'session')]);
 assert.deepEqual(sessions.map(session=>session.lastActivity),[f.now(),f.now()-86400000]);
 assert.ok(sessions.every(session=>session.projectId==='project'&&session.projectLabel==='Work'));
 assert.doesNotMatch(JSON.stringify(sessions),/PRIVATE|UNSELECTED/);
 assert.deepEqual(f.controller.config(f.vault),before);
});
test('manual session selection imports every recorded date of only that session and retries without duplicates',async t=>{
 const f=await fixture(t),past=f.now()-3*86400000;
 await f.put('past','선택한 세션의 과거 질문',past);
 const source=JSON.parse(await readFile(f.sourceFile,'utf8'));
 source.requests.push({...source.requests[0],requestId:'today',timestamp:f.now(),message:{text:'선택한 세션의 오늘 질문'}});
 await writeFile(f.sourceFile,JSON.stringify(source));
 await f.put('other','같은 프로젝트의 다른 세션',f.now(),path.join(f.source,'project/chatSessions/other.json'));
 await f.configure(true);
 const {sessions}=await f.controller.listSessions(f.vault,['project']);
 const selected=sessions.find(session=>session.title==='검토 대화');
 const selection={sessionIds:[selected.id]};
 const result=await f.controller.sync(f.vault,{},true,selection);
 assert.deepEqual(result.status.records.map(record=>record.date).sort(),[localDate(past),f.date]);
 const paths=new Set(result.status.records.flatMap(record=>record.sessions.map(session=>session.path)));
 assert.equal(paths.size,1);
 const content=await readFile(path.join(f.vault.root,[...paths][0]),'utf8');
 assert.match(content,/선택한 세션의 과거 질문/);assert.match(content,/선택한 세션의 오늘 질문/);
 assert.doesNotMatch(content,/다른 세션/);
 assert.equal((await f.controller.sync(f.vault,{},true,selection)).changed,false);
 for(const record of result.status.records)assert.equal(captureLinkRanges(await readFile(path.join(f.vault.root,record.journalPath),'utf8')).length,1);
 const deleted=await f.controller.trash(f.vault,{id:result.status.records[0].id,sessionId:result.status.records[0].sessions[0].id});
 assert.ok(!(await f.controller.listSessions(f.vault,['project'])).sessions.some(session=>session.id===selected.id));
 await f.controller.restore(f.vault,deleted.trashId);
});
test('invalid or stale session selections are rejected before importing a partial selection',async t=>{
 const f=await fixture(t);await f.put();await f.configure(false);
 const {sessions}=await f.controller.listSessions(f.vault,['project']);
 for(const sessionIds of [null,17,[],['bad'],[sessions[0].id,'a'.repeat(20)]]){
  await assert.rejects(f.controller.sync(f.vault,{},true,{sessionIds}),/세션/);
  assert.equal(Object.keys(f.controller.config(f.vault).records).length,0);
 }
 await assert.rejects(f.controller.listSessions(f.vault,['missing']),/프로젝트/);
 await rm(f.sourceFile);
 await assert.rejects(f.controller.sync(f.vault,{},true,{sessionIds:[sessions[0].id]}),/세션/);
 assert.equal(Object.keys(f.controller.config(f.vault).records).length,0);
});
test('multiple selected sessions write their own journals once without importing other sessions',async t=>{
 const f=await fixture(t),day=86400000;
 const from=localDate(f.now()-2*day),to=localDate(f.now()-day);
 const earlierJournal=`Journal/${from}.md`;
 await writeFile(path.join(f.vault.root,earlierJournal),'# Earlier\n\n직접 쓴 일지\n');
 for(const [days,text] of [[3,'기간 전'],[2,'첫날 대화'],[1,'마지막 날 대화'],[0,'오늘 대화']]){
  await f.put(`q${days}`,text,f.now()-days*day-1,path.join(f.source,`project/chatSessions/session-${days}.json`));
 }
 await f.configure(true);
 const key=captureId(pathToFileURL(path.join(f.root,'Work')).href);
 const selection={sessionIds:[captureId(key,'session-2'),captureId(key,'session-1')]};
 assert.equal((await f.controller.sync(f.vault,{},false,selection)).changed,false);
 const result=await f.controller.sync(f.vault,{},true,selection);
 assert.deepEqual(result.status.records.map(record=>record.date).sort(),[from,to]);
 for(const [date,text] of [[from,'첫날 대화'],[to,'마지막 날 대화']]){
  const record=result.status.records.find(record=>record.date===date);
  assert.match(await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8'),new RegExp(text));
  assert.equal(captureLinkRanges(await readFile(path.join(f.vault.root,`Journal/${date}.md`),'utf8')).length,1);
 }
 assert.match(await readFile(path.join(f.vault.root,earlierJournal),'utf8'),/직접 쓴 일지/);
 assert.equal((await f.controller.sync(f.vault,{},true,selection)).changed,false);
});
test('existing daily records and links migrate once and later imports only add new messages to the session',async t=>{
 const f=await fixture(t);
 await f.configure(false);
 const key=captureId(pathToFileURL(path.join(f.root,'Work')).href),sessionId=captureId(key,'session');
 const dates=[localDate(f.now()-86400000),f.date];
 const records={};
 for(const [index,date] of dates.entries()){
  const id=captureId(key,date),at=f.now()-(1-index)*86400000;
  const record={id,date,label:'Work',path:`AI Conversations/${key}/${date}.md`,journalPath:`Journal/${date}.md`,
   sessions:{[sessionId]:{title:'같은 세션',messages:[{id:`q${index}:user`,role:'user',text:`기존 질문 ${index}`,at}]}}};
  records[id]=record;
  await mkdir(path.dirname(path.join(f.vault.root,record.path)),{recursive:true});
  await writeFile(path.join(f.vault.root,record.path),renderCapture(record)+'\n개인 메모\n');
  await writeFile(path.join(f.vault.root,record.journalPath),'# 직접 쓴 저널\n\n'+captureLink(record)
   .replace(`<!-- /dynote:copilot ${id} -->`,`블록 안 메모\n<!-- /dynote:copilot ${id} -->`));
 }
 await f.controller.persist(f.vault,{...f.controller.config(f.vault),sessionLayout:undefined,records});
 assert.equal((await f.controller.status(f.vault)).needsMigration,true);
 const migrated=await f.controller.sync(f.vault,{},true);
 const sessionPath=`AI Conversations/${key}/${sessionId}.md`;
 assert.equal(migrated.changed,true);
 assert.deepEqual(migrated.status.records.map(record=>record.sessions[0].path),[sessionPath,sessionPath]);
 const document=path.join(f.vault.root,sessionPath);
 const before=await readFile(document,'utf8');
 assert.match(before,/기존 질문 0/);assert.match(before,/기존 질문 1/);
 for(const record of Object.values(records)){
  assert.equal(await readFile(path.join(f.vault.root,record.path),'utf8'),renderCapture(record)+'\n개인 메모\n');
  const journal=await readFile(path.join(f.vault.root,record.journalPath),'utf8');
  assert.match(journal,/직접 쓴 저널/);assert.match(journal,/블록 안 메모/);
  const links=captureLinkRanges(journal);
  assert.equal(links.length,1);assert.ok(links[0].link.text.includes(sessionPath));
 }
 assert.equal((await f.controller.sync(f.vault,{},true)).changed,false);
 await writeFile(f.sourceFile,JSON.stringify({version:3,sessionId:'original-session-id',customTitle:'새 제목',requests:[
  {requestId:'q0',timestamp:f.now()-86400000,message:{text:'기존 질문 0'},modelState:{value:1},response:[]},
  {requestId:'q1',timestamp:f.now(),message:{text:'수정된 원문'},modelState:{value:1},response:[]},
  {requestId:'q2',timestamp:f.now()+1,message:{text:'새 질문'},modelState:{value:1},response:[{value:'새 답변'}]},
 ]}));
 const updated=await f.controller.sync(f.vault,{},true);
 assert.equal(updated.changed,true);
 assert.deepEqual(updated.status.records.map(record=>record.sessions[0].path),[sessionPath,sessionPath]);
 let content=await readFile(document,'utf8');
 assert.match(content,/기존 질문 0/);assert.match(content,/기존 질문 1/);
 assert.doesNotMatch(content,/수정된 원문/);assert.match(content,/새 답변/);
 assert.equal((await f.controller.sync(f.vault,{},true)).changed,false);
 assert.equal(await readFile(document,'utf8'),content);
 const renamedSource=path.join(path.dirname(f.sourceFile),'renamed.json');
 const continued=JSON.parse(await readFile(f.sourceFile,'utf8'));
 await rename(f.sourceFile,renamedSource);
 continued.requests.push({requestId:'q3',timestamp:f.now()+2,message:{text:'파일 이름 변경 후 질문'},modelState:{value:1},response:[]});
 await writeFile(renamedSource,JSON.stringify(continued));
 const renamed=await f.controller.sync(f.vault,{},true);
 assert.deepEqual(renamed.status.records.map(record=>record.sessions.map(session=>session.path)),[[sessionPath],[sessionPath]]);
 content=await readFile(document,'utf8');
 assert.match(content,/파일 이름 변경 후 질문/);
 const todayId=captureId(key,f.date),deleted=await f.controller.trash(f.vault,{id:todayId});
 assert.equal(deleted.status.records[0].sessions[0].path,sessionPath);
 const remaining=await readFile(document,'utf8');
 assert.match(remaining,/기존 질문 0/);assert.doesNotMatch(remaining,/기존 질문 1|새 답변/);
 assert.equal(captureLinkRanges(await readFile(path.join(f.vault.root,f.journal),'utf8')).length,0);
 assert.equal((await f.controller.sync(f.vault,{},true,{sessionIds:[captureId(key,'original-session-id')]})).changed,false);
 const restored=await f.controller.restore(f.vault,deleted.trashId);
 assert.equal(restored.status.records.length,2);
 assert.equal(await readFile(document,'utf8'),content);
});
test('an interrupted save resumes the same session and link after restart',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();
 const persist=f.controller.persist.bind(f.controller);
 f.controller.persist=async(vault,config)=>{
  if(config.sessionLayout&&!config.pendingCapture)throw new Error('Interrupted final write');
  return persist(vault,config);
 };
 await assert.rejects(f.controller.sync(f.vault,{}),/Interrupted final write/);
 const restarted=new CopilotJournal({file:path.join(f.profile,'capture.json'),sourceRoot:f.source,now:f.now});
 await restarted.load();
 await f.put('q2','다음 질문',f.now()+2);
 const recovered=await restarted.sync(f.vault,{});
 assert.equal(recovered.status.records.length,1);
 const [{path:sessionPath}]=recovered.status.records[0].sessions;
 assert.equal(captureLinkRanges(await readFile(path.join(f.vault.root,f.journal),'utf8')).length,1);
 assert.match(await readFile(path.join(f.vault.root,sessionPath),'utf8'),/> 질문/);
 assert.equal((await restarted.sync(f.vault,{})).changed,true);
 const text=await readFile(path.join(f.vault.root,sessionPath),'utf8');
 assert.match(text,/> 질문/);assert.match(text,/> 다음 질문/);
 assert.equal((await restarted.sync(f.vault,{})).changed,false);
});
test('a selected session is imported after completing an interrupted earlier import',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();
 const persist=f.controller.persist.bind(f.controller);
 f.controller.persist=async(vault,config)=>{
  if(config.sessionLayout&&!config.pendingCapture)throw new Error('Interrupted final write');
  return persist(vault,config);
 };
 await assert.rejects(f.controller.sync(f.vault,{}),/Interrupted final write/);
 const restarted=new CopilotJournal({file:path.join(f.profile,'capture.json'),sourceRoot:f.source,now:f.now});
 await restarted.load();
 await f.put('b','새로 선택한 세션',f.now()+2,path.join(f.source,'project/chatSessions/second.json'));
 const {sessions}=await restarted.listSessions(f.vault,['project']);
 const selection={sessionIds:[sessions.find(session=>session.title==='다른 대화').id]};
 const imported=await restarted.sync(f.vault,{},true,selection);
 assert.equal(imported.status.records[0].sessions.length,2);
 const selected=imported.status.records[0].sessions.find(session=>session.title==='다른 대화');
 assert.match(await readFile(path.join(f.vault.root,selected.path),'utf8'),/새로 선택한 세션/);
 assert.equal((await restarted.sync(f.vault,{},true,selection)).changed,false);
});
test('WSL projects in VS Code workspaceStorage can be selected and imported',async t=>{
 const f=await fixture(t);
 await writeFile(path.join(f.source,'project/workspace.json'),JSON.stringify({folder:'vscode-remote://wsl%2BUbuntu/home/dev/WSL%20Work'}));
 await writeFile(path.join(f.source,'other/workspace.json'),JSON.stringify({workspace:'vscode-remote://wsl+Debian/home/dev/Shared.code-workspace'}));
 await mkdir(path.join(f.source,'ssh'));
 await writeFile(path.join(f.source,'ssh/workspace.json'),JSON.stringify({folder:'vscode-remote://ssh-remote%2Bdev/home/dev/Remote'}));
 const {projects}=await f.controller.status(f.vault);
 assert.deepEqual(projects.map(({id,label,path})=>({id,label,path})),[
  {id:'other',label:'Shared',path:'WSL (Debian) · /home/dev/Shared.code-workspace'},
  {id:'project',label:'WSL Work',path:'WSL (Ubuntu) · /home/dev/WSL Work'},
 ]);
 await f.configure(false);await f.put('wsl','WSL 질문');
 const result=await f.controller.sync(f.vault,{},true);
 assert.equal(result.changed,true);
 assert.match(await readFile(path.join(f.vault.root,result.status.records[0].sessions[0].path),'utf8'),/WSL 질문/);
 assert.ok((await readFile(path.join(f.vault.root,f.journal),'utf8')).includes(result.status.records[0].sessions[0].path));
 assert.equal((await f.controller.sync(f.vault,{},true)).changed,false);
});
test('a selected WSL project imports its own VS Code Agent Host history from session-state',async t=>{
 const f=await fixture(t),wslRoot=path.join(await realpath(f.root),'session-state');
 await writeFile(path.join(f.source,'project/workspace.json'),JSON.stringify({folder:'vscode-remote://wsl%2BUbuntu/home/dev/Work'}));
 await writeFile(path.join(f.source,'other/workspace.json'),JSON.stringify({folder:'vscode-remote://wsl%2BDebian/home/dev/Work'}));
 await f.controller.configure(f.vault,{enabled:true,projects:['project','other']},true);
 const config=f.controller.config(f.vault);
 await f.controller.persist(f.vault,{...config,wslSource:{root:wslRoot,distro:'ubuntu'}});
 const yesterday=f.now()-86400000,date=localDate(yesterday);
 const put=async(id,cwd,client,at,question)=>{
  const folder=path.join(wslRoot,id);await mkdir(folder,{recursive:true});
  await writeFile(path.join(folder,'workspace.yaml'),`cwd: ${cwd}\nclient_name: ${client}\n`);
  const timestamp=new Date(at).toISOString();
  await writeFile(path.join(folder,'events.jsonl'),[
   {type:'session.start',data:{sessionId:id}},
   {type:'user.message',id:'u',timestamp,data:{content:question}},
   {type:'assistant.message',id:'a',timestamp,data:{content:'WSL 답변',reasoningText:'PRIVATE REASONING'}},
   {type:'assistant.turn_end',data:{}},
  ].map(event=>JSON.stringify(event)).join('\n')+'\n');
 };
 await put('past','/home/dev/Work/','vscode-agent-host',yesterday,'이전 WSL 질문');
 await put('current','/home/dev/Work','vscode-agent-host',f.now()+1,'새 WSL 질문');
 await put('unselected','/home/dev/Work-other','vscode-agent-host',yesterday,'다른 프로젝트');
 await put('cli','/home/dev/Work','github/cli',yesterday,'독립 CLI 대화');
 const available=await f.controller.listSessions(f.vault,['project','other']);
 assert.deepEqual(available.sessions.map(session=>session.title),['새 WSL 질문','이전 WSL 질문']);
 const selection={sessionIds:[available.sessions[1].id]};
 const result=await f.controller.sync(f.vault,{},true,selection);
 assert.equal(result.status.records.length,1);
 const [record]=result.status.records;
 assert.equal(record.date,date);
 const content=await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8');
 assert.match(content,/이전 WSL 질문/);
 assert.doesNotMatch(content,/PRIVATE REASONING|다른 프로젝트|독립 CLI 대화|새 WSL 질문/);
 assert.equal((await f.controller.sync(f.vault,{},true,selection)).changed,false);
 const automatic=await f.controller.sync(f.vault,{});
 assert.equal(automatic.status.records.length,2);
 const today=automatic.status.records.find(record=>record.date===f.date);
 assert.match(await readFile(path.join(f.vault.root,today.sessions[0].path),'utf8'),/새 WSL 질문/);
});
test('title trash removes the source copy and journal link, stays excluded across restart and supports undo',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();let result=await f.controller.sync(f.vault,{});const record=result.status.records[0];
 const deleted=await f.controller.trash(f.vault,{id:record.id});
 await assert.rejects(readFile(path.join(f.vault.root,record.sessions[0].path)),{code:'ENOENT'});
 assert.doesNotMatch(await readFile(path.join(f.vault.root,f.journal),'utf8'),/dynote:copilot /);
 assert.doesNotMatch(await readFile(path.join(f.profile,'capture.json'),'utf8'),/질문/);
 const restarted=new CopilotJournal({file:path.join(f.profile,'capture.json'),sourceRoot:f.source,now:f.now});await restarted.load();
 assert.equal((await restarted.sync(f.vault,{},true)).status.records.length,0);
 const restored=await restarted.restore(f.vault,deleted.trashId);assert.equal(restored.status.records.length,1);
 assert.match(await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8'),/질문/);
});
test('deleting one conversation preserves the other conversation and blocks future reimport',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();await f.put('two','다른 질문',f.now()+2,path.join(f.source,'project/chatSessions/second.json'));
 const result=await f.controller.sync(f.vault,{}),record=result.status.records[0];
 await f.controller.trash(f.vault,{id:record.id,sessionId:record.sessions.find(s=>s.title==='검토 대화').id});
 const next=await f.controller.sync(f.vault,{},true);assert.equal(next.status.records[0].sessions.length,1);
 assert.match(await readFile(path.join(f.vault.root,next.status.records[0].sessions[0].path),'utf8'),/다른 질문/);
});
test('manual edits, team spaces, source symlinks and changed vault roots cannot be overwritten',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.configure(f.vault,{enabled:true,projects:['project']},false),/개인/);
 await f.configure(true);await f.put();let result=await f.controller.sync(f.vault,{});const record=result.status.records[0];
 await writeFile(path.join(f.vault.root,record.sessions[0].path),'MANUAL EDIT');await f.put('q2','새 원문',f.now()+2);
 await assert.rejects(f.controller.sync(f.vault,{}),/변경|수정/);assert.equal(await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8'),'MANUAL EDIT');
 await rm(f.sourceFile);await symlink(path.join(f.root,'vault',record.sessions[0].path),f.sourceFile,process.platform==='win32'?'file':undefined);
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
 await writeFile(path.join(f.vault.root,record.sessions[0].path),'MANUAL CONTENT');
 await assert.rejects(f.controller.trash(f.vault,{id:record.id}),/修|수정|변경/);
 const data=JSON.parse(await readFile(path.join(f.profile,'capture.json'),'utf8')).vaults[f.vault.id];
 assert.deepEqual(data.blocked,[]);assert.equal(data.trashId??null,null);
 assert.equal(await readFile(path.join(f.vault.root,record.sessions[0].path),'utf8'),'MANUAL CONTENT');
});
test('empty UI snapshots use the corresponding completed runtime transcript exactly once',async t=>{
 const f=await fixture(t);await f.configure(true);
 await writeFile(f.sourceFile,JSON.stringify({version:3,sessionId:'session',customTitle:'VS Code 제목',requests:[]}));
 const folder=path.join(f.source,'project/GitHub.copilot-chat/transcripts');await mkdir(folder,{recursive:true});
 const timestamp=new Date(f.now()+1).toISOString();
 await writeFile(path.join(folder,'session.jsonl'),[{type:'session.start',data:{sessionId:'session'}},{id:'u',type:'user.message',timestamp,data:{content:'transcript question'}},{id:'a',type:'assistant.message',timestamp,data:{content:'transcript answer',reasoningText:'hidden'}},{type:'assistant.turn_end',data:{}}].map(JSON.stringify).join('\n')+'\n');
 const result=await f.controller.sync(f.vault,{});assert.equal(result.status.records[0].sessions.length,1);assert.equal(result.status.records[0].sessions[0].title,'VS Code 제목');
 assert.equal((await f.controller.sync(f.vault,{})).changed,false);const content=await readFile(path.join(f.vault.root,result.status.records[0].sessions[0].path),'utf8');assert.match(content,/transcript answer/);assert.doesNotMatch(content,/hidden/);
 await f.put('snapshot-request','transcript question',f.now()+1);
 const switched=await f.controller.sync(f.vault,{});
 assert.equal(switched.changed,false);
 assert.match(switched.status.error,/식별/);
 assert.equal(await readFile(path.join(f.vault.root,result.status.records[0].sessions[0].path),'utf8'),content);
});
test('title deletion keeps manual notes inserted beside the managed journal link',async t=>{
 const f=await fixture(t);await f.configure(true);await f.put();const record=(await f.controller.sync(f.vault,{})).status.records[0];
 const journal=path.join(f.vault.root,f.journal),source=await readFile(journal,'utf8');
 const [link]=captureLinkRanges(source);
 await writeFile(journal,source.replace(`<!-- /dynote:copilot ${link.id} -->`,`사용자 메모\n<!-- /dynote:copilot ${link.id} -->`));
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
 assert.ok(content.includes(example));assert.equal(captureLinkRanges(content).length,1);
});
