import { readFile, writeFile, rename, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { PersonalSync, installDevice, personalConfig } from "../core/personal-sync.mjs";
import { validPersonalFilePath } from "../core/vault.mjs";
import { GitBackup, validateGitConfig, runGit } from "../core/git-backup.mjs";

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const settingsWrites = new Map();

export class GitController {
  constructor({ settingsFile, run = runGit, onStatus = () => {}, isPersonal = () => false, setTimer = setInterval, clearTimer = clearInterval, now = () => new Date() }) {
    Object.assign(this, { settingsFile, run, onStatus, isPersonal, setTimer, clearTimer, now });
    this.records = {}; this.tail = Promise.resolve(); this.timer = null; this.generation = 0;
    this.revision = 0; this.pendingSync = null; this.retryAfter = 0;
    this.current = { enabled: false, phase: "off", message: "Git 백업 미설정", config: null };
  }
  status() { return { ...this.current, vaultId: this.vault?.id }; }
  publish(update) { Object.assign(this.current, update); this.onStatus(this.status()); return this.status(); }
  enqueue(action) {
    const result = this.tail.then(action); this.tail = result.catch(() => {}); return result;
  }
  check(id) { if (id !== this.vault?.id) throw new Error("보관함이 변경되었습니다. Git 설정을 다시 열어 주세요."); }
  markDirty(id) {
    if (id !== this.vault?.id) return;
    this.revision++;
    if (this.current.enabled && this.current.config?.mode==="personal-sync" && this.personal) this.scheduleBatch();
    if (this.current.enabled && !["saving", "error"].includes(this.current.phase)) this.publish({ phase: "pending", message: "Git 자동 저장 대기 중" });
  }
  scheduleBatch() {
    this.personal.firstDirty ??= this.now().getTime();
    if(this.batchTimer)return;
    const id=this.vault.id, generation=this.generation;
    const delay=this.personal.firstDirty+300000-this.now().getTime();
    if(delay<=0)return;
    this.batchTimer=setTimeout(()=>{
      this.batchTimer=null;
      if (generation===this.generation) this.sync(id,{automatic:true}).catch(()=>{});
    },delay);
    this.batchTimer.unref?.();
  }
  close() {
    this.generation++;clearTimeout(this.batchTimer);this.batchTimer=null;
    this.watcher?.close(); this.watcher=null;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
  async startPersonal() {
    if (!this.isPersonal(this.vault)) throw new Error("개인 노트 공간에서만 양방향 동기화를 사용할 수 있습니다.");
    this.personal ??= new PersonalSync(this.vault,this.run,await installDevice(path.dirname(this.settingsFile)),{now:()=>this.now().getTime()});
    return this.personal;
  }
  async zipList() {
    await this.startPersonal();
    if (await this.service.repository()) return this.personal.previewZip();
    const names=[];
    const visit=async folder=>{
      for (const entry of await readdir(path.join(this.vault.root,folder),{withFileTypes:true})) {
        if (entry.name.startsWith(".")) continue;
        const name=folder ? folder+"/"+entry.name : entry.name;
        if (entry.isDirectory()) await visit(name);
        else if (entry.isFile() && validPersonalFilePath(name) && /\.zip$/i.test(name)) names.push(name);
      }
    };
    await visit("");return names.sort();
  }
  async saveNote(name,content,revision,save) {
    if(!this.current.enabled || this.current.config?.mode!=="personal-sync")return save();
    try { return await save(); } catch(error) {
      if (!this.isPersonal(this.vault) || (error.code!=="ENOENT" && !/외부.*변경/.test(error.message))) throw error;
      return this.enqueue(async()=>{
        const service=await this.startPersonal();
        const draft=await service.saveDraft(name,content,revision,this.current.config);
        if(!draft)throw error;
        this.sync(this.vault.id).catch(()=>{});
        return draft;
      });
    }
  }
  async personalAction(id,args) {
    return this.enqueue(async()=>{
      this.check(id);
      if (!this.current.enabled || this.current.config?.mode!=="personal-sync") throw new Error("개인 동기화를 먼저 연결해 주세요.");
      const service=await this.startPersonal();await service.init();
      if (args.action==="versions") return service.versions(args.path,args.skip);
      if (args.action==="preview") return service.preview(args.path,args.commit);
      if (args.action==="hunks") return service.hunks(args.path);
      if (args.action==="confirm") await service.confirm(args.path,args.oid);
      else if(args.action==="device") return this.publish(await service.removeDevice(this.current.config,args.deviceId));
      else if(args.action==="resolve") return this.publish(await service.resolve(this.current.config,args.path,args.basis,args.commit,args.options));
      else throw new Error("알 수 없는 동기화 작업입니다.");
      return this.perform();
    });
  }
  schedule() {
    this.close();
    if (!this.current.enabled) return;
    const generation = this.generation, id = this.vault.id;
    const personal=this.current.config?.mode==="personal-sync";
    if (personal) {
      try {
        this.watcher=watch(this.vault.root,{recursive:true},(_type,name)=>{
          const relative=String(name ?? "").split(path.sep).join("/");
          if (validPersonalFilePath(relative) && generation===this.generation) this.scheduleBatch();
        });
        this.watcher.on("error",()=>this.watcher?.close());
      } catch { /* Periodic discovery also covers hosts without recursive watch. */ }
    }
    this.timer = this.setTimer(() => generation === this.generation ? this.sync(id, { automatic: true }).catch(() => {}) : undefined, personal ? 55000+Math.floor(Math.random()*5000) : 60000);
    this.timer?.unref?.();
  }
  async persist() {
    const file = this.settingsFile;
    const id = this.vault.id;
    const record = { ...this.records[id] };
    const previous = settingsWrites.get(file) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(async () => {
      let records;
      try { records = JSON.parse(await readFile(file, "utf8")); }
      catch (error) {
        if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(temporary, JSON.stringify({ ...records, [id]: record }), { mode: 0o600 });
      await rename(temporary, file);
    });
    settingsWrites.set(file, result);
    try { await result; }
    finally { if (settingsWrites.get(file) === result) settingsWrites.delete(file); }
  }
  open(vault) {
    this.close();
    return this.enqueue(async () => {
      this.vault = vault; this.personal=null;
      this.canonicalRoot = await realpath(vault.root);
      this.service = new GitBackup(vault.root, this.run);
      this.retryAfter = 0;
      this.current = { enabled: false, phase: "off", message: "Git 백업 미설정", config: null };
      try {
        this.records = JSON.parse(await readFile(this.settingsFile, "utf8"));
        const record = this.records[vault.id];
        if (record) this.current = {
          config: record.mode==="personal-sync" ? personalConfig(record) : validateGitConfig(record), enabled: record.enabled === true && (record.mode!=="personal-sync" || this.isPersonal(vault)), lastSuccess: record.lastSuccess,
          lastBackupDay: record.lastBackupDay ?? (record.lastSuccess && Number.isFinite(Date.parse(record.lastSuccess)) ? dayKey(new Date(record.lastSuccess)) : null),
          pendingCommit: record.pendingCommit ?? null,
          phase: record.enabled ? "ready" : "off", message: record.enabled ? "Git 일일 백업 대기 중" : "Git 자동 저장 꺼짐",
        };
      } catch (error) {
        if (error.code !== "ENOENT") this.current.message = "Git 설정을 읽지 못했습니다. 저장소를 다시 연결해 주세요.";
        this.records = {};
      }
      if (this.current.enabled && this.current.config?.mode==="personal-sync") await this.startPersonal();
      this.schedule();
      // Enqueue after local startup; the window must not wait for network I/O.
      if (this.current.enabled) this.sync(vault.id, { automatic: true }).catch(() => {});
      return this.publish({});
    });
  }
  connect(id, input) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      try {
        if(input.mode==="personal-sync") {
          const config=personalConfig(input), service=await this.startPersonal();
          const zips=await this.zipList();
          if(!Array.isArray(input.zipPaths) || zips.some(name=>!input.zipPaths.includes(name))) throw new Error("전송할 ZIP 목록을 다시 확인해 주세요.");
          const exists=await this.service.repository();
          const prior=this.current.config;
          if (!exists || !this.current.enabled || prior?.mode !== "personal-sync" || prior.remote !== config.remote || prior.branch !== config.branch)
            await this.service.checkPersonalConnection(config, exists);
          if (!exists) {
            await this.service.git(["init","--initial-branch="+config.branch]);
            await this.service.git(["remote","add","origin",config.remote]);
          }
          await service.init();
          if (!await service.disk.job()) await this.service.assertReady(config);
          // Persist the selected destination before a local checkpoint can enter its history.
          this.records[id]={...config,enabled:true,registerPending:true};
          await this.persist();
          this.publish({config,enabled:true,lastSuccess:null,lastBackupDay:null,pendingCommit:null,changed:[],conflicts:[],devices:[]});
          this.schedule();return this.perform();
        }
        const config = await this.service.connect(input);
        this.personal=null;
        const same = this.current.config?.remote === config.remote && this.current.config?.branch === config.branch && this.current.config?.push === config.push;
        const state = same ? { lastBackupDay: this.current.lastBackupDay, lastSuccess: this.current.lastSuccess, pendingCommit: this.current.pendingCommit } : { lastBackupDay: null, lastSuccess: null, pendingCommit: null };
        this.records[id] = { ...config, ...state, enabled: true };
        await this.persist();
        this.publish({ config, enabled: true, ...state, phase: "ready", message: "Git 일일 백업 대기 중" });
        this.retryAfter = 0;
        this.schedule();
        return !same || this.due() ? this.perform() : this.publish({});
      } catch (error) {
        this.schedule(); throw error;
      }
    });
  }
  due() {
    if (this.current.config?.mode==="personal-sync") return true;
    const now = this.now(), today = dayKey(now);
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (now.getTime() < this.retryAfter) return false;
    if (this.current.pendingCommit) return true;
    const previous = this.current.lastBackupDay;
    return !previous || (previous < today && (now.getHours() >= 23 || previous < dayKey(yesterday)));
  }
  sync(id, { automatic = false } = {}) {
    if (this.pendingSync?.id === id && (automatic || !this.pendingSync.automatic)) return this.pendingSync.promise;
    const promise = this.enqueue(async () => {
      this.check(id);
      if (!this.current.enabled || (automatic && !this.due())) return this.status();
      return this.perform(automatic);
    });
    const pending = { id, promise, automatic }; this.pendingSync = pending;
    promise.finally(() => { if (this.pendingSync === pending) this.pendingSync = null; }).catch(() => {});
    return promise;
  }
  async perform(automatic=false) {
    const revision = this.revision;
    const day = dayKey(this.now());
    this.publish({ phase: "saving", message: "Git에 변경사항 저장 중…",changed:[] });
    try {
      if (await realpath(this.vault.root) !== this.canonicalRoot)
        throw new Error("보관함 위치가 변경되었습니다. Git 설정을 다시 확인해 주세요.");
      if (this.current.config?.mode==="personal-sync") {
        const service=await this.startPersonal();
        const record=this.records[this.vault.id],register=record.registerPending===true;
        const result=await service.sync(this.current.config,{force:!automatic,register});
        if(service.firstDirty===null){clearTimeout(this.batchTimer);this.batchTimer=null;} else this.scheduleBatch();
        record.lastSuccess=result.lastSuccess ?? this.current.lastSuccess;
        if(register && result.devices.some(d=>d.id===result.deviceId && d.name===this.current.config.deviceName))record.registerPending=false;
        if (register || result.changed.length || this.current.lastSuccess===undefined) await this.persist();
        return this.publish(result);
      }
      const pending = this.current.pendingCommit;
      const result = await this.service.sync(this.current.config, {
        commit: !pending, revision: pending || undefined,
        onCommit: async (head) => {
          const state = { lastBackupDay: day, pendingCommit: this.current.config.push ? head || null : null };
          Object.assign(this.current, state);
          Object.assign(this.records[this.vault.id], state);
          await this.persist();
        },
      });
      this.current.pendingCommit = null;
      this.records[this.vault.id].pendingCommit = null;
      if (result.lastSuccess) {
        this.records[this.vault.id].lastSuccess = result.lastSuccess;
      }
      await this.persist();
      this.retryAfter = 0;
      return this.publish({ ...result, ...(revision !== this.revision ? { phase: "pending", message: "새 변경사항 Git 저장 대기 중" } : {}) });
    } catch (error) {
      this.retryAfter = this.now().getTime() + 10 * 60 * 1000;
      const message=this.current.config?.mode==="personal-sync" ? "기기 간 동기화 중단 · "+error.message : error.message;
      return this.publish({ phase: "error", message });
    }
  }
  disconnect(id) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      if (this.records[id]) { this.records[id].enabled = false; await this.persist(); }
      this.personal=null;
      return this.publish({ enabled: false, phase: "off", message: "Git 자동 저장 꺼짐",changed:[],conflicts:[],devices:[] });
    });
  }
}
