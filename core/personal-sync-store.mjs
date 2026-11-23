import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { GitBackup } from "./git-backup.mjs";
import { validPersonalFilePath } from "./vault.mjs";

export const syncPrefix = ".dynote-sync/";
export const blobLimit = 25 * 1024 * 1024;
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const oidPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const sha256 = value => createHash("sha256").update(value).digest("hex");
export const conflictFolder = name => syncPrefix + "conflicts/" + sha256(name) + "/";
export const devicePath = id => syncPrefix + "devices/" + id + ".json";

export function deviceRecord(id, name, active = true) {
  if (!idPattern.test(id) || typeof name !== "string" || !name.trim() || name.trim().length > 80 || /[\u0000-\u001f\u007f]/u.test(name) || typeof active !== "boolean")
    throw new Error("기기 이름과 등록 정보를 확인해 주세요.");
  return { id, name: name.trim(), active };
}

function metaType(name) {
  const parts = name.split("/");
  if (parts[0] !== ".dynote-sync") return null;
  if (parts.length === 3 && parts[1] === "devices" && parts[2].endsWith(".json") && idPattern.test(parts[2].slice(0,-5))) return "device";
  if (parts.length !== 4 || parts[1] !== "conflicts" || !/^[a-f0-9]{64}$/.test(parts[2])) return null;
  const leaf = parts[3];
  if (leaf.endsWith(".blob") && oidPattern.test(leaf.slice(0,-5))) return "body";
  if (leaf.endsWith(".json") && oidPattern.test(leaf.slice(0,-5))) return "version";
  if (leaf.endsWith(".choice.json") && idPattern.test(leaf.slice(0,-12))) return "choice";
  return null;
}

export function assertSyncEntry(name, entry) {
  const kind = metaType(name);
  if (!kind && !validPersonalFilePath(name)) throw new Error("동기화 범위 밖의 경로입니다: " + name);
  if (!entry) return;
  if (entry.type !== "blob" || !["100644","100755"].includes(entry.mode) || !oidPattern.test(entry.oid))
    throw new Error("일반 파일만 동기화할 수 있습니다: " + name);
  if (!Number.isSafeInteger(entry.size) || entry.size<0 || entry.size > (kind && kind !== "body" ? 65536 : blobLimit)) throw new Error("동기화 크기 한도를 넘었습니다: " + name);
  if (kind === "body" && !name.endsWith("/" + entry.oid + ".blob")) throw new Error("버전 사본의 해시가 다릅니다.");
}

export class PersonalSyncStore extends GitBackup {
  async tree(ref) {
    const files = new Map();
    if (!ref) return files;
    const data = (await this.git(["ls-tree","-r","-l","-z",ref], {encoding:null})).stdout;
    const raw = new TextDecoder("utf-8", {fatal:true}).decode(data);
    for (const row of raw.split("\0").filter(Boolean)) {
      const split = row.indexOf("\t");
      const [mode,type,oid,size] = row.slice(0,split).split(/\s+/);
      files.set(row.slice(split+1), {mode,type,oid,size:Number(size)});
    }
    return files;
  }
  async blob(oid) { return (await this.git(["cat-file","blob",oid], {encoding:null})).stdout; }
  async storeBytes(bytes) {
    const oid = (await this.git(["hash-object","-w","--stdin"], {input:bytes})).stdout.trim();
    return {mode:"100644",type:"blob",oid,size:bytes.length};
  }
  async storeRecord(value) { return this.storeBytes(Buffer.from(JSON.stringify(value) + "\n")); }

