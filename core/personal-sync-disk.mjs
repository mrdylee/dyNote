import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { assertSyncEntry, blobLimit, syncPrefix } from "./personal-sync-store.mjs";
import { checkTreeChanges } from "./personal-sync-merge.mjs";

export const batchLimit = 512 * 1024 * 1024;
const missing = error => { if (error.code !== "ENOENT") throw error; return null; };
const fold = s => s.normalize("NFC").toLowerCase();

export async function atomicJson(file, object) {
  await mkdir(path.dirname(file), {recursive:true,mode:0o700});
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(tmp,JSON.stringify(object),{flag:"wx",mode:0o600,flush:true});
    await rename(tmp,file);
  } finally { await rm(tmp,{force:true}); }
}

async function target(root, name, createParents = false) {
  assertSyncEntry(name,null);
  if (await realpath(root) !== root) throw new Error("보관함 위치가 변경되었습니다.");
  let current = root;
  const parts = name.split("/");
  for (const [index,part] of parts.entries()) {
    const entries = await readdir(current).catch(missing);
    if (entries && entries.some(other=>other !== part && fold(other) === fold(part)))
      throw new Error("대소문자 또는 유니코드 경로 충돌: " + name);
    current = path.join(current,part);
    const info = await lstat(current).catch(missing);
    if (info && (index === parts.length-1 ? !info.isFile() : !info.isDirectory()))
      throw new Error("링크 또는 특수 파일을 동기화할 수 없습니다: " + name);
    if (!info && createParents && index < parts.length-1) {
      await mkdir(current,{mode:0o700}).catch(error=>{if (error.code !== "EEXIST") throw error;});
      if (!(await lstat(current)).isDirectory()) throw new Error("동기화 경로가 변경되었습니다.");
    }
  }
  return current;
}

function signature(info) { return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(":"); }

export async function readStable(file, format, limit=blobLimit) {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(missing);
  if (!handle) return null;
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.size > BigInt(limit)) throw new Error("파일당 25 MiB 한도를 확인해 주세요: " + path.basename(file));
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes,offset,bytes.length-offset,offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await lstat(file,{bigint:true}).catch(missing);
    if (bytes.length !== offset || !after || signature(before) !== signature(after) || signature(before) !== signature(await handle.stat({bigint:true})))
      throw new Error("복사 또는 편집 중인 파일입니다: " + path.basename(file));
    const oid = createHash(format).update("blob " + bytes.length + "\0").update(bytes).digest("hex");
    return {oid,bytes,signature:signature(after)};
  } finally { await handle.close(); }
}

export class PersonalSyncDisk {
  constructor(store, format, limit=batchLimit) {
    this.store=store; this.format=format; this.limit=limit;
    this.dir=path.join(store.root,".git","dynote-personal");
    this.journal=path.join(this.dir,"apply.json");
  }
  async read(name) { return readStable(await target(this.store.root,name),this.format); }
  async head(ref="HEAD") { return (await this.store.git(["rev-parse","--verify","-q",ref],{allow:[0,1]})).stdout.trim() || null; }
  async job() {
    const raw=await readFile(this.journal,"utf8").catch(missing);
    if(!raw)return null;
    const job=JSON.parse(raw),uuid=s=>typeof s==="string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(s);
    const oid=s=>typeof s==="string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
    if(!uuid(job.id) || !oid(job.next) || (job.previous!==null && !oid(job.previous)) ||
      !Array.isArray(job.records) || !Array.isArray(job.captured) || !Number.isSafeInteger(job.offset) || job.offset<0 || job.offset>job.records.length)
      throw new Error("중단된 동기화의 로컬 기록을 확인해 주세요.");
    for(const row of job.records) {
      assertSyncEntry(row.name,null);
      if(!uuid(row.saved) || (row.before!==null && !oid(row.before)) || (row.after!==null && !oid(row.after)))throw new Error("파일 복구 기록이 손상되었습니다.");
    }
    return job;
  }

  async begin(branch, previous, next, captured=[]) {
    if (previous===next) return;
    const [before,after]=await Promise.all([this.store.tree(previous),this.store.tree(next)]);
    const changes=checkTreeChanges(before,after);
    const records=[...changes].map(name=>({name,before:before.get(name)?.oid ?? null,after:after.get(name)?.oid ?? null,
      mode:after.get(name)?.mode, size:after.get(name)?.size ?? 0, saved:randomUUID()}));
    const job={branch,previous,next,records,captured,offset:0,id:randomUUID()};
    // No worktree write precedes the durable candidate and the recovery manifest.
    await this.store.git(["update-ref","refs/dynote-sync/apply",next]);
    await atomicJson(this.journal,job);
  }

