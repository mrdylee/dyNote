import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rename, symlink, unlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitBackup, runGit, validateGitConfig } from "../core/git-backup.mjs";

const remote = "https://backup.test/notes.git";
const config = { remote, branch: "main", interval: 300, authorName: "Dynote Test", authorEmail: "test@example.invalid" };
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-git-test-"));
  const root = path.join(dir, "vault"), bare = path.join(dir, "remote.git"), cfg = path.join(dir, "gitconfig");
  await mkdir(root); await writeFile(cfg, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  git(dir, "init", "--bare", "--initial-branch=main", bare);
  git(dir, "config", "--file", cfg, `url.file://${bare}.insteadOf`, remote);
  const run = (cwd, args, options) => runGit(cwd, args, { ...options, env });
  const service = new GitBackup(root, run);
  await writeFile(path.join(root, "Home.md"), "# 한글\r\n");
  return { dir, root, bare, cfg, git, run, service };
}

test("Git inputs accept HTTPS/SSH and reject credentials, commands and invalid branches", () => {
  assert.equal(validateGitConfig(config).interval, 300);
  for (const url of ["git@github.com:owner/notes.git", "ssh://git@example.com:2222/owner/notes.git"])
    assert.equal(validateGitConfig({ ...config, remote: url }).remote, url);
  for (const url of ["--upload-pack=bad", "ext::sh bad", "file:///tmp/repo", "https://user:secret@example.com/repo", "https://example.com/repo?token=secret", "git@host:path\n--bad"])
    assert.throws(() => validateGitConfig({ ...config, remote: url }));
  for (const branch of ["-main", "a..b", "HEAD", "a b", "a.lock", "x@{y}", 123])
    assert.throws(() => validateGitConfig({ ...config, branch }), /브랜치/);
});

test("Git processes ignore inherited repository redirects and leave the other repository untouched", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  const other = path.join(f.dir, "other"); await mkdir(other);
  f.git(other, "init", "--initial-branch=main");
  const result = await runGit(f.root, ["rev-parse", "--show-toplevel"], { env: { ...process.env, GIT_DIR: path.join(other, ".git"), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, ".git", "index") } });
  assert.equal(result.stdout.trim(), f.git(f.root, "rev-parse", "--show-toplevel"));
  assert.equal(f.git(other, "status", "--porcelain"), "");
});

test("real Git backup commits only supported files, pushes bytes and skips empty commits", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, ".env"), "SECRET=never-upload");
  await writeFile(path.join(f.root, "private.txt"), "not a note");
  await writeFile(path.join(f.root, "image.png"), Buffer.from([0, 255, 1, 80]));
  await f.service.connect(config);
  const first = await f.service.sync(config);
  assert.equal(first.phase, "synced");
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "# 한글");
  assert.deepEqual(f.git(f.bare, "ls-tree", "--name-only", "main").split("\n").sort(), ["Home.md", "image.png"]);
  const head = f.git(f.bare, "rev-parse", "main");
  await f.service.sync(config);
  assert.equal(f.git(f.bare, "rev-parse", "main"), head);
  await rename(path.join(f.root, "Home.md"), path.join(f.root, "Moved.md"));
  await f.service.sync(config);
  assert.deepEqual(f.git(f.bare, "ls-tree", "--name-only", "main").split("\n").sort(), ["Moved.md", "image.png"]);
});

test("existing staged work and symlinks are not incorporated in automatic commits", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  await writeFile(path.join(f.dir, "outside.md"), "outside");
  await symlink(path.join(f.dir, "outside.md"), path.join(f.root, "link.md"));
  await f.service.sync(config);
  assert.equal(f.git(f.bare, "ls-tree", "--name-only", "main"), "Home.md");
  await writeFile(path.join(f.root, "private.txt"), "staged work");
  f.git(f.root, "add", "private.txt");
  await assert.rejects(f.service.sync(config), /스테이징/);
  assert.equal(f.git(f.root, "diff", "--cached", "--name-only"), "private.txt");
});

test("automatic commits do not execute hooks or invoke interactive commit signing", async () => {
  const f = await fixture(); await f.service.connect(config);
  f.git(f.root, "config", "commit.gpgSign", "true");
  f.git(f.root, "config", "gpg.program", path.join(f.dir, "missing-signing-program"));
  const hook = path.join(f.root, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n"); await chmod(hook, 0o755);
  assert.equal((await f.service.sync(config)).phase, "synced");
  assert.equal(f.git(f.root, "config", "commit.gpgSign"), "true");
});

test("failed pushes keep local commits and retry without duplicating commits", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  await writeFile(path.join(f.root, "Home.md"), "offline edit");
  await rename(f.bare, f.bare + ".offline");
  await assert.rejects(f.service.sync(config));
  const local = f.git(f.root, "rev-parse", "HEAD");
  assert.equal(await readFile(path.join(f.root, "Home.md"), "utf8"), "offline edit");
  await rename(f.bare + ".offline", f.bare);
  await f.service.sync(config);
  assert.equal(f.git(f.bare, "rev-parse", "main"), local);
});

