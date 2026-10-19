import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GitBackup, validateGitConfig, runGit } from "../core/git-backup.mjs";

export class GitController {
  constructor({ settingsFile, run = runGit, onStatus = () => {}, setTimer = setInterval, clearTimer = clearInterval }) {
    Object.assign(this, { settingsFile, run, onStatus, setTimer, clearTimer });
    this.records = {}; this.tail = Promise.resolve(); this.timer = null; this.generation = 0;
    this.revision = 0; this.pendingSync = null;
    this.current = { enabled: false, phase: "off", message: "Git 연결 안 됨", config: null };
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
    if (this.current.enabled && !["saving", "error"].includes(this.current.phase)) this.publish({ phase: "pending", message: "Git 자동 저장 대기 중" });
  }
  close() { this.generation++; if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; }
  schedule() {
    this.close();
    if (!this.current.enabled) return;
    const generation = this.generation, id = this.vault.id;
    this.timer = this.setTimer(() => generation === this.generation ? this.sync(id).catch(() => {}) : undefined, this.current.config.interval * 1000);
    this.timer?.unref?.();
  }
  async persist() {
    const temporary = `${this.settingsFile}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(this.settingsFile), { recursive: true });
    await writeFile(temporary, JSON.stringify(this.records), { mode: 0o600 });
    await rename(temporary, this.settingsFile);
  }
  open(vault) {
    this.close();
    return this.enqueue(async () => {
      this.vault = vault;
      this.service = new GitBackup(vault.root, this.run);
      this.current = { enabled: false, phase: "off", message: "Git 연결 안 됨", config: null };
      try {
        this.records = JSON.parse(await readFile(this.settingsFile, "utf8"));
        const record = this.records[vault.id];
        if (record) this.current = { config: validateGitConfig(record), enabled: record.enabled === true, lastSuccess: record.lastSuccess, phase: record.enabled ? "ready" : "off", message: record.enabled ? "Git 자동 저장 대기 중" : "Git 자동 저장 꺼짐" };
      } catch (error) {
        if (error.code !== "ENOENT") this.current.message = "Git 설정을 읽지 못했습니다. 저장소를 다시 연결해 주세요.";
        this.records = {};
      }
      this.schedule(); return this.publish({});
    });
  }
  connect(id, input) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      try {
        const config = await this.service.connect(input);
        this.records[id] = { ...config, enabled: true };
        await this.persist();
        this.publish({ config, enabled: true, lastSuccess: null });
        this.schedule(); return this.perform();
      } catch (error) {
        this.schedule(); throw error;
      }
    });
  }
  sync(id) {
    if (this.pendingSync?.id === id) return this.pendingSync.promise;
    const promise = this.enqueue(async () => {
      this.check(id);
      if (!this.current.enabled) return this.status();
      return this.perform();
    });
    const pending = { id, promise }; this.pendingSync = pending;
    promise.finally(() => { if (this.pendingSync === pending) this.pendingSync = null; }).catch(() => {});
    return promise;
  }
  async perform() {
    const revision = this.revision;
    this.publish({ phase: "saving", message: "Git에 변경사항 저장 중…" });
    try {
      const result = await this.service.sync(this.current.config);
      if (result.lastSuccess) {
        this.records[this.vault.id].lastSuccess = result.lastSuccess;
        await this.persist();
      }
      return this.publish({ ...result, ...(revision !== this.revision ? { phase: "pending", message: "새 변경사항 Git 저장 대기 중" } : {}) });
    } catch (error) {
      return this.publish({ phase: "error", message: error.message });
    }
  }
  disconnect(id) {
    return this.enqueue(async () => {
      this.check(id); this.close();
      if (this.records[id]) { this.records[id].enabled = false; await this.persist(); }
      return this.publish({ enabled: false, phase: "off", message: "Git 자동 저장 꺼짐" });
    });
  }
}
