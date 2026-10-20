import { createHash } from "node:crypto";
import { GitBackup, runGit } from "./git-backup.mjs";
import { validFilePath } from "./vault.mjs";

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class GitHistory {
  constructor(vault, run = runGit) { this.vault = vault; this.backup = new GitBackup(vault.root, run); }
  git(args, options) { return this.backup.git(args, options); }
  async repository() {
    if (!await this.backup.repository()) throw new Error("이 보관함에는 Git 기록이 없습니다. Git 백업을 연결하거나 저장소를 먼저 가져와 주세요.");
  }
  async list(month) {
    if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("올바른 월을 선택해 주세요.");
    await this.repository();
    if ((await this.git(["rev-parse", "--verify", "HEAD"], { allow: [0, 128] })).code) return { entries: [], truncated: false };
    const [year, number] = month.split("-").map(Number);
    const from = new Date(year, number - 1, 1), until = new Date(year, number, 1);
    const result = await this.git(["log", "HEAD", "--no-show-signature", "--max-count=1001",
      `--since-as-filter=${from.toISOString()}`, `--before=${until.toISOString()}`, "--format=%H%x00%cI%x00%s"]);
    const entries = result.stdout.trim().split("\n").filter(Boolean).map((line) => {
      const [hash, time, subject] = line.split("\0");
      return { hash, time, subject, date: localDay(new Date(time)) };
    }).filter((entry) => entry.date.startsWith(month));
    return { entries: entries.slice(0, 1000), truncated: entries.length > 1000 };
  }
  async files(commit) {
    await this.repository();
    if (typeof commit !== "string" || !/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("잘못된 백업 기록입니다.");
    if ((await this.git(["merge-base", "--is-ancestor", commit, "HEAD"], { allow: [0, 1] })).code)
      throw new Error("현재 보관함 이력에 포함된 백업만 복원할 수 있습니다.");
    const tree = (await this.git(["ls-tree", "-r", "-l", "-z", commit])).stdout;
    const files = [], names = new Set();
    let total = 0;
    for (const row of tree.split("\0").filter(Boolean)) {
      const tab = row.indexOf("\t"), name = row.slice(tab + 1);
      if (!validFilePath(name)) continue;
      const [mode, type, oid, size] = row.slice(0, tab).trim().split(/\s+/);
      const key = name.normalize("NFC").toLowerCase();
      if (type !== "blob" || !["100644", "100755"].includes(mode) || names.has(key))
        throw new Error("백업에 링크 또는 중복 파일 경로가 있습니다.");
      names.add(key); total += Number(size);
      if (Number(size) > 25 * 1024 * 1024 || total > 512 * 1024 * 1024) throw new Error("복원 파일 크기 제한(파일 25MB, 전체 512MB)을 넘었습니다.");
      const bytes = (await this.git(["cat-file", "blob", oid], { encoding: null })).stdout;
      files.push({ path: name, bytes, revision: digest(bytes) });
    }
    return files;
  }
  async preview(commit) {
    const files = await this.files(commit), current = await this.vault.captureFiles();
    const before = new Map(current.files.map((f) => [f.path, f.revision])), after = new Map(files.map((f) => [f.path, f.revision]));
    const changes = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((name) =>
      before.get(name) === after.get(name) ? [] : [{ path: name, kind: !before.has(name) ? "add" : !after.has(name) ? "delete" : "modify" }]);
    return { commit, revision: current.revision, changes };
  }
  async restore(commit, revision) {
    await this.repository();
    const branch = (await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"])).stdout.trim();
    await this.backup.assertReady({ branch });
    const files = await this.files(commit);
    return this.vault.applySnapshot(files, revision);
  }
}