  async finishIndex(job) {
    const store=this.store, head=await this.head();
    const nextIndex=path.join(this.dir,job.id + ".index"), actual=path.join(store.root,".git","index"), lock=actual+".lock";
    if (!await stat(nextIndex).catch(missing)) await store.git(["read-tree",job.next],{privateIndex:nextIndex});
    await link(nextIndex,lock).catch(async error=>{
      if (error.code !== "EEXIST") throw error;
      const [ours,theirs]=await Promise.all([stat(nextIndex,{bigint:true}),stat(lock,{bigint:true})]);
      if (ours.ino!==theirs.ino || ours.dev!==theirs.dev) throw new Error("다른 Git 작업이 인덱스를 사용 중입니다.");
    });
    let locked=true;
    try {
      const check=path.join(this.dir,job.id+".check");
      await rm(check,{force:true});
      const copied=await copyFile(actual,check).then(()=>true).catch(missing);
      if (!copied) await store.git(["read-tree","--empty"],{privateIndex:check});
      const indexed=(await store.git(["write-tree"],{privateIndex:check})).stdout.trim();
      const treeOf=async ref=>(await store.git(ref ? ["rev-parse",ref+"^{tree}"] : ["mktree"],{input:""})).stdout.trim();
      if (indexed!==await treeOf(job.previous) && !(head===job.next && indexed===await treeOf(job.next)))
        throw new Error("직접 스테이징한 변경사항이 있습니다.");
      if ((await store.git(["symbolic-ref","HEAD"])).stdout.trim()!=="refs/heads/"+job.branch || (head!==job.previous && head!==job.next))
        throw new Error("적용 중 Git 브랜치가 변경되었습니다.");
      if (head!==job.next) await store.git(["update-ref","refs/heads/"+job.branch,job.next,head ?? "0".repeat(job.next.length)]);
      await rename(lock,actual);locked=false;
      await rm(check,{force:true});
    } finally {if(locked)await rm(lock,{force:true});}
    await rm(this.journal,{force:true});
    await rm(nextIndex,{force:true});
    await store.git(["update-ref","-d","refs/dynote-sync/apply",job.next]);
  }

  async resume() {
    const job=await this.job();
    if (!job) return {changed:[]};
    const captured=new Set(job.captured);
    let used=0;
    if (await this.head()!==job.previous && await this.head()!==job.next) throw new Error("적용 중 브랜치가 변경되었습니다.");
    for (;job.offset<job.records.length;job.offset++) {
      const row=job.records[job.offset];
      if (used && used+row.size>this.limit) {await atomicJson(this.journal,job);return {waiting:true,changed:[]};}
      if (captured.has(row.name)) continue; // New input after a local checkpoint stays dirty.
      const file=await target(this.store.root,row.name,true);
      const backup=path.join(this.dir,row.saved);
      const current=await readStable(file,this.format);
      if ((current?.oid ?? null)===row.after) {row.verified=current?.signature ?? null;continue;}
      const displaced=await lstat(backup).catch(missing);
      if ((current?.oid ?? null)!==row.before && !(displaced && !current)) {
        if (row.name.startsWith(syncPrefix)) throw new Error("공유 메타데이터가 외부에서 변경되었습니다.");
        // Reconcile this independent input against its actual parent on the next pass.
        return {diverged:{name:row.name,entry:current && await this.store.storeBytes(current.bytes),job},changed:[]};
      }
      if (current) {
        if (displaced) throw new Error("외부 파일을 다시 확인해야 합니다: "+row.name);
        if (!row.name.startsWith(syncPrefix)) await atomicJson(backup+".source.json",{name:row.name,parent:job.previous,oid:row.before});
        await rename(file,backup);
        const observed=await readStable(backup,this.format);
        if (observed.oid!==row.before) return {diverged:{name:row.name,entry:await this.store.storeBytes(observed.bytes),job},changed:[]};
      } else if (displaced && !row.name.startsWith(syncPrefix)) {
        const moved=await readStable(backup,this.format), marker=backup+".source.json";
        if(!await stat(marker).catch(missing))await atomicJson(marker,{name:row.name,parent:job.previous,oid:row.before});
        if(moved.oid!==row.before)return {diverged:{name:row.name,entry:await this.store.storeBytes(moved.bytes),job},changed:[]};
      }
      if (row.after) {
        const bytes=await this.store.blob(row.after);
        const temp=path.join(this.dir,randomUUID()+".part");
        try {
          await writeFile(temp,bytes,{flag:"wx",mode:row.mode==="100755"?0o755:0o644,flush:true});
          await link(temp,file);
        } finally {await rm(temp,{force:true});}
      }
      const applied=await readStable(file,this.format);
      if((applied?.oid ?? null)===row.after)row.verified=applied?.signature ?? null;
      used+=row.size;
    }
    // A completed chunk might have been edited while the application was stopped.
    for (const row of job.records) {
      if (captured.has(row.name)) continue;
      const file=await target(this.store.root,row.name);
      const info=await lstat(file,{bigint:true}).catch(missing);
      if(row.verified===(info?signature(info):null))continue;
      const current=await readStable(file,this.format);
      if ((current?.oid ?? null)!==row.after) {
        if(row.name.startsWith(syncPrefix)) throw new Error("수신 도중 공유 메타데이터가 변경되었습니다.");
        job.offset=job.records.indexOf(row);
        return {diverged:{name:row.name,entry:current && await this.store.storeBytes(current.bytes),job,parent:job.next},changed:[]};
      }
    }
    await this.finishIndex(job);
    return {changed:job.records.map(r=>r.name).filter(name=>!name.startsWith(syncPrefix) && !captured.has(name))};
  }
}
