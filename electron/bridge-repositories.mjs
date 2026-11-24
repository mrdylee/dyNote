import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "../core/git-backup.mjs";

function repositoryId(remote) {
  if (typeof remote !== "string" || !remote.trim()) return "";
  try {
    const address = remote.trim().replace(/^([\w.-]+)@([\w.-]+):([^/].*)$/, "ssh://$1@$2/$3");
    const url = new URL(address);
    return (url.hostname + decodeURIComponent(url.pathname)).replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  } catch { return remote.trim(); }
}

export async function noteFolderRemotes(root) {
  try { await lstat(path.join(root, ".git")); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  const { stdout } = await runGit(root, ["remote"]);
  const names = stdout.trim().split(/\r?\n/).filter(Boolean);
  const urls = await Promise.all(names.flatMap(name => [[], ["--push"]].map(flags =>
    runGit(root, ["remote", "get-url", "--all", ...flags, "--", name]))));
  return urls.flatMap(result => result.stdout.trim().split(/\r?\n/).filter(Boolean));
}

export async function noteRemotes(dataRoot, roots) {
  let records = {};
  try { records = JSON.parse(await readFile(path.join(dataRoot, "git-backup.json"), "utf8")); }
  catch (err) { if (err.code !== "ENOENT") throw err; }
  const folders = await Promise.all(roots.map(noteFolderRemotes));
  return [...Object.values(records).filter(record => record?.enabled).map(record => record.remote), ...folders.flat()];
}

export class BridgeRepositories {
  constructor({ role, remotes, file, createService, getNoteRemotes }) {
    Object.assign(this, { role, remotes, file, createService, getNoteRemotes });
    this.operations = new Set();
    this.remote = "";
    this.error = "";
  }

  async open() {
    let remote = this.remotes[0];
    try { remote = JSON.parse(await readFile(this.file, "utf8")).remote; }
    catch (err) {
      if (err.code !== "ENOENT") { this.setupError = "저장한 중계 설정을 읽지 못했습니다. 승인된 저장소를 다시 선택해 주세요."; return this; }
    }
    try { await this.checkSelection(remote); this.activate(remote); }
    catch (err) { this.setupError = err.message; }
    return this;
  }

  checkNoteRemote(remote) {
    if (this.remotes.some(item => repositoryId(item) === repositoryId(remote)))
      throw new Error("Copilot 중계용으로 지정된 저장소입니다. 노트 전용 저장소를 선택해 주세요.");
  }

  async checkSelection(remote) {
    if (!this.remotes.includes(remote)) throw new Error("관리자가 승인한 중계 저장소를 선택해 주세요.");
    let notes;
    try { notes = await this.getNoteRemotes(); }
    catch { throw new Error("노트 Git 설정을 확인할 수 없습니다. 노트 저장소 연결 상태를 확인해 주세요."); }
    if (notes.some(note => repositoryId(note) === repositoryId(remote)))
      throw new Error("노트 Git으로 연결된 주소입니다. 다른 중계 저장소를 선택해 주세요.");
  }

  activate(remote) {
    this.service = this.createService(remote);
    this.remote = remote;
    this.setupError = this.error = "";
    this.lastChecked = null;
  }

  settings() {
    return { role: this.role, remotes: this.remotes, remote: this.remote, error: this.setupError || this.error };
  }

  async select(remote) {
    if (this.changing) throw new Error("중계 저장소를 변경 중입니다.");
    this.changing = true;
    try {
      await this.checkSelection(remote);
      if (this.remote === remote) return this.settings();
      if (await this.service?.hasPending()) throw new Error("이전 저장소의 작업을 마친 뒤 변경해 주세요.");
      // Drain an in-flight poll or submission before replacing its service.
      if (this.operations.size) {
        await Promise.allSettled([...this.operations]);
        if (await this.service?.hasPending()) throw new Error("이전 저장소의 작업을 마친 뒤 변경해 주세요.");
      }
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temp = this.file + "." + randomUUID();
      await writeFile(temp, JSON.stringify({ remote }), { mode: 0o600 });
      await rename(temp, this.file);
      this.activate(remote);
      return this.settings();
    } finally { this.changing = false; }
  }

  async use(method, ...args) {
    if (!this.service) throw new Error(this.setupError || "중계 저장소를 선택해 주세요.");
    if (this.changing) throw new Error("중계 저장소를 변경 중입니다.");
    const operation = this.service[method](...args);
    this.operations.add(operation);
    try { return await operation; }
    finally { this.operations.delete(operation); }
  }
}