test("remote-ahead history is preserved without pull, force push or local-file replacement", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  const other = path.join(f.dir, "other");
  f.git(f.dir, "clone", f.bare, other);
  await writeFile(path.join(other, "Home.md"), "other machine");
  f.git(other, "add", "Home.md");
  f.git(other, "-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-m", "other");
  f.git(other, "push", "origin", "main");
  const remoteHead = f.git(f.bare, "rev-parse", "main");
  await writeFile(path.join(f.root, "Home.md"), "local draft");
  await assert.rejects(f.service.sync(config), /다른 기기|원격/);
  assert.equal(f.git(f.bare, "rev-parse", "main"), remoteHead);
  assert.equal(await readFile(path.join(f.root, "Home.md"), "utf8"), "local draft");
});

test("connecting refuses ancestor repositories and nonempty remote histories; clone uses an empty destination", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  const child = path.join(f.root, "child"), blank = path.join(f.dir, "blank");
  await mkdir(child); await mkdir(blank);
  await assert.rejects(new GitBackup(child, f.run).connect(config), /보관함.*루트|상위/);
  await assert.rejects(new GitBackup(blank, f.run).connect(config), /가져오기/);
  await GitBackup.clone(blank, config, f.run);
  assert.equal(await readFile(path.join(blank, "Home.md"), "utf8"), "# 한글\r\n");
  await assert.rejects(GitBackup.clone(blank, config, f.run), /빈 폴더/);
});

test("a tracked note replaced by a directory cannot stage unrelated files recursively", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  await unlink(path.join(f.root, "Home.md"));
  await mkdir(path.join(f.root, "Home.md"));
  await writeFile(path.join(f.root, "Home.md", ".env"), "secret");
  await assert.rejects(f.service.sync(config), /폴더/);
  assert.equal(f.git(f.root, "diff", "--cached", "--name-only"), "");
  assert.equal(f.git(f.bare, "ls-tree", "--name-only", "main"), "Home.md");
});

test("controller persists per-vault settings and timers commit changes only while enabled", async () => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture(), scheduled = [], cleared = [], events = [];
  const settingsFile = path.join(f.dir, "backup.json");
  const options = { settingsFile, run: f.run, onStatus: (value) => events.push(value), setTimer: (callback, ms) => { const timer = { callback, ms }; scheduled.push(timer); return timer; }, clearTimer: (timer) => cleared.push(timer) };
  const controller = new GitController(options);
  await controller.open({ id: "one", root: f.root });
  await controller.connect("one", config);
  assert.equal(controller.status().phase, "synced");
  assert.equal(scheduled.at(-1).ms, 300000);
  await writeFile(path.join(f.root, "Home.md"), "automatic tick");
  await scheduled.at(-1).callback();
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "automatic tick");
  const restarted = new GitController(options);
  await restarted.open({ id: "one", root: f.root });
  assert.equal(restarted.status().config.remote, remote);
  assert.equal(restarted.status().enabled, true);
  await restarted.disconnect("one");
  assert.equal(restarted.status().enabled, false);
  const oldTimer = scheduled[0];
  await controller.open({ id: "two", root: f.dir });
  await oldTimer.callback();
  assert.equal(controller.status().vaultId, "two");
  assert.equal(controller.status().enabled, false);
  assert.ok(cleared.length >= 2);
  assert.ok(events.some((e) => e.phase === "saving"));
  controller.close(); restarted.close();
});

test("controller coalesces overlapping ticks and reports edits made during an upload as pending", async () => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture();
  const controller = new GitController({ settingsFile: path.join(f.dir, "backup.json"), run: f.run, setTimer: () => null });
  await controller.open({ id: "one", root: f.root }); await controller.connect("one", config);
  let unblock, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const release = new Promise((resolve) => { unblock = resolve; });
  let pushes = 0;
  controller.service.run = async (root, args, options) => {
    if (args[0] === "push") { pushes++; started(); await release; }
    return f.run(root, args, options);
  };
  await writeFile(path.join(f.root, "Home.md"), "before upload");
  const first = controller.sync("one"); await waiting;
  assert.equal(controller.sync("one"), first);
  await writeFile(path.join(f.root, "Home.md"), "edit during upload"); controller.markDirty("one");
  unblock(); await first;
  assert.equal(pushes, 1); assert.equal(controller.status().phase, "pending");
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "before upload");
  await controller.sync("one");
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "edit during upload");
  assert.equal(controller.status().phase, "synced"); controller.close();
});
