import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { validateGitConfig } from "./git-backup.mjs";
import { validPersonalFilePath } from "./vault.mjs";
import { PersonalSyncStore, deviceRecord, devicePath, syncPrefix } from "./personal-sync-store.mjs";
import { checkTreeChanges, chooseVersion, integrate, normalizePublished } from "./personal-sync-merge.mjs";
import { textChoices } from "./personal-sync-text.mjs";
import { scanLinks,resolvePath,createLinkIndex } from "./links.mjs";
import { PersonalSyncDisk, atomicJson, readStable } from "./personal-sync-disk.mjs";

export async function installDevice(settingsDir) {
  await mkdir(settingsDir,{recursive:true});
  const file=path.join(settingsDir,"personal-sync-device");
  let id=await readFile(file,"utf8").catch(error=>{if(error.code!=="ENOENT")throw error;});
  if (!id) {
    const temp=file+"."+randomUUID();
    try {
      await writeFile(temp,randomUUID(),{flag:"wx",mode:0o600});
      await link(temp,file).catch(error=>{if(error.code!=="EEXIST")throw error;});
      id=await readFile(file,"utf8");
    } finally {await rm(temp,{force:true});}
  }
  return deviceRecord(id,"PC").id;
}

export function personalConfig(input) {
  const config=validateGitConfig(input);
  const name=deviceRecord("00000000-0000-0000-0000-000000000000",input.deviceName).name;
  return {...config,mode:"personal-sync",push:true,deviceName:name};
}

function completeArchive(name, bytes) {
  if (/\.pdf$/i.test(name)) return /%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"));
  if (!/\.(zip|xlsx|pptx)$/i.test(name)) return true;
  const start=Math.max(0,bytes.length-65557);
  for (let i=bytes.length-22;i>=start;i--) {
    if (bytes.readUInt32LE(i)!==0x06054b50 || i+22+bytes.readUInt16LE(i+20)!==bytes.length) continue;
    const offset=bytes.readUInt32LE(i+16),length=bytes.readUInt32LE(i+12);
    return offset+length===i && (length===0 ? i===0 : length>=46 && bytes.readUInt32LE(offset)===0x02014b50);
  }
  return false;
}

