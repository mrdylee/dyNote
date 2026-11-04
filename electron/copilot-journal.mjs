import {readFile,writeFile,mkdir,rename,readdir,lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseChatSource,captureId,renderCapture,captureLink,removeCaptureLink} from '../core/copilot-journal.mjs';
import {localDate,periodicNote} from '../core/periodic-notes.mjs';
const directoryName=value=>/^[\w-]{1,128}$/.test(value);
const clone=value=>structuredClone(value);
async function atomic(file,value){
 await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
 await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,file);
}
async function sourceFile(root,relative){
 let target=root;
 if(await realpath(root)!==root)throw new Error('VS Code 기록 경로가 바뀌었습니다. 폴더를 다시 선택해 주세요.');
 for(const part of relative.split('/')){
  if(!part||part==='.'||part==='..'||part.includes('\\'))throw new Error('허용되지 않는 대화 기록 경로입니다.');
  target=path.join(target,part);
  if((await lstat(target)).isSymbolicLink())throw new Error('대화 기록의 심볼릭 링크는 가져올 수 없습니다.');
 }
 const resolved=await realpath(target),relativePath=path.relative(root,resolved);
 if(path.isAbsolute(relativePath)||relativePath.split(path.sep).includes(".."))throw new Error("보관함 밖 대화 기록 경로는 가져올 수 없습니다.");
 const handle=await open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>64*1024*1024)throw new Error('64MB 이하의 일반 대화 기록 파일만 가져올 수 있습니다.');
  const content=await handle.readFile('utf8'),after=await handle.stat();
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('VS Code에서 대화를 저장 중입니다. 잠시 후 다시 가져옵니다.');
  return content;
 }finally{await handle.close();}
}
export class CopilotJournal{
 constructor({file,sourceRoot,now=()=>Date.now()}){Object.assign(this,{file,sourceRoot,now});this.data={vaults:{}};this.failure='';}
 async load(){
  this.sourceRoot=await realpath(this.sourceRoot).catch(error=>{if(error.code==='ENOENT')return this.sourceRoot;throw error;});
  try{const data=JSON.parse(await readFile(this.file,'utf8'));if(!data?.vaults||typeof data.vaults!=='object'||Array.isArray(data.vaults))throw new Error('shape');this.data=data;}
  catch(error){if(error.code!=='ENOENT'){this.failure='저널 자동기록 설정을 읽지 못했습니다. 기존 설정 파일을 확인해 주세요.';throw new Error(this.failure);}}
 }
 config(vault){
  if(this.failure)throw new Error(this.failure);
  return this.data.vaults[vault.id]??{sourceRoot:this.sourceRoot,enabled:false,projects:{},records:{},blocked:[]};
 }
 async persist(vault,config){const next={...this.data,vaults:{...this.data.vaults,[vault.id]:config}};await atomic(this.file,next);this.data=next;}
 async projects(root){
  let canonical;
  try{canonical=await realpath(root);}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(canonical!==root)throw new Error('VS Code 기록 경로가 바뀌었습니다. 폴더를 다시 선택해 주세요.');
  const result=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
   if(!entry.isDirectory()||!directoryName(entry.name))continue;
   let data;
   try{data=JSON.parse(await sourceFile(root,`${entry.name}/workspace.json`));}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const uri=data.folder??data.workspace;
   if(typeof uri!=='string'||!uri.startsWith('file:'))continue;
   let projectPath;try{projectPath=fileURLToPath(uri);}catch{continue;}
   result.push({id:entry.name,key:captureId(uri),label:path.basename(projectPath).replace(/\.code-workspace$/i,''),path:projectPath});
  }
  return result.sort((a,b)=>a.label.localeCompare(b.label));
 }
 async status(vault){
  const config=this.config(vault);let projects=[],error='';
  try{projects=await this.projects(config.sourceRoot);}catch(e){error=e.message;}
  return {sourceRoot:config.sourceRoot,enabled:config.enabled,projects:projects.map(p=>({...p,selected:Object.hasOwn(config.projects,p.id)})),error,
   records:Object.values(config.records).map(r=>({id:r.id,label:r.label,date:r.date,path:r.path,journalPath:r.journalPath,sessions:Object.entries(r.sessions).map(([id,s])=>({id,title:s.title}))})),trashId:config.trashId??null};
 }
 async setSource(vault,root){const config=clone(this.config(vault));config.sourceRoot=await realpath(root);if(!(await lstat(config.sourceRoot)).isDirectory())throw new Error('VS Code 기록 폴더를 선택해 주세요.');config.enabled=false;config.projects={};await this.persist(vault,config);return this.status(vault);}
 async configure(vault,input,personal){
  if(!personal)throw new Error('저널 자동기록은 개인 노트 공간에서 설정해 주세요.');
  const previous=this.config(vault),projects=await this.projects(previous.sourceRoot);
  if(typeof input?.enabled!=='boolean'||!Array.isArray(input.projects)||input.projects.some(id=>!projects.some(p=>p.id===id)))throw new Error('가져올 프로젝트를 선택해 주세요.');
  if(input.enabled&&!input.projects.length)throw new Error('자동 기록할 프로젝트를 선택해 주세요.');
  const config=clone(previous);config.enabled=input.enabled;
  config.projects=Object.fromEntries(input.projects.map(id=>[id,{since:input.enabled&&(!previous.enabled||!Object.hasOwn(previous.projects,id))?this.now():previous.projects[id]?.since??this.now()}]));
  await this.persist(vault,config);return this.status(vault);
 }
 async sources(root,workspace){
  const sessions=new Map();
  for(const [folder,kind] of [['chatSessions','chat'],['GitHub.copilot-chat/transcripts','transcript']]){
   const relative=`${workspace}/${folder}`,directory=path.join(root,relative);
   let entries;
   try{let target=root;for(const part of relative.split('/')){target=path.join(target,part);if((await lstat(target)).isSymbolicLink())throw new Error('대화 기록 폴더의 심볼릭 링크는 가져올 수 없습니다.');}entries=await readdir(directory,{withFileTypes:true});}
   catch(error){if(error.code==='ENOENT')continue;throw error;}
   for(const entry of entries){
    if(!/^[\w-]+\.jsonl?$/.test(entry.name))continue;
    if(entry.isSymbolicLink())throw new Error('대화 기록의 심볼릭 링크는 가져올 수 없습니다.');
    if(!entry.isFile())continue;
    const id=entry.name.replace(/\.jsonl?$/,''),parsed=parseChatSource(await sourceFile(root,`${relative}/${entry.name}`),id);
    const pair=sessions.get(id)??{};pair[kind]=parsed;sessions.set(id,pair);
   }
  }
  return [...sessions].map(([id,pair])=>{const source=pair.chat?.messages.length?pair.chat:pair.transcript??pair.chat;return {id,...source,title:pair.chat?.title||source.title};});
 }
 async commit(vault,previous,next){
  if(await realpath(vault.root)!==vault.root)throw new Error('보관함 경로가 바뀌었습니다. 다시 열어 주세요.');
  const snapshot=await vault.documentSnapshot(),notes=new Map(snapshot.notes.map(n=>[n.path,n])),edits=new Map();
  const journalContent=name=>edits.has(name)?edits.get(name):notes.get(name)?.content??`# ${path.basename(name,'.md')}\n\n`;
  for(const id of new Set([...Object.keys(previous.records),...Object.keys(next.records)])){
   const before=previous.records[id],after=next.records[id];if(JSON.stringify(before)===JSON.stringify(after))continue;
   const record=after??before,current=notes.get(record.path),oldText=before?renderCapture(before):null,newText=after?renderCapture(after):null;
   if(current&&current.content!==oldText&&current.content!==newText)throw new Error('가져온 대화 문서가 수정되었습니다. 내용을 확인한 뒤 다시 가져와 주세요.');
   if(!current&&before&&after)throw new Error('가져온 대화 문서가 삭제되거나 이동되었습니다. 자동 기록 제목에서 삭제 상태를 정리해 주세요.');
   if(current?.content!==newText&&(current||after))edits.set(record.path,newText);
   if(!after&&!notes.has(record.journalPath)&&!edits.has(record.journalPath))continue;
   let content=journalContent(record.journalPath);
   if(after){if(!content.includes(`<!-- dynote:copilot ${id} -->`))content+=(content.endsWith('\n\n')?'':'\n')+captureLink(after);}
   else content=removeCaptureLink(content,id);
   if(content!==notes.get(record.journalPath)?.content)edits.set(record.journalPath,content);
  }
  const changes=[...edits].filter(([name,content])=>content!==notes.get(name)?.content).map(([path,content])=>({path,content}));
  const result=changes.length?await vault.applyDocumentChanges(changes,snapshot.revision):{};
  await this.persist(vault,next);
  return {changed:changes.length>0,...result,status:await this.status(vault)};
 }
 async sync(vault,daily={},manual=false){
  const previous=this.config(vault);if(!previous.enabled&&!manual)return {changed:false,status:await this.status(vault)};
  if(!Object.keys(previous.projects).length){if(manual)throw new Error('설정의 저널 자동기록에서 프로젝트를 선택해 주세요.');return {changed:false,status:await this.status(vault)};}
  const next=clone(previous),today=localDate(this.now());
  for(const project of await this.projects(previous.sourceRoot)){
   if(!Object.hasOwn(previous.projects,project.id))continue;
   for(const source of await this.sources(previous.sourceRoot,project.id)){
    const sessionId=captureId(project.key,source.id);if(next.blocked.includes(`s:${sessionId}`))continue;
    for(const message of source.messages){
     if(!Number.isFinite(message.at)||(!manual&&message.at<previous.projects[project.id].since)||(manual&&localDate(message.at)!==today))continue;
     const date=localDate(message.at),id=captureId(project.key,date);if(next.blocked.includes(`g:${id}`))continue;
     const record=next.records[id]??={id,date,label:project.label,path:`AI Conversations/${project.key}/${date}.md`,journalPath:periodicNote('daily',date,{folder:'Journal',...daily}).path,sessions:{}};
     const session=record.sessions[sessionId]??={title:source.title||'대화',messages:[]};
     const messages=new Map(session.messages.map(m=>[m.id,m]));messages.set(message.id,message);session.messages=[...messages.values()].sort((a,b)=>a.at-b.at);
     if(source.title)session.title=source.title;
    }
   }
  }
  if(JSON.stringify(previous)===JSON.stringify(next))return {changed:false,status:await this.status(vault)};
  return this.commit(vault,previous,next);
 }
 async trash(vault,{id,sessionId}){
  if(!/^[a-f0-9]{20}$/.test(id)||(sessionId!==undefined&&!/^[a-f0-9]{20}$/.test(sessionId)))throw new Error('잘못된 대화 기록입니다.');
  const previous=this.config(vault),record=previous.records[id];
  if(!record||(sessionId&&!record.sessions[sessionId]))throw new Error('삭제할 대화 기록을 다시 확인해 주세요.');
  const next=clone(previous),block=sessionId?`s:${sessionId}`:`g:${id}`,trashId=randomUUID();
  if(sessionId){delete next.records[id].sessions[sessionId];if(!Object.keys(next.records[id].sessions).length)delete next.records[id];}else delete next.records[id];
  next.blocked=[...new Set([...next.blocked,block])];next.trashId=trashId;
  const directory=path.join(vault.recoveryRoot,'copilot-journal-trash');
  await atomic(path.join(directory,`${trashId}.json`),{record,sessionId,block});
  // Persist exclusion before touching notes so retries cannot resurrect a deleted record.
  await this.persist(vault,{...clone(previous),blocked:next.blocked,trashId});
  try{return {...await this.commit(vault,previous,next),trashId};}
  catch(error){await this.persist(vault,previous);throw error;}
 }
 async restore(vault,trashId){
  if(!/^[a-f0-9-]{36}$/.test(trashId))throw new Error('잘못된 복원 항목입니다.');
  const {record,sessionId,block}=JSON.parse(await readFile(path.join(vault.recoveryRoot,'copilot-journal-trash',`${trashId}.json`),'utf8'));
  const previous=this.config(vault),next=clone(previous),current=next.records[record.id]??={...record,sessions:{}};
  for(const [id,session] of Object.entries(record.sessions))if(!sessionId||sessionId===id){if(current.sessions[id])throw new Error('이미 복원된 대화입니다.');current.sessions[id]=session;}
  next.blocked=next.blocked.filter(value=>value!==block);next.trashId=null;
  return this.commit(vault,previous,next);
 }
}
