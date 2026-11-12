import {readFile,writeFile,mkdir,rename,readdir,lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseDocument} from 'yaml';
import {parseChatSource,captureId,captureSessionHeading,renderSessionCapture,captureLink,removeCaptureLink} from '../core/copilot-journal.mjs';
import {localDate,periodicNote} from '../core/periodic-notes.mjs';
import {captureLinkRanges} from '../core/copilot-journal-links.mjs';
const directoryName=value=>/^[\w-]{1,128}$/.test(value);
const linuxFolder=value=>path.posix.normalize(value).replace(/\/+$/,'')||'/';
const wslDistro=value=>{
 const unc=path.win32.normalize(value).replace(/^\\\\\?\\UNC\\/i,'\\\\');
 return /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\/i.exec(unc)?.[1].toLowerCase();
};
const clone=value=>structuredClone(value);
const legacyLayout=config=>!config.sessionLayout&&Object.keys(config.records).length>0;
const sessionPath=(record,id)=>`${path.posix.dirname(record.path)}/${id}.md`;
function sessionRecords(records){
 const result=new Map();
 for(const record of Object.values(records).sort((a,b)=>a.date.localeCompare(b.date))){
  for(const [id,entry] of Object.entries(record.sessions)){
   if(!result.has(id))result.set(id,{path:sessionPath(record,id),label:record.label,messages:new Map(),entries:[]});
   const session=result.get(id);
   session.entries.push(entry);
   session.title=entry.title;
   session.format=entry.format??session.format;
   session.sourceKey=entry.sourceKey??session.sourceKey;
   for(const message of entry.messages){
    if(!session.messages.has(message.id))session.messages.set(message.id,{...message,date:record.date});
   }
  }
 }
 return result;
}
function compatibleSource(session,source){
 if(!session?.messages.size||session.format===source.format)return true;
 // Old records have no source format. Verify their IDs before adding to them.
 const roles=new Map(source.messages.map(message=>[message.id,message.role]));
 return [...session.messages.values()].every(message=>roles.get(message.id)===message.role);
}
const sessionLinks=record=>Object.entries(record.sessions).map(([id,session])=>({
 id:captureId(record.id,id),label:session.title,path:sessionPath(record,id),
}));
async function atomic(file,value){
 await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
 await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,file);
}
async function sourceFile(root,relative,maxBytes=64*1024*1024){
 let target=root;
 if(await realpath(root)!==root)throw new Error('VS Code 기록 경로가 바뀌었습니다. 폴더를 다시 선택해 주세요.');
 for(const part of relative.split('/')){
  if(!part||part==='.'||part==='..'||part.includes('\\'))throw new Error('허용되지 않는 대화 기록 경로입니다.');
  target=path.join(target,part);
  if((await lstat(target)).isSymbolicLink())throw new Error('대화 기록의 심볼릭 링크는 가져올 수 없습니다.');
 }
 const resolved=await realpath(target),relativePath=path.relative(root,resolved);
 if(path.isAbsolute(relativePath)||relativePath.split(path.sep).includes(".."))throw new Error("보관함 밖 대화 기록 경로는 가져올 수 없습니다.");
 const handle=await open(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size>maxBytes)throw new Error('허용된 크기의 일반 대화 기록 파일만 가져올 수 있습니다.');
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
   if(typeof uri!=='string')continue;
   let projectPath,label,wsl;
   try{
    if(uri.startsWith('file:')){
     projectPath=fileURLToPath(uri);label=path.basename(projectPath);
    }else{
     const remote=new URL(uri);
     if(remote.protocol!=='vscode-remote:'||!remote.pathname)continue;
     const distro=decodeURIComponent(remote.hostname).match(/^wsl\+(.+)$/)?.[1];
     if(!distro)continue;
     const folder=decodeURIComponent(remote.pathname);
     projectPath=`WSL (${distro}) · ${folder}`;
     label=path.posix.basename(folder)||distro;
     wsl={distro:distro.toLowerCase(),folder:linuxFolder(folder)};
    }
   }catch{continue;}
   result.push({id:entry.name,key:captureId(uri),label:label.replace(/\.code-workspace$/i,''),path:projectPath,...(wsl?{wsl}:{})});
  }
  return result.sort((a,b)=>a.label.localeCompare(b.label));
 }
 async status(vault){
  const config=this.config(vault);let projects=[],error='';
  try{projects=await this.projects(config.sourceRoot);}catch(e){error=e.message;}
  return {sourceRoot:config.sourceRoot,wslSourceRoot:config.wslSource?.root??null,enabled:config.enabled,projects:projects.map(p=>({...p,selected:Object.hasOwn(config.projects,p.id)})),error,
   needsMigration:legacyLayout(config),pendingCapture:!!config.pendingCapture,
   records:Object.values(config.records).map(r=>({id:r.id,label:r.label,date:r.date,journalPath:r.journalPath,
    projectKey:path.posix.basename(path.posix.dirname(r.path)),
    sessions:Object.entries(r.sessions).map(([id,s])=>({id,title:s.title,
     path:config.sessionLayout?sessionPath(r,id):r.path,
     heading:config.sessionLayout?r.date:captureSessionHeading(s.title).trim(),
     lastActivity:s.messages.at(-1).at,
    })),
   })),trashId:config.trashId??null};
 }
 async setSource(vault,root){const config=clone(this.config(vault));config.sourceRoot=await realpath(root);if(!(await lstat(config.sourceRoot)).isDirectory())throw new Error('VS Code 기록 폴더를 선택해 주세요.');config.enabled=false;config.projects={};await this.persist(vault,config);return this.status(vault);}
 async setWslSource(vault,directory){
  const distro=wslDistro(directory);
  const problem=()=>new Error('WSL 배포판의 session-state 폴더를 선택해 주세요.');
  if(!distro||path.win32.basename(directory)!=='session-state')throw problem();
  const root=await realpath(directory);
  if(wslDistro(root)!==distro||!(await lstat(root)).isDirectory())throw problem();
  await this.persist(vault,{...this.config(vault),wslSource:{root,distro}});
  return this.status(vault);
 }
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
 async wslSources(source,projects){
  const sessions=new Map();
  if(!source)return {sessions};
  const {root,distro}=source;
  const matches=projects.filter(project=>project.wsl?.distro===distro);
  if(!matches.length)return {sessions};
  let error='';
  try{
   if(await realpath(root)!==root)throw new Error('WSL 기록 경로가 바뀌었습니다.');
   for(const entry of await readdir(root,{withFileTypes:true})){
    if(!entry.isDirectory()||!directoryName(entry.name))continue;
    try{
     const metadata=parseDocument(await sourceFile(root,`${entry.name}/workspace.yaml`,16*1024));
     if(metadata.errors.length||!['vscode-agent-host','vscode'].includes(metadata.get('client_name')))continue;
     const cwd=metadata.get('cwd');
     if(typeof cwd!=='string'||!path.posix.isAbsolute(cwd))continue;
     const folder=linuxFolder(cwd);
     const project=matches.find(candidate=>candidate.wsl.folder===folder);
     if(!project)continue;
     const parsed=parseChatSource(await sourceFile(root,`${entry.name}/events.jsonl`),entry.name);
     if(!sessions.has(project.id))sessions.set(project.id,[]);
     sessions.get(project.id).push({id:entry.name,...parsed});
    }catch(failure){
     if(failure.code!=='ENOENT')error='WSL 대화 일부를 읽지 못했습니다. 기록 폴더를 확인해 주세요.';
    }
   }
  }catch{
   error='WSL 기록 폴더에 접근할 수 없습니다. WSL과 기록 폴더를 확인해 주세요.';
  }
  return {sessions,error};
 }
 async projectSessions(config,projects){
  const wsl=await this.wslSources(config.wslSource,projects),sessions=[];
  for(const project of projects){
   const local=await this.sources(config.sourceRoot,project.id);
   const localIds=new Set(local.filter(source=>source.messages.length).map(source=>source.id));
   const remote=(wsl.sessions.get(project.id)??[]).filter(source=>!localIds.has(source.id));
   for(const source of [...local,...remote])sessions.push({project,source});
  }
  return {sessions,error:wsl.error};
 }
 async listSessions(vault,projectIds){
  const config=this.config(vault),available=await this.projects(config.sourceRoot);
  if(!Array.isArray(projectIds)||projectIds.some(id=>!available.some(project=>project.id===id)))throw new Error('가져올 프로젝트를 선택해 주세요.');
  const projects=available.filter(project=>projectIds.includes(project.id));
  const sources=await this.projectSessions(config,projects),sessions=new Map();
  const saved=sessionRecords(config.records);
  const aliases=new Map([...saved].map(([id,session])=>[session.sourceKey??id,id]));
  for(const {project,source} of sources.sessions){
   const messages=source.messages.filter(message=>!config.blocked.includes(`g:${captureId(project.key,localDate(message.at))}`));
   if(!messages.length)continue;
   const id=captureId(project.key,source.sessionId),fileId=captureId(project.key,source.id);
   const previousId=aliases.get(id)??(saved.has(fileId)?fileId:id);
   if([id,fileId,previousId].some(key=>config.blocked.includes(`s:${key}`)))continue;
   const lastActivity=messages.reduce((latest,message)=>Math.max(latest,message.at),0);
   if((sessions.get(id)?.lastActivity??-1)>=lastActivity)continue;
   sessions.set(id,{id,projectId:project.id,projectLabel:project.label,projectPath:project.path,title:source.title||'대화',lastActivity});
  }
  return {sessions:[...sessions.values()].sort((a,b)=>b.lastActivity-a.lastActivity),error:sources.error??''};
 }
 async commit(vault,previous,next){
  if(await realpath(vault.root)!==vault.root)throw new Error('보관함 경로가 바뀌었습니다. 다시 열어 주세요.');
  next.sessionLayout=true;
  const migrating=legacyLayout(previous);
  const snapshot=await vault.documentSnapshot(),notes=new Map(snapshot.notes.map(n=>[n.path,n])),edits=new Map();
  const touched=new Set();
  const journalContent=name=>edits.has(name)?edits.get(name):notes.get(name)?.content??`# ${path.basename(name,'.md')}\n\n`;
  for(const id of new Set([...Object.keys(previous.records),...Object.keys(next.records)])){
   const before=previous.records[id],after=next.records[id],unchanged=JSON.stringify(before)===JSON.stringify(after);
   if(!migrating&&unchanged)continue;
   if(migrating&&before&&after&&!notes.has(before.path))throw new Error('이관할 대화 문서가 삭제되거나 이동되었습니다. 자동 기록 제목에서 상태를 정리해 주세요.');
   for(const session of Object.keys(before?.sessions??{}))touched.add(session);
   for(const session of Object.keys(after?.sessions??{}))touched.add(session);
   const oldLinks=before?(previous.sessionLayout?sessionLinks(before):[before]):[];
   const newLinks=after?sessionLinks(after):[];
   const oldIds=new Set(oldLinks.map(link=>link.id)),newIds=new Set(newLinks.map(link=>link.id));
   const removed=oldLinks.filter(link=>!newIds.has(link.id)),added=newLinks.filter(link=>!oldIds.has(link.id));
   if(!removed.length&&!added.length)continue;
   const name=(after??before).journalPath;
   if((!after||(migrating&&unchanged))&&!notes.has(name)&&!edits.has(name))continue;
   let content=journalContent(name);
   const currentLinks=new Set(captureLinkRanges(content).map(group=>group.id));
   if(migrating&&unchanged&&!currentLinks.has(id))continue;
   for(const link of removed)content=removeCaptureLink(content,link.id);
   for(const link of added){
    if(!currentLinks.has(link.id))content+=(content.endsWith('\n\n')?'':'\n')+captureLink(link);
   }
   if(content!==notes.get(name)?.content)edits.set(name,content);
  }
  const previousSessions=previous.sessionLayout?sessionRecords(previous.records):new Map();
  const nextSessions=sessionRecords(next.records);
  for(const id of touched){
   const before=previousSessions.get(id),after=nextSessions.get(id);
   const oldText=before?renderSessionCapture(before):null,newText=after?renderSessionCapture(after):null;
   if(oldText===newText)continue;
   const name=(after??before).path,current=notes.get(name);
   if(current&&current.content!==oldText&&current.content!==newText)throw new Error('가져온 대화 문서가 수정되었습니다. 내용을 확인한 뒤 다시 가져와 주세요.');
   if(!current&&before&&after)throw new Error('가져온 대화 문서가 삭제되거나 이동되었습니다. 자동 기록 제목에서 삭제 상태를 정리해 주세요.');
   if(current?.content!==newText&&(current||after))edits.set(name,newText);
  }
  const changes=[...edits].filter(([name,content])=>content!==notes.get(name)?.content).map(([path,content])=>({path,content}));
  if(changes.length&&!previous.pendingCapture){
   // Replay the same records on retry, even if the original transcript has changed since this batch.
   const {records,sessionLayout,blocked,trashId}=next;
   await this.persist(vault,{...previous,pendingCapture:{records,sessionLayout,blocked,trashId}});
  }
  const result=changes.length?await vault.applyDocumentChanges(changes,snapshot.revision):previous.pendingCapture?{snapshot}:{};
  await this.persist(vault,next);
  return {changed:changes.length>0||!!previous.pendingCapture,migrated:migrating,...result,status:await this.status(vault)};
 }
 async finishPending(vault){
  const previous=this.config(vault),{pendingCapture,...config}=previous;
  if(pendingCapture)return this.commit(vault,previous,{...config,...pendingCapture});
 }
 async sync(vault,daily={},manual=false,{checkOnly=false,sessionIds}={}){
  const previous=this.config(vault);if(!previous.enabled&&!manual)return {changed:false,status:await this.status(vault)};
  const migrating=legacyLayout(previous);
  if(!previous.pendingCapture&&!migrating&&!Object.keys(previous.projects).length){if(manual)throw new Error('설정의 저널 자동기록에서 프로젝트를 선택해 주세요.');return {changed:false,status:await this.status(vault)};}
  const today=localDate(this.now());
  if(manual&&sessionIds!==undefined&&(!Array.isArray(sessionIds)||!sessionIds.length||sessionIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{20}$/.test(id))))throw new Error('가져올 세션을 선택해 주세요.');
  const selected=manual&&sessionIds!==undefined?new Set(sessionIds):null;
  if(previous.pendingCapture){
   if(checkOnly)return {pending:true};
   const recovered=await this.finishPending(vault);
   if(!selected)return recovered;
   const imported=await this.sync(vault,daily,manual,{sessionIds});
   return {...imported,changed:recovered.changed||imported.changed,migrated:recovered.migrated||imported.migrated,snapshot:imported.snapshot??recovered.snapshot};
  }
  const next=clone(previous);
  const sessions=sessionRecords(next.records),updated=new Set();
  const sourceKeys=new Map([...sessions].map(([id,session])=>[session.sourceKey??id,id]));
  let incompatible=false;
  const projects=(await this.projects(previous.sourceRoot)).filter(project=>Object.hasOwn(previous.projects,project.id));
  const sources=await this.projectSessions(previous,projects),matched=new Set();
  for(const {project,source} of sources.sessions){
    const sourceKey=captureId(project.key,source.sessionId),fileKey=captureId(project.key,source.id);
    if(selected&&!selected.has(sourceKey))continue;
    matched.add(sourceKey);
    const legacy=sessions.get(fileKey);
    const sessionId=sourceKeys.get(sourceKey)??(legacy&&!legacy.sourceKey?fileKey:sourceKey);
    if([sourceKey,fileKey,sessionId].some(key=>next.blocked.includes(`s:${key}`)))continue;
    let existing=sessions.get(sessionId);
    const seen=existing?.messages??new Map();
    let compatible;
    if(existing&&sessionId!==sourceKey&&!existing.sourceKey){
     compatible=compatibleSource(existing,source);
     if(compatible){
      existing.sourceKey=sourceKey;
      sourceKeys.set(sourceKey,sessionId);
      for(const entry of existing.entries){entry.sourceKey=sourceKey;updated.add(entry);}
     }
    }
    for(const message of source.messages){
     if(seen.has(message.id)||!Number.isFinite(message.at)||(!manual&&message.at<previous.projects[project.id].since))continue;
     const date=localDate(message.at);if(manual&&!selected&&date!==today)continue;
     const id=captureId(project.key,date);if(next.blocked.includes(`g:${id}`))continue;
     compatible??=compatibleSource(existing,source);
     if(!compatible){incompatible=true;break;}
     const record=next.records[id]??={id,date,label:project.label,path:`AI Conversations/${project.key}/${date}.md`,journalPath:periodicNote('daily',date,{folder:'Journal',...daily}).path,sessions:{}};
     let session=record.sessions[sessionId];
     if(!session){
      session=record.sessions[sessionId]={title:source.title||'대화',messages:[]};
      existing?.entries.push(session);
     }
     session.messages.push(message);
     updated.add(session);
     session.format=source.format;
     if(sessionId!==sourceKey)session.sourceKey=sourceKey;
     if(source.title)session.title=source.title;
     seen.set(message.id,message);
     if(!existing){
      existing={messages:seen,format:source.format,entries:[session]};
      sessions.set(sessionId,existing);
      sourceKeys.set(sourceKey,sessionId);
     }
    }
  }
  if(selected&&[...selected].some(id=>!matched.has(id)))throw new Error('선택한 세션을 읽을 수 없습니다. 세션 목록을 새로 불러와 주세요.');
  for(const session of updated)session.messages.sort((a,b)=>a.at-b.at);
  const changed=migrating||updated.size>0;
  if(checkOnly&&changed)return {pending:true};
  const result=changed?await this.commit(vault,previous,next):{changed:false,status:await this.status(vault)};
  if(sources.error||incompatible)result.status.error=[sources.error,incompatible&&'기존 기록과 메시지 식별자가 다른 세션은 가져오기를 보류했습니다.'].filter(Boolean).join(' · ');
  return result;
 }
 async trash(vault,{id,sessionId}){
  if(!/^[a-f0-9]{20}$/.test(id)||(sessionId!==undefined&&!/^[a-f0-9]{20}$/.test(sessionId)))throw new Error('잘못된 대화 기록입니다.');
  await this.finishPending(vault);
  const previous=this.config(vault),record=previous.records[id];
  if(!record||(sessionId&&!record.sessions[sessionId]))throw new Error('삭제할 대화 기록을 다시 확인해 주세요.');
  const next=clone(previous),trashId=randomUUID();
  const excluded=sessionId?[`s:${sessionId}`]:[`g:${id}`];
  const sourceKey=sessionId&&sessionRecords(previous.records).get(sessionId)?.sourceKey;
  if(sourceKey&&sourceKey!==sessionId)excluded.push(`s:${sourceKey}`);
  const blocks=excluded.filter(key=>!previous.blocked.includes(key));
  if(sessionId){delete next.records[id].sessions[sessionId];if(!Object.keys(next.records[id].sessions).length)delete next.records[id];}else delete next.records[id];
  next.blocked.push(...blocks);next.trashId=trashId;
  const directory=path.join(vault.recoveryRoot,'copilot-journal-trash');
  await atomic(path.join(directory,`${trashId}.json`),{record,sessionId,blocks});
  return {...await this.commit(vault,previous,next),trashId};
 }
 async restore(vault,trashId){
  if(!/^[a-f0-9-]{36}$/.test(trashId))throw new Error('잘못된 복원 항목입니다.');
  await this.finishPending(vault);
  const {record,sessionId,block,blocks=[block]}=JSON.parse(await readFile(path.join(vault.recoveryRoot,'copilot-journal-trash',`${trashId}.json`),'utf8'));
  const previous=this.config(vault),next=clone(previous),current=next.records[record.id]??={...record,sessions:{}};
  for(const [id,session] of Object.entries(record.sessions))if(!sessionId||sessionId===id){if(current.sessions[id])throw new Error('이미 복원된 대화입니다.');current.sessions[id]=session;}
  next.blocked=next.blocked.filter(value=>!blocks.includes(value));next.trashId=null;
  return this.commit(vault,previous,next);
 }
}
