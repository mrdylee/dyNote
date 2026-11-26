import { execFile } from "node:child_process";
import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { FILE_STORAGE_FOLDER, validFilePath } from "./vault.mjs";

export const gitFailureMessages = {
  "git-missing": "Git을 설치하고 Dynote를 다시 시작해 주세요.",
  ownership: "보관함에서 git status로 소유권을 확인하고 해당 폴더의 safe.directory 안내를 따라 주세요.",
  timeout: "Git 작업 시간이 초과되었습니다. 연결 상태를 확인해 주세요.",
  network: "원격 저장소와 연결이 끊겼습니다. 네트워크와 VPN 연결을 확인해 주세요.",
  "remote-unavailable": "원격 저장소에 접근할 수 없습니다. 연결 상태와 저장소 주소·읽기 권한을 확인해 주세요.",
  authentication: "Git 인증에 실패했습니다. SSH 키 또는 Git 자격 증명 로그인을 확인해 주세요.",
  identity: "커밋 작성자 이름과 이메일을 입력하거나 Git 사용자 설정을 완료해 주세요.",
  filesystem: "보관함과 .git 폴더의 쓰기 권한을 확인하고 파일을 사용 중인 프로그램을 닫아 주세요.",
  "push-denied": "이 계정의 업로드가 거절됐습니다. 저장소·브랜치의 쓰기 권한을 확인해 주세요.",
  "branch-policy": "서버가 브랜치 업데이트를 거절했습니다. 브랜치 보호 규칙과 서버 정책을 확인해 주세요.",
  "non-fast-forward": "원격 브랜치가 변경되었습니다. 원격 변경을 가져온 뒤 다시 시도해 주세요.",
  "storage-full": "로컬 디스크 또는 원격 저장소 공간이 부족합니다. 공간 확보 후 다시 동기화해 주세요.",
  history: "로컬 기록이 보존되어 있습니다. 저장소·브랜치를 확인하고 공통 이력이 없으면 별도의 빈 폴더로 가져와 주세요.",
  unknown: "Git 작업에 실패했습니다. 저장소 주소와 Git 상태를 확인해 주세요.",
};

function gitFailureReason(error, stage, stderr, stdout) {
  if (error?.code === "ENOENT") return "git-missing";
  if (error?.killed || error?.code === "ETIMEDOUT") return "timeout";
  if (/quota|no space left|disk full|storage limit/i.test(stderr)) return "storage-full";
  if (/identity unknown|unable to auto-detect email address|empty ident name/i.test(stderr)) return "identity";
  if ((!stage || /cannot open |cannot lock ref|unable to create |could not write /.test(stderr)) &&
      /permission denied|read-only file system|operation not permitted|access is denied/i.test(stderr)) return "filesystem";
  const httpStatus = /\b(?:returned error:|HTTP(?:\/[\d.]+)?(?: (?:code|status))?:?)\s+(401|403|502|503|504)\b/i.exec(stderr)?.[1];
  if (stage === "push") {
    // With --porcelain the per-ref status lives on stdout. Never return ref names or server output.
    const summary = String(stdout).split(/\r?\n/).filter(line => line.startsWith("!\t")).map(line => line.split("\t")[2]).join("\n");
    const report = summary + "\n" + stderr;
    if (/non-fast-forward|fetch first|stale info/i.test(report)) return "non-fast-forward";
    if (/protected branch|branch protection|repository rule|GH006|GH013/i.test(report)) return "branch-policy";
    if (httpStatus === "403" || /write access|write permission|(?:not allowed|not permitted|not authorized) to (?:push|upload)|permission to .+ denied|remote:\s*(?:access|permission) denied/i.test(report)) return "push-denied";
    if (/cannot lock ref 'refs\/heads\/[^']+': is at [0-9a-f]+ but expected [0-9a-f]+/i.test(stderr)) return "non-fast-forward";
    if (/hook declined|\[remote rejected\]/i.test(report)) return "branch-policy";
  }
  if (httpStatus === "401" || httpStatus === "403" || /authentication (?:failed|required)|permission denied|could not read (?:Username|Password)|invalid credentials/i.test(stderr)) return "authentication";
  if (stage && (["502", "503", "504"].includes(httpStatus) || /could not resolve (?:host|hostname|proxy)|connection (?:refused|reset|timed out|closed)|failed to connect|network is unreachable|no route to host|remote end hung up|unexpected disconnect/i.test(stderr))) return "network";
  if (stage && /does not appear to be a git repository|could not read from remote repository|repository .+ not found/i.test(stderr)) return "remote-unavailable";
  return "unknown";
}

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
  return { remote, branch, authorName, authorEmail, schedule: "daily", push: input.push !== false };
}