export class PersonalSync {
  constructor(vault,run,deviceId,{now=Date.now,batchLimit}={}) {
    this.store=new PersonalSyncStore(vault.root,run); this.deviceId=deviceId; this.vault=vault;
    this.now=now; this.limit=batchLimit; this.observed=new Map(); this.confirmed=new Map();
    this.waiting=new Map(); this.firstDirty=null; this.changed=[];
  }
  async init() {
    if (this.disk) return;
    const format=(await this.store.git(["rev-parse","--show-object-format"])).stdout.trim();
    this.disk=new PersonalSyncDisk(this.store,format,this.limit);
  }
  async dirty() {
    const list=(await this.store.git(["ls-files","-m","-d","-o","--exclude-standard","-z"])).stdout;
    return [...new Set(list.split("\0").filter(Boolean))];
  }
  async previewZip() {
    const result=await this.store.git(["ls-files","--cached","--others","--exclude-standard","-z"]);
    return [...new Set(result.stdout.split("\0").filter(name=>validPersonalFilePath(name) && /\.zip$/i.test(name)))].sort();
  }
  async confirm(name,expected) {
    const file=await this.disk.read(name);
    if (!file || file.oid!==expected) throw new Error("파일이 다시 변경되었습니다. 현재 버전을 확인해 주세요.");
    this.confirmed.set(name,file.oid);
  }
  async capture(head,device,config,dirty,register) {
    const files=await this.store.tree(head), updates=new Map(), captured=[];
    const registry=(await this.store.metadata(files)).devices.find(entry=>entry.id===device.id);
    if (registry && !registry.active && !register) throw new Error("이 기기의 등록이 해제되었습니다. 설정에서 다시 연결해 주세요.");
    if (register || !registry) {
      const entry=await this.store.storeRecord(device);
      if(files.get(devicePath(device.id))?.oid!==entry.oid) updates.set(devicePath(device.id),entry);
    }
    let size=0;
    this.waiting.clear();
    for (const name of dirty) {
      if (name.startsWith(syncPrefix) || (!validPersonalFilePath(name) && files.has(name)))
        throw new Error("Git에서 직접 변경한 관리 대상 밖 파일을 확인해 주세요: "+name);
      if (!validPersonalFilePath(name)) continue;
      let current;
      try {current=await this.disk.read(name);}
      catch(error){this.waiting.set(name,{name,message:error.message});continue;}
      if ((current?.oid ?? null)===(files.get(name)?.oid ?? null)) continue;
      if (current && /\.(xlsx|pptx|pdf|zip)$/i.test(name) && this.confirmed.get(name)!==current.oid) {
        const previous=this.observed.get(name);
        if (!previous || previous.sig!==current.signature) this.observed.set(name,{sig:current.signature,at:this.now()});
        const observation=this.observed.get(name);
        if (this.now()-observation.at<1500 || !completeArchive(name,current.bytes)) {
          this.waiting.set(name,{name,oid:current.oid,message:"복사 완료 대기"});continue;
        }
      }
      if (current && size+current.bytes.length>this.disk.limit && captured.length) {
        this.waiting.set(name,{name,message:"다음 묶음 대기"});continue;
      }
      size+=current?.bytes.length ?? 0;
      const entry=current ? await this.store.storeBytes(current.bytes) : null;
      if (entry && files.get(name)) entry.mode=files.get(name).mode;
      updates.set(name,entry); captured.push(name);
    }
    if (this.waiting.size) {
      const targets=[...new Set([...dirty,...files.keys()])].filter(validPersonalFilePath).map(path=>({path}));
      const index=createLinkIndex(targets);
      for(const [name,entry] of updates) {
        if(!entry || !/\.md$/i.test(name)) continue;
        const source=(await this.store.blob(entry.oid)).toString("utf8");
        const waiting=scanLinks(source).some(link=>this.waiting.has(resolvePath(link.target,name,targets,{kind:link.kind,index}).path));
        if(waiting) {updates.delete(name);captured.splice(captured.indexOf(name),1);this.waiting.set(name,{name,message:"연결된 첨부 파일 대기"});}
      }
    }
    if (!updates.size) return head;
    const tree=await this.store.writeTree(head,updates);
    const next=await this.store.commitTree(tree,head?[head]:[],"개인노트 저장 · "+device.name,device,config);
    await this.disk.begin(config.branch,head,next,captured);
    return next;
  }
  async rememberInput(parent,name,entry,device,config) {
    const tree=await this.store.writeTree(parent,new Map([[name,entry]]));
    const commit=await this.store.commitTree(tree,parent?[parent]:[],"동기화 중 로컬 편집 보존",device,config);
    await this.store.git(["update-ref","refs/dynote-sync/inputs/"+commit,commit]);
    return commit;
  }
  async resume(device,config) {
    while (true) {
      const job=await this.disk.job();
      if (job && job.branch!==config.branch) throw new Error("진행 중인 적용 작업의 브랜치가 다릅니다.");
      const result=this.vault.applyPersonalSync ? await this.vault.applyPersonalSync(()=>this.disk.resume()) : await this.disk.resume();
      if (!result.diverged) {this.changed.push(...result.changed);return !result.waiting;}
      const {job:work,name,entry}=result.diverged;
      const parent=result.diverged.parent ?? work.previous;
      if (!parent) throw new Error("가져오는 동안 로컬 파일이 생겼습니다. 파일을 보존한 뒤 빈 폴더로 다시 연결해 주세요.");
      await this.rememberInput(parent,name,entry,device,config);
      const row=work.records[work.offset];
      row.before=(await this.disk.read(name))?.oid ?? null;
      if (row.before && row.before!==entry?.oid) continue;
      row.saved=randomUUID();
      await atomicJson(this.disk.journal,work);
    }
  }
  async saveDraft(name,content,expectedRevision,config) {
    if (!/\.md$/i.test(name) || !validPersonalFilePath(name) || typeof content!=="string" || Buffer.byteLength(content)>25*1024*1024) return null;
    const inputs=(await this.store.git(["for-each-ref","--format=%(objectname)","refs/dynote-sync/inputs/"])).stdout.trim().split("\n").filter(Boolean);
    const refs=[...inputs,...(await this.store.git(["log","--full-history","--format=%H","HEAD","--",name])).stdout.trim().split("\n").filter(Boolean)];
    for(const ref of refs) {
      const file=(await this.store.tree(ref)).get(name);
      if(!file || file.type!=="blob" || file.size>25*1024*1024)continue;
      const bytes=await this.store.blob(file.oid);
      if(createHash("sha256").update(bytes).digest("hex")!==expectedRevision)continue;
      const entry=await this.store.storeBytes(Buffer.from(content));
      await this.rememberInput(ref,name,entry,deviceRecord(this.deviceId,config.deviceName),config);
      return {path:name,content,revision:createHash("sha256").update(content).digest("hex"),preserved:true};
    }
    return null;
  }
  async externalWrites(device,config) {
    this.recoveryBytes=0;
    for(const file of await readdir(this.disk.dir).catch(error=>{if(error.code!=="ENOENT")throw error;return [];})) {
      if (!/^[a-f\d-]{36}\.source\.json$/.test(file)) continue;
      const marker=path.join(this.disk.dir,file), source=JSON.parse(await readFile(marker,"utf8"));
      const backup=marker.slice(0,-12);
      const info=await lstat(backup,{bigint:true}).catch(error=>{if(error.code!=="ENOENT")throw error;return null;});
      if (!info) {await rm(marker,{force:true});continue;}
      this.recoveryBytes+=Number(info.size);
      const stamp=[info.size,info.ctimeNs,info.mtimeNs].join(":");
      if(source.stamp===stamp)continue;
      const current=await readStable(backup,this.disk.format);
      if (current.oid!==source.oid) await this.rememberInput(source.parent,source.name,await this.store.storeBytes(current.bytes),device,config);
      await atomicJson(marker,{...source,stamp,oid:current.oid});
    }
  }
  async validateRange(previous,head) {
    if (!head || previous===head) return;
    const refs=(await this.store.git(["rev-list","--reverse","--parents",head,...(previous?["^"+previous]:[])])).stdout.trim().split("\n").filter(Boolean);
    for(const row of refs) {
      const [ref,parent]=row.split(" ");
      const before=await this.store.tree(parent), after=await this.store.tree(ref);
      checkTreeChanges(before,after);
      await this.store.metadata(after);
    }
  }
  async sync(input,{force=true,register=false}={}) {
    const config=personalConfig(input), device=deviceRecord(this.deviceId,config.deviceName);
    await this.init();
    const status=async (waiting=false)=>{
      const files=await this.store.tree(await this.disk.head()), {devices,groups}=await this.store.metadata(files);
      const conflicts=[...groups].filter(([,g])=>g.pending.length).map(([name,g])=>({name,count:g.pending.length}));
      const changed=this.changed.splice(0);
      return {phase:waiting || this.firstDirty!==null || this.waiting.size?"pending":"synced",message:waiting?"다음 묶음 동기화 대기":this.waiting.size?"파일 "+this.waiting.size+"개 전송 대기":this.firstDirty!==null?"기기에 저장됨":conflicts.length?"버전 확인 "+conflicts.length+"개":"동기화됨",
        conflicts,devices:devices.filter(d=>d.active),deviceId:device.id,pendingFiles:[...this.waiting.values()],changed,recoveryBytes:this.recoveryBytes ?? 0,
        ...(!waiting?{lastSuccess:new Date(this.now()).toISOString()}:{})};
    };
    if (!await this.resume(device,config)) return status(true);
    await this.store.assertReady(config);
    await this.externalWrites(device,config);
    let head=await this.disk.head();
    const remoteKey=createHash("sha256").update(config.remote+"\0"+config.branch).digest("hex");
    const ref="refs/dynote-sync/remotes/"+remoteKey;
    let seen=await this.disk.head(ref);
    const dirty=await this.dirty();
    if (dirty.some(validPersonalFilePath)) this.firstDirty??=this.now();
    else {this.firstDirty=null;this.waiting.clear();}
    const checkpoint=async (registerNow=false)=>{
      await this.capture(head,device,config,await this.dirty(),registerNow);
      const done=await this.resume(device,config);
      head=await this.disk.head();this.firstDirty=this.waiting.size?this.firstDirty:null;
      return done;
    };
    // On an established connection an outage still leaves a local Git checkpoint.
    if ((head || !register) && (force || this.firstDirty!==null && this.now()-this.firstDirty>=300000))
      if (!await checkpoint(register)) return status(true);
    for (let attempt=0;attempt<4;attempt++) {
      let remote=await this.store.remoteHead(config);
      if (seen && !remote)throw new Error("원격 브랜치가 삭제되었습니다. 로컬 기록을 보존했습니다.");
      if (remote) {
        await this.store.git(["fetch","--no-tags","--no-recurse-submodules","--",config.remote,"refs/heads/"+config.branch]);
        remote=await this.disk.head("FETCH_HEAD");
        if (seen && (await this.store.git(["merge-base","--is-ancestor",seen,remote],{allow:[0,1]})).code)
          throw new Error("원격 Git 이력이 재작성되었습니다. 로컬 기록을 보존했습니다.");
        if (!seen && head && (await this.store.git(["merge-base",head,remote],{allow:[0,1]})).code)
          throw new Error("공통 Git 이력이 없는 저장소입니다.");
        await this.validateRange(seen ?? (head && (await this.store.git(["merge-base",head,remote])).stdout.trim()),remote);
        const registration=(await this.store.metadata(await this.store.tree(remote))).devices.find(d=>d.id===device.id);
        if(registration && !registration.active && !register) throw new Error("이 기기의 등록이 해제되었습니다. 다시 연결해 주세요.");
        await this.store.git(["update-ref",ref,remote]);seen=remote;
      }
      if (remote && !head && dirty.some(validPersonalFilePath)) throw new Error("원격에 문서가 있습니다. 기존 저장소 가져오기로 빈 폴더를 선택해 주세요.");
      if (remote!==head && head && this.firstDirty!==null && !await checkpoint()) return status(true);
      const normalized=await normalizePublished(this.store,remote,device,config);
      let merged=await integrate(this.store,normalized,head,device,config);
      const inputs=(await this.store.git(["for-each-ref","--format=%(objectname)","refs/dynote-sync/inputs/"])).stdout.trim().split("\n").filter(Boolean);
      for(const saved of inputs) merged=await integrate(this.store,merged,saved,device,config);
      if (merged!==head) {
        await this.disk.begin(config.branch,head,merged);
        if (!await this.resume(device,config)) return status(true);
        head=merged;
      }
      for(const saved of inputs) await this.store.git(["update-ref","-d","refs/dynote-sync/inputs/"+saved,saved]);
      if (register || !head || !(await this.store.tree(head)).has(devicePath(device.id))) {
        if (!await checkpoint(true)) return status(true);
        register=false;
      }
      if (!head || remote===head) return status();
      if (remote && (await this.store.git(["merge-base","--is-ancestor",remote,head],{allow:[0,1]})).code)
        throw new Error("원격 이력 보호를 위해 업로드를 중지했습니다.");
      await this.validateRange(remote,head);
      const dst="refs/heads/"+config.branch;
      try {
        await this.store.git(["push","--porcelain","--no-verify","--recurse-submodules=no","--force-with-lease="+dst+":"+(remote || ""),"--",config.remote,head+":"+dst]);
      } catch(error) {
        if(attempt===3 || await this.store.remoteHead(config)===remote)throw error;
        await new Promise(resolve=>setTimeout(resolve,30+Math.random()*150));continue;
      }
      await this.store.git(["update-ref",ref,head]);return status();
    }
  }
  async versions(name,skip=0) {
    if(!validPersonalFilePath(name) || !Number.isSafeInteger(skip) || skip<0)throw new Error("잘못된 파일 경로입니다.");
    const files=await this.store.tree(await this.disk.head()), group=(await this.store.metadata(files)).groups.get(name);
    const basis=group?.pending ?? [];
    return {basis,current:files.get(name)?.oid ?? null,versions:basis.map(id=>group.versions.get(id)).sort((a,b)=>a.time.localeCompare(b.time)||a.commit.localeCompare(b.commit)).slice(skip,skip+50)};
  }
  async blockedSessions() {
    const head=await this.disk?.head();
    if(!head)return new Set();
    const files=await this.store.tree(head), states=await this.store.metadata(files);
    const blocked=new Set([...states.groups].filter(([,g])=>g.pending.length).map(([name])=>name));
    const log=await this.store.git(["log","--full-history","-m","--diff-filter=D","--format=","--name-only","-z",head,"--","Copilot Note","AI Conversations"]);
    for(const name of log.stdout.split("\0")) if(name && !files.has(name)) blocked.add(name);
    return blocked;
  }
  async hunks(name) {
    const files=await this.store.tree(await this.disk.head()),group=(await this.store.metadata(files)).groups.get(name);
    const parts=group && await textChoices(this.store,name,group.pending.map(id=>group.versions.get(id)));
    return parts?.filter(part=>typeof part!=="string") ?? [];
  }
  async removeDevice(config,id) {
    if (id===this.deviceId) throw new Error("현재 기기에서는 동기화를 끈 뒤 다른 기기에서 등록을 해제하세요.");
    const state=await this.sync(config),head=await this.disk.head(),files=await this.store.tree(head);
    const other=(await this.store.metadata(files)).devices.find(d=>d.id===id && d.active);
    if (!other || await this.disk.job()) throw new Error("기기 목록을 다시 확인해 주세요.");
    const record=await this.store.storeRecord(deviceRecord(id,other.name,false));
    const tree=await this.store.writeTree(head,new Map([[devicePath(id),record]]));
    const commit=await this.store.commitTree(tree,[head],"기기 등록 해제 · "+other.name,deviceRecord(this.deviceId,config.deviceName),config);
    await this.disk.begin(config.branch,head,commit);this.changed.push(...state.changed);
    return this.sync(config);
  }
  async preview(name,id) {
    const files=await this.store.tree(await this.disk.head());
    const version=(await this.store.metadata(files)).groups.get(name)?.versions.get(id);
    if(!version)throw new Error("검토할 버전이 없습니다.");
    return version.blob ? await this.store.blob(version.blob) : null;
  }
  async resolve(config,name,basis,id,options) {
    const device=deviceRecord(this.deviceId,config.deviceName);
    const state=await this.sync(config);
    if(await this.disk.job() || this.waiting.has(name))throw new Error("파일 수신이 완료되면 다시 적용해 주세요.");
    const head=await this.disk.head(),next=await chooseVersion(this.store,head,name,basis,id,device,config,options);
    await this.disk.begin(config.branch,head,next);this.changed.push(...state.changed);
    return this.sync(config);
  }
}
