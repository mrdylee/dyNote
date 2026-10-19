import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { validFilePath } from "./vault.mjs";

export function validateGitConfig(input) {
  const remote = typeof input?.remote === "string" ? input.remote.trim() : "";
  let valid = false;
  if (remote.length < 2048 && !/[\s\x00-\x1f\x7f]/.test(remote)) {
    if (/^[\w.-]+@[\w.-]+:[\w./~%+-]+$/.test(remote)) valid = true;
    else try {
      const url = new URL(remote);
      valid = ["https:", "ssh:"].includes(url.protocol) && !!url.hostname && url.pathname.length > 1 && !url.password && !url.search && !url.hash && (url.protocol === "ssh:" || !url.username);
    } catch { /* Not a supported Git URL. */ }
  }
  if (!valid) throw new Error("인증 정보가 없는 HTTPS 또는 SSH 저장소 주소를 입력해 주세요.");
  const branch = typeof input?.branch === "string" ? input.branch.trim() : "";
  if (typeof branch !== "string" || !branch || branch.length > 200 || branch === "HEAD" || branch.startsWith("-") || /[\s~^:?*\[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|\.$/.test(branch) || branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock")))
    throw new Error("올바른 Git 브랜치 이름을 입력해 주세요.");
  const authorName = input?.authorName ?? "", authorEmail = input?.authorEmail ?? "";
  if (![authorName, authorEmail].every((v) => typeof v === "string" && v.length < 250 && !/[\x00-\x1f\x7f<>]/.test(v)) || (authorEmail && !/^[^\s@]+@[^\s@]+$/.test(authorEmail)))
    throw new Error("커밋 작성자 이름과 이메일을 확인해 주세요.");
  return { remote, branch, authorName, authorEmail, interval: [30, 300, 900].includes(input.interval) ? input.interval : 300, push: input.push !== false };
}

export function runGit(root, args, { input, env = process.env, allow = [0] } = {}) {
  const gitEnv = { ...env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) delete gitEnv[key];
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["-c", `core.hooksPath=${path.join(root, ".git", "dynote-disabled-hooks")}`, "-c", "core.autocrlf=false", "-c", "submodule.recurse=false", ...args], {
      cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024,
      env: { ...gitEnv, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", GIT_LITERAL_PATHSPECS: "1" },
    }, (error, stdout, stderr) => {
      const code = error?.code ?? 0;
      if (allow.includes(code)) return resolve({ code, stdout });
      const message = code === "ENOENT" ? "Git을 설치하고 Dynote를 다시 시작해 주세요."
        : error?.killed ? "Git 연결 시간이 초과되었습니다. 로컬 문서는 저장되어 있습니다."
        : /authentication|permission denied|could not read Username|credential/i.test(stderr) ? "Git 인증에 실패했습니다. SSH 키 또는 Git 자격 증명 로그인을 확인해 주세요."
        : /non-fast-forward|fetch first|rejected/i.test(stderr) ? "원격에 다른 변경사항이 있습니다. Git에서 변경사항을 통합한 뒤 다시 시도해 주세요."
        : "Git 작업에 실패했습니다. 저장소 주소·접근 권한·네트워크와 Git 상태를 확인해 주세요.";
      reject(Object.assign(new Error(message), { code }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export class GitBackup {
  constructor(root, run = runGit) { this.root = root; this.run = run; }
  git(args, options) { return this.run(this.root, args, options); }

  async repository() {
    const top = await this.git(["rev-parse", "--show-toplevel"], { allow: [0, 128] });
    if (top.code === 0 && await realpath(top.stdout.trim()) !== await realpath(this.root))
      throw new Error("보관함은 Git 저장소 루트 폴더여야 합니다. 상위 저장소에는 자동 저장하지 않습니다.");
    const meta = await lstat(path.join(this.root, ".git")).catch((e) => { if (e.code !== "ENOENT") throw e; });
    if (meta && (!meta.isDirectory() || meta.isSymbolicLink())) throw new Error("독립적인 Git 저장소 폴더만 연결할 수 있습니다. 연결된 worktree는 지원하지 않습니다.");
    if (!meta && (await this.git(["rev-parse", "--is-bare-repository"], { allow: [0, 128] })).stdout.trim() === "true") throw new Error("일반 작업 폴더를 선택해 주세요.");
    return !!meta;
  }

  async remoteHead(config) {
    const result = await this.git(["ls-remote", "--heads", "--", config.remote, `refs/heads/${config.branch}`]);
    return result.stdout.split(/\s/)[0];
  }

  async connect(input) {
    const config = validateGitConfig(input), exists = await this.repository();
    await this.git(["check-ref-format", "--branch", config.branch]);
    const head = await this.remoteHead(config);
    if (!exists) {
      if (head) throw new Error("원격에 문서가 있습니다. '기존 저장소 가져오기'로 빈 폴더에 가져온 뒤 사용해 주세요.");
      await this.git(["init", `--initial-branch=${config.branch}`]);
    }
    await this.assertReady(config);
    return config;
  }

  async assertReady(config) {
    if (!await this.repository()) throw new Error("Git 저장소를 먼저 연결해 주세요.");
    const branch = (await this.git(["symbolic-ref", "--quiet", "--short", "HEAD"], { allow: [0, 1] })).stdout.trim();
    if (branch !== config.branch) throw new Error(`현재 브랜치가 설정과 다릅니다. Git에서 ${config.branch} 브랜치로 전환해 주세요.`);
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "BISECT_LOG"]) {
      const exists = await lstat(path.join(this.root, ".git", marker)).catch((e) => { if (e.code !== "ENOENT") throw e; });
      if (exists) throw new Error("진행 중인 Git 작업을 먼저 완료해 주세요. 로컬 문서는 계속 저장됩니다.");
    }
    if ((await this.git(["diff", "--cached", "--name-only", "-z"])).stdout) throw new Error("직접 스테이징한 변경사항이 있습니다. Git에서 커밋하거나 스테이징을 해제한 뒤 다시 시도해 주세요.");
  }

  async safePaths() {
    const names = new Set((await this.git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(validFilePath));
    const paths = [];
    for (const name of names) {
      let target = this.root, safe = true;
      for (const part of name.split("/")) {
        target = path.join(target, part);
        const stat = await lstat(target).catch((e) => { if (e.code !== "ENOENT") throw e; });
        if (stat?.isSymbolicLink()) { safe = false; break; }
        if (target === path.join(this.root, name) && stat?.isDirectory()) throw new Error("문서 경로가 폴더로 변경되었습니다. Git에서 변경사항을 확인해 주세요.");
      }
      if (safe) paths.push(name);
    }
    return paths;
  }

  async sync(input) {
    const config = validateGitConfig(input);
    await this.assertReady(config);
    const paths = await this.safePaths(), author = [];
    if (config.authorName) author.push("-c", `user.name=${config.authorName}`);
    if (config.authorEmail) author.push("-c", `user.email=${config.authorEmail}`);
    if (paths.length) {
      const identity = await this.git([...author, "var", "GIT_AUTHOR_IDENT"], { allow: [0, 128] });
      if (identity.code) throw new Error("커밋 작성자 이름과 이메일을 입력하거나 Git 사용자 설정을 완료해 주세요.");
      const input = paths.join("\0") + "\0";
      await this.git(["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], { input });
      if ((await this.git(["diff", "--cached", "--name-only", "-z"])).stdout)
        await this.git([...author, "commit", "--no-gpg-sign", "--only", "-m", `Dynote backup ${new Date().toISOString()}`, "--pathspec-from-file=-", "--pathspec-file-nul"], { input });
    }
    const head = (await this.git(["rev-parse", "--verify", "HEAD"], { allow: [0, 128] })).stdout.trim();
    if (!head) return { phase: "ready", message: "Git에 저장할 문서가 없습니다." };
    if (!config.push) return { phase: "committed", message: "Git 로컬 커밋 완료 · 원격 업로드 꺼짐", commit: head };
    const remote = await this.remoteHead(config);
    if (remote && remote !== head) {
      await this.git(["fetch", "--no-tags", "--no-recurse-submodules", "--", config.remote, `refs/heads/${config.branch}`]);
      const ancestor = await this.git(["merge-base", "--is-ancestor", remote, "HEAD"], { allow: [0, 1] });
      if (ancestor.code) throw new Error("원격에 다른 기기의 변경사항이 있습니다. Git에서 통합한 뒤 다시 시도해 주세요. 로컬 문서와 커밋은 보존됩니다.");
    }
    await this.git(["push", "--porcelain", "--no-verify", "--recurse-submodules=no", "--", config.remote, `HEAD:refs/heads/${config.branch}`]);
    return { phase: "synced", message: "Git 원격 저장 완료", commit: head, lastSuccess: new Date().toISOString() };
  }

  static async clone(destination, input, run = runGit) {
    const config = validateGitConfig(input);
    if ((await readdir(destination)).length) throw new Error("기존 파일이 없는 빈 폴더를 선택해 주세요.");
    await run(destination, ["clone", "--no-recurse-submodules", "--single-branch", "--branch", config.branch, "--", config.remote, "."]);
    return new GitBackup(destination, run);
  }
}
