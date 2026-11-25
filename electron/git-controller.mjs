import { readFile, writeFile, rename, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { PersonalSync, copyStabilityMs, installDevice, personalConfig } from "../core/personal-sync.mjs";
import { validPersonalFilePath } from "../core/vault.mjs";
import { GitBackup, gitFailureMessages, validateGitConfig, runGit } from "../core/git-backup.mjs";
import { apiConfig, GitHubRemote } from "../core/github-remote.mjs";
import { preserveApiDraft, scanApiFiles, syncApiVault } from "../core/github-api-sync.mjs";
import appPackage from "../package.json" with { type: "json" };

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const settingsWrites = new Map();
const stages = { "local-save": "로컬 저장", "remote-query": "원격 조회", fetch: "원격 변경 가져오기", push: "업로드", apply: "내 PC 적용" };
const failureMessages = { ...gitFailureMessages,
  "managed-record": "동기화 관리 파일의 변경 내용을 확인해 주세요.",
  "ignored-collision": "Git 제외 규칙에 걸린 로컬 파일과 수신 경로가 겹칩니다. 로컬 파일을 다른 경로에 보관한 뒤 다시 시도해 주세요.",
  filesystem: "보관함을 사용하는 프로그램을 닫고 저장 위치의 쓰기 권한과 파일 교체 가능 여부를 확인해 주세요.",
  unknown: "오류 원인을 확인하려면 진단을 복사해 주세요.",
};
const transientReasons = new Set(["network", "timeout", "remote-unavailable", "non-fast-forward"]);
const transientFileCodes = new Set(["EAGAIN", "EBUSY", "ESTALE", "ETXTBSY", "EEXIST", "ETIMEDOUT", "ENETDOWN", "ENETUNREACH", "ENOTCONN", "ECONNRESET", "EHOSTUNREACH"]);
const fileCodes = new Set([...transientFileCodes, "EACCES", "EPERM", "EIO", "ENOSPC", "EDQUOT", "EROFS", "ENOENT", "ENOTDIR", "EISDIR", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMFILE", "ENFILE"]);
const safeCode = code => (Number.isInteger(code) && code >= 0 && code <= 255) || fileCodes.has(code) ? code : null;
const recoveryId = value => typeof value === "string" && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) ? value : null;
const clearPersonalDetails = () => ({ changed:[], conflicts:[], devices:[], deviceId:null, pendingFiles:[], localOnlyFiles:[], diagnostics:null, recoveryFile:null, recoveryBytes:0 });
const knownKey = (values, key) => typeof key === "string" && Object.hasOwn(values, key);

function personalProgress(now) {
  const progress = { stage: "local-save", lastStage: null, times: {} };
  progress.onStage = (stage, done, time) => {
    if (!knownKey(stages, stage)) return;
    progress.stage = stage;
    if (!done) return;
    progress.lastStage = stage;
    if (stage === "remote-query") progress.times.lastRemoteCheck = time ?? now().toISOString();
    if (stage === "push") progress.times.lastSuccess = time ?? now().toISOString();
  };
  return progress;
}

function personalFailure(error, progress, previous, now) {
  const code = safeCode(error.code);
  const stage = knownKey(stages, error.syncStage) ? error.syncStage : progress.stage;
  let reason = knownKey(failureMessages, error.syncReason) ? error.syncReason : "unknown";
  if (reason === "unknown" && fileCodes.has(code)) reason = ["ENOSPC", "EDQUOT"].includes(code) ? "storage-full" : "filesystem";
  const transient = transientReasons.has(reason) || reason === "filesystem" && transientFileCodes.has(code);
  const delay = transient ? Math.min(30 * 60000, Math.max(60000, (previous?.delay || 0) * 2)) : 0;
  return { stage, lastStage: progress.lastStage, reason, code, delay, retryAt: delay ? now + delay : null, recoveryFile: recoveryId(error.recoveryFile) };
}

function personalErrorStatus(failure, detail, setup = false) {
  // A saved settings file can predate this format. Copy only known values, never paths, output, or error.message.
  const stage = knownKey(stages, failure.stage) ? failure.stage : "local-save";
  const lastStage = knownKey(stages, failure.lastStage) ? failure.lastStage : "none";
  const reason = knownKey(failureMessages, failure.reason) ? failure.reason : "unknown", code = safeCode(failure.code);
  const diagnostics = `Dynote ${appPackage.version}\nstage=${stage}\ncode=${reason}${code === null ? "" : "/" + code}\nlastSuccessfulStage=${lastStage}`;
  const action = setup ? "설정을 확인한 뒤 다시 연결해 주세요." : Number.isFinite(failure.retryAt)
    ? `${new Date(failure.retryAt).toLocaleTimeString()} 이후 자동으로 다시 시도합니다.` : "확인 후 ‘지금 동기화’를 눌러 주세요.";
  return { phase: "error", message: `${stages[stage]} 중단 · ${detail || failureMessages[reason]} ${action}`, diagnostics, recoveryFile: recoveryId(failure.recoveryFile) };
}

export class GitController {
  constructor({ settingsFile, secretStorage, fetcher = fetch, run = runGit, onStatus = () => {}, isPersonal = () => false, setTimer = setInterval, clearTimer = clearInterval, now = () => new Date() }) {
    Object.assign(this, { settingsFile, secretStorage, fetcher, run, onStatus, isPersonal, setTimer, clearTimer, now });
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
  scheduleBatch(since = this.personal?.firstDirty ?? this.now().getTime()) {
    if(!this.personal || this.batchTimer || !this.due())return;
    const id=this.vault.id, generation=this.generation;
    const delay=since+300000-this.now().getTime();
    if(delay<=0)return;
    this.batchTimer=setTimeout(()=>{
      this.batchTimer=null;
      if (generation===this.generation) this.sync(id,{automatic:true,force:true,personalOnly:true}).catch(()=>{});
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
    if (this.current.enabled && this.current.config?.mode==="github-api") {
      try { return await save(); } catch (error) {
        if (error.code!=="ENOENT" && !/외부.*변경/.test(error.message)) throw error;
        const draft = await preserveApiDraft(this.vault,name,content);
        this.publish({phase:"pending",message:"편집 중인 초안을 보존했습니다 · "+draft.conflictPath,changed:[draft.conflictPath]});
        return draft;
      }
    }
    if(!this.current.enabled || this.current.config?.mode!=="personal-sync")return save();
    try { return await save(); } catch(error) {
      if (!this.isPersonal(this.vault) || (error.code!=="ENOENT" && !/외부.*변경/.test(error.message))) throw error;
      return this.enqueue(async()=>{
        const service=await this.startPersonal();
        const draft=await service.saveDraft(name,content,revision,this.current.config);
        if(!draft)throw error;
        this.sync(this.vault.id,{automatic:true,force:true,personalOnly:true}).catch(()=>{});
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
      if (args.action==="confirm") { await service.confirm(args.path,args.oid); return this.perform(); }
      const progress = personalProgress(this.now);
      const revision = this.revision;
      try {
        let result;
        if(args.action==="device") result=await service.removeDevice(this.current.config,args.deviceId,progress.onStage);
        else if(args.action==="resolve") result=await service.resolve(this.current.config,args.path,args.basis,args.commit,args.options,progress.onStage);
        else throw new Error("알 수 없는 동기화 작업입니다.");
        return await this.personalResult(result,progress,revision);
      } catch (error) {
        if (error.syncReason || error.syncStage) await this.personalError(error,progress);
        else if (Object.keys(progress.times).length) {
          await this.updatePersonalRecord(progress.times);
          this.publish(progress.times);
        }
        throw error;
      }
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
          if (validPersonalFilePath(relative) && generation===this.generation) {
            this.revision++;
            this.scheduleBatch();
          }
        });
        this.watcher.on("error",()=>this.watcher?.close());
      } catch { /* Periodic discovery also covers hosts without recursive watch. */ }
    }
    const twoWay = personal || this.current.config?.mode === "github-api";
    this.timer = this.setTimer(() => generation === this.generation ? this.sync(id, { automatic: true, personalOnly:twoWay }).catch(() => {}) : undefined, twoWay ? 55000+Math.floor(Math.random()*5000) : 60000);
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
      this.vault = vault; this.personal=null; this.apiCache=new Map();
      this.canonicalRoot = await realpath(vault.root);
      this.service = new GitBackup(vault.root, this.run);
      this.retryAfter = 0;
      this.current = { enabled: false, phase: "off", message: "Git 백업 미설정", config: null };
      try {
        this.records = JSON.parse(await readFile(this.settingsFile, "utf8"));
        const record = this.records[vault.id];
        if (record) {
          const personal = record.mode === "personal-sync";
          if (personal && !Object.hasOwn(record, "lastRemoteCheck")) {
            // Older personal records advanced lastSuccess on a poll. They cannot verify an upload.
            Object.assign(record, { lastSuccess:null, lastRemoteCheck:null });
            // Keep the connection usable if settings are temporarily read-only. The next result also persists these fields.
            await this.persist().catch(() => {});
          }
          const api = record.mode === "github-api";
          const enabled = record.enabled === true && (!(personal || api) || this.isPersonal(vault));
          this.current = {
            config: api ? apiConfig(record) : personal ? personalConfig(record) : validateGitConfig(record), enabled, lastSuccess: record.lastSuccess,
            lastRemoteCheck: personal || api ? record.lastRemoteCheck : null,
            lastBackupDay: personal || api ? null : record.lastBackupDay ?? (record.lastSuccess && Number.isFinite(Date.parse(record.lastSuccess)) ? dayKey(new Date(record.lastSuccess)) : null),
            pendingCommit: record.pendingCommit ?? null,
            phase: enabled ? "ready" : "off", message: enabled ? personal || api ? "개인 노트 동기화 대기 중" : "Git 일일 백업 대기 중" : "Git 자동 저장 꺼짐",
            ...(personal && enabled && record.personalFailure ? personalErrorStatus(record.personalFailure) : {}),
          };
        }
      } catch (error) {
        if (error.code !== "ENOENT") this.current.message = "Git 설정을 읽지 못했습니다. 저장소를 다시 연결해 주세요.";
        this.records = {};
      }
      if (this.current.enabled && this.current.config?.mode==="personal-sync") await this.startPersonal();
      this.schedule();
      // Enqueue after local startup; the window must not wait for network I/O.
      if (this.current.enabled) this.sync(vault.id, { automatic: true, personalOnly:["personal-sync","github-api"].includes(this.current.config?.mode) }).catch(() => {});
      return this.publish({});
    });
  }
  connect(id, input) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      const progress = input.mode === "personal-sync" ? personalProgress(this.now) : null;
      try {
        if (input.mode === "github-api") {
          if (!this.isPersonal(this.vault)) throw new Error("개인 노트 공간을 선택해 주세요.");
          const config = apiConfig(input);
          if (!this.secretStorage?.isEncryptionAvailable() || (process.platform === "linux" && this.secretStorage.getSelectedStorageBackend?.() === "basic_text"))
            throw new Error("이 PC의 보안 자격 증명 저장소를 먼저 설정해 주세요.");
          if (!input.token?.trim()) throw new Error("저장소에 접근할 GitHub 토큰을 입력해 주세요.");
          await scanApiFiles(this.vault,this.apiCache);
          const old = this.records[id];
          const same = old?.mode === config.mode && old.remote === config.remote && old.branch === config.branch;
          const encryptedToken = this.secretStorage.encryptString(input.token.trim()).toString("base64");
          const remote = new GitHubRemote(config,input.token.trim(),this.fetcher);
          await remote.head(); // Verify the new connection before replacing the saved one.
          const lastSuccess = same ? old.lastSuccess ?? null : null;
          const apiConflicts = same ? old.apiConflicts ?? [] : [];
          this.records[id] = {...config,enabled:true,encryptedToken,apiBase:same ? old.apiBase : null,lastSuccess,apiConflicts};
          try { await this.persist(); } catch (error) { this.records[id]=old; throw error; }
          this.personal=null;
          this.publish({config,enabled:true,lastSuccess,apiConflicts,lastRemoteCheck:null,lastBackupDay:null,pendingCommit:null,...clearPersonalDetails()});
          this.retryAfter=0;
          this.schedule(); return this.perform();
        }
        if(progress) {
          const config=personalConfig(input), service=await this.startPersonal();
          const zips=await this.zipList();
          if(!Array.isArray(input.zipPaths) || zips.some(name=>!input.zipPaths.includes(name))) throw new Error("전송할 ZIP 목록을 다시 확인해 주세요.");
          const exists=await this.service.repository();
          const prior=this.current.config;
          if (!exists || !this.current.enabled || prior?.mode !== "personal-sync" || prior.remote !== config.remote || prior.branch !== config.branch)
            await this.service.checkPersonalConnection(config, exists, progress.onStage);
          progress.onStage("local-save");
          if (!exists) {
            await this.service.git(["init","--initial-branch="+config.branch]);
            await this.service.git(["remote","add","origin",config.remote]);
          }
          await service.init();
          if (!await service.disk.job()) await this.service.assertReady(config);
          // Persist the selected destination before a local checkpoint can enter its history.
          const same = prior?.mode === "personal-sync" && prior.remote === config.remote && prior.branch === config.branch;
          const times = { lastSuccess: same ? this.current.lastSuccess ?? null : null,
            lastRemoteCheck: progress.times.lastRemoteCheck ?? (same ? this.current.lastRemoteCheck ?? null : null) };
          this.records[id]={...config,...times,enabled:true,registerPending:true};
          await this.persist();
          this.publish({config,enabled:true,...times,lastBackupDay:null,pendingCommit:null,...clearPersonalDetails()});
          this.schedule();return this.perform({ progress });
        }
        const config = await this.service.connect(input);
        this.personal=null;
        const same = this.current.config?.mode !== "personal-sync" && this.current.config?.remote === config.remote && this.current.config?.branch === config.branch && this.current.config?.push === config.push;
        const state = same ? { lastBackupDay: this.current.lastBackupDay, lastSuccess: this.current.lastSuccess, pendingCommit: this.current.pendingCommit } : { lastBackupDay: null, lastSuccess: null, pendingCommit: null };
        this.records[id] = { ...config, ...state, enabled: true };
        await this.persist();
        this.publish({ config, enabled: true, ...state, phase: "ready", message: "Git 일일 백업 대기 중",
          lastRemoteCheck:null,...clearPersonalDetails() });
        this.retryAfter = 0;
        this.schedule();
        return !same || this.due() ? this.perform() : this.publish({});
      } catch (error) {
        this.schedule();
        if (progress) {
          const failure = personalFailure(error,progress,null,this.now().getTime());
          this.publish(personalErrorStatus(failure, error.message, true));
        }
        throw error;
      }
    });
  }
  due() {
    if (this.current.config?.mode === "github-api") return this.now().getTime() >= this.retryAfter;
    if (this.current.config?.mode==="personal-sync") {
      const failure = this.records[this.vault.id]?.personalFailure;
      return !failure || Number.isFinite(failure.retryAt) && this.now().getTime() >= failure.retryAt;
    }
    const now = this.now(), today = dayKey(now);
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (now.getTime() < this.retryAfter) return false;
    if (this.current.pendingCommit) return true;
    const previous = this.current.lastBackupDay;
    return !previous || (previous < today && (now.getHours() >= 23 || previous < dayKey(yesterday)));
  }
  sync(id, { automatic = false, force = !automatic, personalOnly = false } = {}) {
    if (this.pendingSync?.id === id && this.pendingSync.personalOnly === personalOnly &&
        (automatic || !this.pendingSync.automatic) && (!force || this.pendingSync.force)) return this.pendingSync.promise;
    const promise = this.enqueue(async () => {
      this.check(id);
      if (!this.current.enabled || (personalOnly && !["personal-sync","github-api"].includes(this.current.config?.mode)) || (automatic && !this.due())) return this.status();
      return this.perform({ force, manual:!automatic });
    });
    const pending = { id, promise, automatic, force, personalOnly }; this.pendingSync = pending;
    promise.finally(() => { if (this.pendingSync === pending) this.pendingSync = null; }).catch(() => {});
    return promise;
  }
  async updatePersonalRecord(update) {
    const record = this.records[this.vault.id];
    if (!Object.keys(update).some(key => record[key] !== update[key])) return;
    Object.assign(record, update);
    await this.persist();
  }
  async personalResult(result, progress, revision) {
    const record = this.records[this.vault.id];
    progress.completed = result;
    // A watcher reports our own incoming writes too. Confirm a late change against the new HEAD.
    if (this.revision !== revision && this.personal.firstDirty === null && result.phase !== "pending") {
      revision = this.revision;
      progress.onStage("local-save");
      const dirty = await this.personal.dirty(await this.personal.disk.head(), []);
      if (dirty.some(validPersonalFilePath)) {
        this.personal.firstDirty = this.now().getTime();
        result = { ...result, phase:"pending", message: "새 변경사항 전송 대기" + (result.phase === "local-only" ? " · " + result.message : "") };
      }
    }
    const times = { lastSuccess: result.lastSuccess ?? progress.times.lastSuccess ?? record.lastSuccess ?? null,
      lastRemoteCheck: result.lastRemoteCheck ?? progress.times.lastRemoteCheck ?? record.lastRemoteCheck ?? null };
    const registered = record.registerPending && result.devices.some(d=>d.id===result.deviceId && d.name===this.current.config.deviceName);
    await this.updatePersonalRecord({ ...times, personalFailure:null, ...(registered ? {registerPending:false} : {}) });
    if (this.personal.firstDirty !== null) this.scheduleBatch();
    else if (revision === this.revision) { clearTimeout(this.batchTimer); this.batchTimer=null; }
    return this.publish({ ...result, ...times, diagnostics:null, recoveryFile:null });
  }
  async personalError(error, progress) {
    const record = this.records[this.vault.id];
    const failure = personalFailure(error, progress, record.personalFailure, this.now().getTime());
    clearTimeout(this.batchTimer); this.batchTimer=null;
    const detail = error.syncReason !== "unknown" && typeof error.message === "string" && /[가-힣]/.test(error.message) ? error.message : null;
    const status = personalErrorStatus(failure, detail);
    try { await this.updatePersonalRecord({ ...progress.times, personalFailure:failure }); }
    catch { status.message += " 이 기기에 동기화 상태를 저장하지 못했습니다."; }
    return this.publish({ ...progress.completed, ...progress.times, ...status });
  }
  async perform({ force=true, manual=false, progress=this.current.config?.mode === "personal-sync" ? personalProgress(this.now) : null } = {}) {
    const revision = this.revision;
    const generation = this.generation;
    const day = dayKey(this.now());
    const announce = () => this.publish({ phase: "saving", message: "동기화 중…",changed:[],diagnostics:null,recoveryFile:null });
    if (this.current.config?.mode !== "github-api")
      this.publish({ phase: "saving", message: "변경사항 저장 중…",changed:[],diagnostics:null,recoveryFile:null });
    else if (manual) announce();
    try {
      if (await realpath(this.vault.root) !== this.canonicalRoot)
        throw new Error("보관함 위치가 변경되었습니다. Git 설정을 다시 확인해 주세요.");
      if (this.current.config?.mode === "github-api") {
        if (!this.isPersonal(this.vault)) throw new Error("개인 노트 공간을 선택해 주세요.");
        const record = this.records[this.vault.id];
        const token = this.secretStorage.decryptString(Buffer.from(record.encryptedToken,"base64"));
        const remote = new GitHubRemote(this.current.config,token,this.fetcher);
        const result = await syncApiVault(this.vault,remote,record.apiBase,this.apiCache,announce);
        const time = this.now().toISOString();
        const lastSuccess = result.uploaded ? time : record.lastSuccess ?? null;
        this.retryAfter=0;
        const apiConflicts = result.conflicts.length ? result.conflicts : record.apiConflicts ?? [];
        if (record.apiBase !== result.state)
          await this.updatePersonalRecord({apiBase:result.state,lastSuccess,lastRemoteCheck:time,apiConflicts});
        const message = result.conflicts.length ? "충돌 처리 · "+result.conflicts.join(", ") : "동기화됨";
        return this.publish({phase:"synced",message,changed:result.changed,apiConflicts,lastSuccess,lastRemoteCheck:time});
      }
      if (progress) {
        const service=await this.startPersonal();
        const record=this.records[this.vault.id],register=record.registerPending===true;
        let result=await service.sync(this.current.config,{force,register,onStage:progress.onStage});
        if (manual && result.pendingFiles.some(file => file.oid && file.message === "복사 완료 대기")) {
          progress.completed = result;
          await new Promise(resolve => setTimeout(resolve, copyStabilityMs));
          if (generation === this.generation) {
            const stillRegistering = register && !result.devices.some(d=>d.id===result.deviceId && d.name===this.current.config.deviceName);
            const next = await service.sync(this.current.config,{force,register:stillRegistering,onStage:progress.onStage});
            result = { ...result, ...next, changed: [...new Set([...result.changed, ...next.changed])] };
          }
        }
        return await this.personalResult(result,progress,revision);
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
      if (progress) return this.personalError(error,progress);
      this.retryAfter = this.now().getTime() + 10 * 60 * 1000;
      return this.publish({ phase: "error", message: error.message });
    }
  }
  disconnect(id) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      if (this.records[id]) { this.records[id].enabled = false; delete this.records[id].encryptedToken; delete this.records[id].personalFailure; await this.persist(); }
      this.personal=null;
      return this.publish({ enabled: false, phase: "off", message: "Git 자동 저장 꺼짐",...clearPersonalDetails() });
    });
  }
}