export function runGit(root, args, { input, env = process.env, allow = [0], encoding = "utf8", privateIndex, timeout = 60000, nativeCheckout = false, signal } = {}) {
  const gitEnv = { ...env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) delete gitEnv[key];
  if (privateIndex) gitEnv.GIT_INDEX_FILE = privateIndex;
  const checkingRoot = args[0] === "rev-parse" && args[1] === "--show-toplevel";
  const syncStage = { "ls-remote": "remote-query", fetch: "fetch", clone: "fetch", push: "push" }[args[0]];
  if (checkingRoot || syncStage) Object.assign(gitEnv, { LC_ALL: "C", LANGUAGE: "C" });
  return new Promise((resolve, reject) => {
    const child = execFile("git", ["-c", `core.hooksPath=${path.join(root, ".git", "dynote-disabled-hooks")}`, ...(nativeCheckout ? [] : ["-c", "core.autocrlf=false"]), "-c", "submodule.recurse=false", ...args], {
      cwd: root, windowsHide: true, timeout, signal, maxBuffer: 32 * 1024 * 1024, encoding,
      env: { ...gitEnv, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", GIT_LITERAL_PATHSPECS: "1" },
    }, (error, stdout, stderr) => {
      const code = error ? error.code ?? error.signal ?? "GIT_FAILED" : 0;
      if (checkingRoot && code === 128 && /^fatal: detected dubious ownership in repository at /m.test(stderr))
        return reject(Object.assign(new Error(`Git이 보관함의 소유권을 확인하지 못했습니다. 폴더: ${root}\n해당 폴더에서 Git Bash를 열고 git status를 실행하세요. Git이 표시한 경로가 본인의 보관함과 일치하면 안내된 safe.directory 명령을 실행한 뒤 다시 시도해 주세요.`), { code, syncReason: "ownership" }));
      if (allow.includes(code)) return resolve({ code, stdout });
      const syncReason = gitFailureReason(error, syncStage, String(stderr), stdout);
      reject(Object.assign(new Error(gitFailureMessages[syncReason]), { code, syncStage, syncReason }));
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

  async remoteHead(config, signal) {
    const result = await this.git(["ls-remote", "--heads", "--", config.remote, `refs/heads/${config.branch}`], {signal});
    return result.stdout.split(/\s/)[0];
  }

  async initialPersonalRemote(config) {
    const { stdout } = await this.git(["ls-remote", "--refs", "--", config.remote]);
    const refs = stdout.trim().split(/\r?\n/).filter(Boolean).map(line => line.split("\t"));
    const ref = refs.find(([, name]) => name === "refs/heads/" + config.branch);
    if (!ref && refs.length) throw Object.assign(new Error("원격 저장소에 지정한 브랜치가 없습니다. 브랜치 이름을 확인해 주세요."), { syncStage: "remote-query", syncReason: "history" });
    return ref?.[0];
  }

  async checkPersonalConnection(config, exists, onStage = () => {}) {
    onStage("remote-query");
    const remote = await this.initialPersonalRemote(config);
    onStage("remote-query", true);
    if (!remote) return;
    const head = exists && (await this.git(["rev-parse", "--verify", "-q", "HEAD"], { allow: [0, 1] })).stdout.trim();
    if (head) {
      onStage("fetch");
      await this.git(["fetch", "--no-write-fetch-head", "--no-tags", "--no-recurse-submodules", "--", config.remote, "refs/heads/" + config.branch]);
      onStage("fetch", true);
      if (!(await this.git(["merge-base", head, remote], { allow: [0, 1] })).code) return;
    } else {
      const entries = await readdir(this.root, { withFileTypes: true });
      const local = entries.filter(entry => entry.name !== ".git" && entry.name !== ".DS_Store" && entry.name !== "desktop.ini");
      if (!local.length || (local.length === 1 && local[0].name === FILE_STORAGE_FOLDER && local[0].isDirectory() &&
          !(await readdir(path.join(this.root, FILE_STORAGE_FOLDER))).length)) return;
    }
    throw Object.assign(new Error("로컬 노트와 원격 저장소에 공통 Git 이력이 없습니다. ‘기존 Git 저장소에서 가져오기’로 빈 폴더를 선택해 주세요."), { syncReason: "history" });
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
    const branch = (await this.git(["symbolic-ref", "--quiet", "HEAD"], { allow: [0, 1] })).stdout.trim();
    if (branch !== "refs/heads/" + config.branch) throw new Error(`현재 브랜치가 설정과 다릅니다. Git에서 ${config.branch} 브랜치로 전환해 주세요.`);
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

  async checkpoint({ authorName, authorEmail }, paths) {
    paths ??= await this.safePaths();
    if (!paths.length) return;
    const author = [];
    if (authorName) author.push("-c", `user.name=${authorName}`);
    if (authorEmail) author.push("-c", `user.email=${authorEmail}`);
    const identity = await this.git([...author, "var", "GIT_AUTHOR_IDENT"], { allow: [0, 128] });
    if (identity.code) throw new Error("커밋 작성자 이름과 이메일을 입력하거나 Git 사용자 설정을 완료해 주세요.");
    const input = paths.join("\0") + "\0";
    await this.git(["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], { input });
    if ((await this.git(["diff", "--cached", "--name-only", "-z"])).stdout)
      await this.git([...author, "commit", "--no-gpg-sign", "--only", "-m", `Dynote backup ${new Date().toISOString()}`, "--pathspec-from-file=-", "--pathspec-file-nul"], { input });
  }

  async sync(input, { commit = true, revision, onCommit = async () => {} } = {}) {
    const config = validateGitConfig(input);
    await this.assertReady(config);
    if (commit) await this.checkpoint(config);
    else await this.safePaths();
    const head = revision ?? (await this.git(["rev-parse", "--verify", "HEAD"], { allow: [0, 128] })).stdout.trim();
    if (revision) {
      if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error("잘못된 백업 기록입니다.");
      if ((await this.git(["merge-base", "--is-ancestor", revision, "HEAD"], { allow: [0, 1] })).code)
        throw new Error("전송 대기 백업의 Git 이력이 변경되었습니다. Git 상태를 확인해 주세요.");
    }
    if (commit) await onCommit(head);
    if (!head) return { phase: "ready", message: "Git에 저장할 문서가 없습니다." };
    if (!config.push) return { phase: "committed", message: "Git 로컬 커밋 완료 · 원격 업로드 꺼짐", commit: head };
    const remote = await this.remoteHead(config);
    if (remote && remote !== head) {
      await this.git(["fetch", "--no-tags", "--no-recurse-submodules", "--", config.remote, `refs/heads/${config.branch}`]);
      if (revision && !(await this.git(["merge-base", "--is-ancestor", head, remote], { allow: [0, 1] })).code)
        return { phase: "synced", message: "대기 백업의 원격 저장 확인 · 새 원격 변경은 Git에서 가져와 주세요.", commit: head, lastSuccess: new Date().toISOString() };
      const ancestor = await this.git(["merge-base", "--is-ancestor", remote, head], { allow: [0, 1] });
      if (ancestor.code) throw new Error("원격에 다른 기기의 변경사항이 있습니다. Git에서 통합한 뒤 다시 시도해 주세요. 로컬 문서와 커밋은 보존됩니다.");
    }
    await this.git(["push", "--porcelain", "--no-verify", "--recurse-submodules=no", "--", config.remote, `${head}:refs/heads/${config.branch}`]);
    return { phase: "synced", message: "Git 원격 저장 완료", commit: head, lastSuccess: new Date().toISOString() };
  }

  static async clone(destination, input, run = runGit) {
    const config = validateGitConfig(input);
    const entries = await readdir(destination, { withFileTypes: true });
    const storage = path.join(destination, FILE_STORAGE_FOLDER);
    if (entries.length) {
      if (entries.length !== 1 || entries[0].name !== FILE_STORAGE_FOLDER || !entries[0].isDirectory())
        throw new Error("기존 파일이 없는 빈 폴더를 선택해 주세요.");
      await rmdir(storage).catch(error => {
        if (["ENOTEMPTY", "EEXIST"].includes(error.code)) throw new Error("기존 파일이 없는 빈 폴더를 선택해 주세요.");
        throw error;
      });
    }
    try {
      await run(destination, ["clone", "--no-recurse-submodules", "--single-branch", "--branch", config.branch, "--", config.remote, "."]);
    } finally {
      if (entries.length) await mkdir(storage).catch(error => { if (error.code !== "EEXIST") throw error; });
    }
    return new GitBackup(destination, run);
  }
}