  async metadata(files) {
    const devices = [], groups = new Map();
    for (const [name, entry] of files) {
      if (!name.startsWith(syncPrefix)) continue;
      assertSyncEntry(name, entry);
      const kind = metaType(name);
      if (kind === "body") continue;
      const record = JSON.parse((await this.blob(entry.oid)).toString("utf8"));
      if (kind === "device") {
        const device = deviceRecord(record.id, record.name, record.active);
        if (name !== devicePath(device.id)) throw new Error("기기 ID와 파일 이름이 다릅니다.");
        devices.push(device);
        continue;
      }
      if (!validPersonalFilePath(record.path) || !name.startsWith(conflictFolder(record.path)))
        throw new Error("버전 기록의 경로가 다릅니다.");
      if (!groups.has(record.path)) groups.set(record.path, {versions:new Map(), choices:[]});
      const group = groups.get(record.path);
      if (kind === "choice") {
        if (!Array.isArray(record.basis) || !record.basis.length || !record.basis.every(v=>oidPattern.test(v)) ||
            (record.blob !== null && !oidPattern.test(record.blob))) throw new Error("버전 선택 기록이 손상되었습니다.");
        group.choices.push({...record,key:name});
      } else {
        if (!oidPattern.test(record.commit) || name !== conflictFolder(record.path) + record.commit + ".json" ||
            (record.blob !== null && (!oidPattern.test(record.blob) || !files.has(conflictFolder(record.path) + record.blob + ".blob"))))
          throw new Error("검토할 버전의 원본이 없습니다.");
        if (typeof record.author!=="string" || typeof record.device!=="string" || typeof record.id!=="string" || !Number.isFinite(Date.parse(record.time))) throw new Error("버전 출처를 확인할 수 없습니다.");
        group.versions.set(record.commit, record);
      }
    }
    for (const group of groups.values()) {
      const covered = new Set(group.choices.flatMap(choice=>choice.basis));
      for (const id of covered) if (!group.versions.has(id)) throw new Error("버전 선택의 근거가 누락되었습니다.");
      group.pending = [...group.versions.keys()].filter(id=>!covered.has(id)).sort();
    }
    return {devices, groups};
  }

  async writeTree(base, updates) {
    const dir = await mkdtemp(path.join(this.root, ".git", "dynote-index-"));
    const privateIndex = path.join(dir,"index");
    try {
      await this.git(["read-tree",...(base ? [base] : ["--empty"])], {privateIndex});
      const format = (await this.git(["rev-parse","--show-object-format"])).stdout.trim();
      const zero = "0".repeat(format === "sha256" ? 64 : 40);
      const data = [...updates].map(([name, entry]) => {
        assertSyncEntry(name,entry);
        return (entry ? entry.mode + " " + entry.oid : "0 " + zero) + "\t" + name + "\0";
      }).join("");
      if (data) await this.git(["update-index","-z","--index-info"], {privateIndex,input:data});
      return (await this.git(["write-tree"], {privateIndex})).stdout.trim();
    } finally { await rm(dir, {recursive:true,force:true}); }
  }

  async commitTree(tree, parents, subject, device, config) {
    const options = [];
    if (config.authorName) options.push("-c","user.name=" + config.authorName);
    if (config.authorEmail) options.push("-c","user.email=" + config.authorEmail);
    const message = subject + "\n\nDynote-Device: " + device.id + "\nDynote-Device-Name: " + device.name + "\n";
    return (await this.git([...options,"commit-tree",tree,...parents.flatMap(p=>["-p",p]),"-F","-"],{input:message})).stdout.trim();
  }

  async attribution(ref, name) {
    const result = (await this.git(["log","-1","--no-show-signature","--format=%H%x00%cI%x00%an%x00%(trailers:key=Dynote-Device-Name,valueonly,separator=%x20)%x00%(trailers:key=Dynote-Device,valueonly,separator=%x20)",ref,"--",name])).stdout;
    const [commit,time,author,device,id] = result.trimEnd().split("\0");
    if (!oidPattern.test(commit)) throw new Error("버전의 원본 커밋을 찾을 수 없습니다.");
    return {commit,time,author,device:device?.trim() || "",id:id?.trim() || ""};
  }

  async preserve(updates, files, ref, name, entry, sourcePath=name) {
    const source = await this.attribution(ref,sourcePath);
    const folder = conflictFolder(name), key = folder + source.commit + ".json";
    if (files.has(key) || updates.has(key)) return;
    if (entry) updates.set(folder + entry.oid + ".blob", {...entry,mode:"100644"});
    updates.set(key, await this.storeRecord({...source,path:name,blob:entry?.oid ?? null}));
  }

  async choice(name, basis, blob) {
    return [conflictFolder(name) + randomUUID() + ".choice.json", await this.storeRecord({path:name,basis,blob})];
  }
}
