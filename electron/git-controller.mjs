import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GitBackup, validateGitConfig, runGit } from "../core/git-backup.mjs";

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export class GitController {
  constructor({ settingsFile, run = runGit, onStatus = () => {}, setTimer = setInterval, clearTimer = clearInterval, now = () => new Date() }) {
    Object.assign(this, { settingsFile, run, onStatus, setTimer, clearTimer, now });
    this.records = {}; this.tail = Promise.resolve(); this.timer = null; this.generation = 0;
    this.revision = 0; this.pendingSync = null; this.retryAfter = 0;
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
    this.timer = this.setTimer(() => generation === this.generation ? this.sync(id, { automatic: true }).catch(() => {}) : undefined, 60000);
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
      this.retryAfter = 0;
      this.current = { enabled: false, phase: "off", message: "Git 연결 안 됨", config: null };
      try {
        this.records = JSON.parse(await readFile(this.settingsFile, "utf8"));
        const record = this.records[vault.id];
        if (record) this.current = {
          config: validateGitConfig(record), enabled: record.enabled === true, lastSuccess: record.lastSuccess,
          lastBackupDay: record.lastBackupDay ?? (record.lastSuccess && Number.isFinite(Date.parse(record.lastSuccess)) ? dayKey(new Date(record.lastSuccess)) : null),
          pendingCommit: record.pendingCommit ?? null,
          phase: record.enabled ? "ready" : "off", message: record.enabled ? "Git 일일 백업 대기 중" : "Git 자동 저장 꺼짐",
        };
      } catch (error) {
        if (error.code !== "ENOENT") this.current.message = "Git 설정을 읽지 못했습니다. 저장소를 다시 연결해 주세요.";
        this.records = {};
      }
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
        const config = await this.service.connect(input);
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
    const now = this.now(), today = dayKey(now);
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (now.getTime() < this.retryAfter) return false;
    if (this.current.pendingCommit) return true;
    const previous = this.current.lastBackupDay;
    return !previous || (previous < today && (now.getHours() >= 23 || previous < dayKey(yesterday)));
  }
  sync(id, { automatic = false } = {}) {
    if (this.pendingSync?.id === id) return this.pendingSync.promise;
    const promise = this.enqueue(async () => {
      this.check(id);
      if (!this.current.enabled || (automatic && !this.due())) return this.status();
      return this.perform();
    });
    const pending = { id, promise }; this.pendingSync = pending;
    promise.finally(() => { if (this.pendingSync === pending) this.pendingSync = null; }).catch(() => {});
    return promise;
  }
  async perform() {
    const revision = this.revision;
    const day = dayKey(this.now());
    this.publish({ phase: "saving", message: "Git에 변경사항 저장 중…" });
    try {
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
