import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rename, symlink, unlink, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { GitBackup, runGit, validateGitConfig } from "../core/git-backup.mjs";

const remote = "https://backup.test/notes.git";
const config = { remote, branch: "main", interval: 420, authorName: "Dynote Test", authorEmail: "test@example.invalid" };
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
  assert.equal(validateGitConfig(config).schedule, "daily");
  for (const url of ["git@github.com:owner/notes.git", "ssh://git@example.com:2222/owner/notes.git"])
    assert.equal(validateGitConfig({ ...config, remote: url }).remote, url);
  for (const url of ["--upload-pack=bad", "ext::sh bad", "file:///tmp/repo", "https://user:secret@example.com/repo", "https://example.com/repo?token=secret", "git@host:path\n--bad"])
    assert.throws(() => validateGitConfig({ ...config, remote: url }));
  for (const branch of ["-main", "a..b", "HEAD", "a b", "a.lock", "x@{y}", 123])
    assert.throws(() => validateGitConfig({ ...config, branch }), /브랜치/);
});

test("personal setup verifies the remote branch and shared history without replacing local notes", async t => {
  const { dir, root, service, git } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await service.checkPersonalConnection(config, false);
  await service.connect(config);
  await service.sync(config);
  await service.checkPersonalConnection(config, true);
  await assert.rejects(service.checkPersonalConnection({ ...config, branch: "missing" }, true), /브랜치/);
  const other = path.join(dir, "other");
  await mkdir(other);
  git(other, "init", "--initial-branch=main");
  await writeFile(path.join(other, "draft.md"), "my draft");
  git(other, "add", "draft.md");
  git(other, "-c", "user.name=Local", "-c", "user.email=test@example.invalid", "commit", "-m", "local");
  const original = git(other, "rev-parse", "HEAD");
  await assert.rejects(new GitBackup(other, service.run).checkPersonalConnection(config, true), /공통 Git 이력/);
  assert.equal(git(other, "rev-parse", "HEAD"), original);
  assert.equal(await readFile(path.join(other, "draft.md"), "utf8"), "my draft");
});

test("the first repository probe identifies ownership rejection and leaves trust settings intact", async t => {
  const { dir, root, cfg, git } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(root, "init", "--initial-branch=main");
  const before = await readFile(cfg);
  const run = (cwd, args, options) => runGit(cwd, args, { ...options, env: {
    ...process.env, LC_ALL: "C", GIT_TEST_ASSUME_DIFFERENT_OWNER: "1", GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: "1"
  } });
  await assert.rejects(new GitBackup(root, run).repository(), error =>
    error.syncReason === "ownership" && error.message.includes("소유권") && error.message.includes(root) && error.message.includes("safe.directory"));
  assert.deepEqual(await readFile(cfg), before);
});

test("Git failures distinguish a missing remote, fetch, porcelain policy rejection and non-fast-forward", async t => {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.connect(config);
  await f.service.sync(config);
  await assert.rejects(f.run(f.root, ["-c", "alias.denied-write=!echo 'fatal: cannot open .git/index.lock: Permission denied' >&2 && exit 1", "denied-write"]),
    error => error.syncReason === "filesystem" && !error.message.includes("인증"));
  await rename(f.bare, f.bare + ".offline");
  for (const [command, stage] of [["ls-remote", "remote-query"], ["fetch", "fetch"]]) {
    await assert.rejects(f.run(f.root, [command, "--", remote]), error =>
      error.syncStage === stage && error.syncReason === "remote-unavailable" && !error.message.includes(f.dir));
  }
  await rename(f.bare + ".offline", f.bare);
  await writeFile(path.join(f.root, "Home.md"), "second local revision");
  await f.service.sync({ ...config, push: false });
  const push = rev => f.run(f.root, ["push", "--porcelain", "--", remote, rev + ":refs/heads/main"]);
  f.git(f.bare, "config", "receive.hideRefs", "refs/heads/main");
  await assert.rejects(push("HEAD"), error => error.syncStage === "push" && error.syncReason === "branch-policy");
  f.git(f.bare, "config", "--unset", "receive.hideRefs");
  const hook = path.join(f.bare, "hooks", "pre-receive");
  await writeFile(hook, "#!/bin/sh\necho 'Write access denied for company.example' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  await assert.rejects(push("HEAD"), error => error.syncStage === "push" && error.syncReason === "push-denied" && !error.message.includes("company.example"));
  await unlink(hook);
  await push("HEAD");
  await assert.rejects(push("HEAD~1"), error => error.syncStage === "push" && error.syncReason === "non-fast-forward");
});

async function personalController(t, realClock = false) {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture(), clock = { time: Date.UTC(2026, 10, 24, 9) };
  const id = "personal", vault = { id, root: await realpath(f.root) }, settingsFile = path.join(f.dir, "backup.json");
  const counters = { queries: 0, pushes: 0 };
  const options = { settingsFile, isPersonal: () => true, now: () => realClock ? new Date() : new Date(clock.time), setTimer: () => null,
    run: (root, args, opts) => {
      if (args[0] === "ls-remote") counters.queries++;
      if (args[0] === "push") counters.pushes++;
      return f.run(root, args, opts);
    } };
  const controllers = [];
  async function open() {
    const controller = new GitController(options); controllers.push(controller);
    await controller.open(vault);
    await controller.tail;
    return controller;
  }
  t.after(async () => {
    for (const controller of controllers) controller.close();
    await rm(f.dir, { recursive: true, force: true });
  });
  const cfg = { ...config, mode: "personal-sync", deviceName: "My PC", zipPaths: [] };
  const controller = await open();
  return { ...f, id, cfg, clock, counters, controller, open, settingsFile,
    record: async () => JSON.parse(await readFile(settingsFile, "utf8"))[id] };
}

test("personal sync persists actual uploads and checks, stops policy retries and resumes on a manual fix", async t => {
  const f = await personalController(t);
  const first = await f.controller.connect(f.id, f.cfg);
  assert.equal(first.phase, "synced", first.message);
  const uploaded = new Date(f.clock.time).toISOString();
  assert.equal(first.lastSuccess, uploaded);
  f.clock.time += 60000;
  const poll = await f.controller.sync(f.id, { automatic: true });
  assert.equal(poll.lastSuccess, uploaded);
  assert.equal(poll.lastRemoteCheck, new Date(f.clock.time).toISOString());
  await writeFile(path.join(f.root, "Home.md"), "new protected work");
  const hook = path.join(f.bare, "hooks", "pre-receive");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  f.clock.time += 60000;
  const rejected = await f.controller.sync(f.id);
  assert.equal(rejected.phase, "error");
  assert.match(rejected.message, /업로드/);
  assert.match(rejected.diagnostics, /stage=push/);
  assert.match(rejected.diagnostics, /branch-policy/);
  assert.equal(rejected.lastRemoteCheck, new Date(f.clock.time).toISOString());
  assert.equal(rejected.lastSuccess, uploaded);
  const savedHead = f.git(f.root, "rev-parse", "HEAD"), before = { ...f.counters };
  f.clock.time += 3600000;
  f.controller.markDirty(f.id);
  await f.controller.sync(f.id, { automatic: true, force: true });
  f.controller.close();
  const reopened = await f.open();
  assert.deepEqual(f.counters, before, "background events and restart must respect a blocked upload");
  assert.match(reopened.status().diagnostics, /stage=push/);
  await unlink(hook);
  const retried = reopened.sync(f.id);
  assert.equal(retried, reopened.sync(f.id));
  const recovered = await retried;
  assert.equal(recovered.phase, "synced");
  assert.equal(recovered.diagnostics, null);
  assert.deepEqual(recovered.changed, [], "uploading the existing local commit applies no incoming files");
  assert.equal(f.git(f.bare, "rev-parse", "main"), savedHead);
  assert.equal((await f.record()).lastSuccess, new Date(f.clock.time).toISOString());
  f.clock.time += 1000;
  await reopened.sync(f.id, { automatic: true });
  assert.ok(f.counters.queries > before.queries);
  assert.equal((await f.record()).lastRemoteCheck, new Date(f.clock.time).toISOString());
});

test("personal automatic attempts use capped backoff and manual sync bypasses the wait", async t => {
  const f = await personalController(t);
  await f.controller.connect(f.id, f.cfg);
  let attempts = 0;
  const actualSync = f.controller.personal.sync.bind(f.controller.personal);
  f.controller.personal.sync = async (_config, { onStage }) => {
    attempts++;
    onStage?.("local-save", true);
    throw Object.assign(new Error("network unavailable"), { syncStage: "fetch", syncReason: "network", code: 128 });
  };
  const first = await f.controller.sync(f.id);
  assert.match(first.message, /가져오기/);
  assert.match(first.diagnostics, /lastSuccessfulStage=local-save/);
  assert.equal(attempts, 1);
  for (const minutes of [1, 2, 4, 8, 16, 30, 30]) {
    const before = attempts;
    f.clock.time += minutes * 60000 - 1;
    f.controller.markDirty(f.id);
    await f.controller.sync(f.id, { automatic: true, force: true });
    assert.equal(attempts, before);
    f.clock.time++;
    await f.controller.sync(f.id, { automatic: true });
    assert.equal(attempts, before + 1);
  }
  f.controller.personal.sync = actualSync;
  const recovered = await f.controller.sync(f.id);
  assert.equal(recovered.phase, "synced");
  assert.equal(recovered.diagnostics, null);
  const count = f.counters.queries;
  await f.controller.sync(f.id, { automatic: true, force: true });
  assert.ok(f.counters.queries > count);
});

test("personal sync saves an offline edit and automatically uploads the same commit after the remote recovers", async t => {
  const f = await personalController(t);
  const initial = await f.controller.connect(f.id, f.cfg);
  await writeFile(path.join(f.root, "Home.md"), "offline edit");
  await rename(f.bare, f.bare + ".offline");
  f.clock.time += 1000;
  const offline = await f.controller.sync(f.id), localHead = f.git(f.root, "rev-parse", "HEAD");
  assert.match(offline.diagnostics, /stage=remote-query\ncode=remote-unavailable\/128\nlastSuccessfulStage=local-save/);
  assert.equal(offline.lastSuccess, initial.lastSuccess);
  assert.equal(offline.lastRemoteCheck, initial.lastRemoteCheck);
  const attempts = f.counters.queries;
  await rename(f.bare + ".offline", f.bare);
  await f.controller.sync(f.id, { automatic:true });
  assert.equal(f.counters.queries, attempts);
  f.clock.time += 60000;
  const uploaded = await f.controller.sync(f.id, { automatic:true });
  assert.equal(uploaded.phase, "synced");
  assert.equal(uploaded.diagnostics, null);
  assert.equal(uploaded.lastSuccess, new Date(f.clock.time).toISOString());
  assert.equal(f.git(f.bare, "rev-parse", "main"), localHead);
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "offline edit");
});

test("unknown personal errors expose a copyable version, stages and allowlisted code without private input", async t => {
  const f = await personalController(t);
  await f.controller.connect(f.id, f.cfg);
  const secret = "https://user:secret@company.example/Patient.md";
  f.controller.personal.sync = async (_config, { onStage }) => {
    onStage?.("remote-query", true, new Date(f.clock.time).toISOString());
    onStage?.("apply");
    throw Object.assign(new Error(secret), { code: secret, syncStage: secret, syncReason: secret, recoveryFile:secret });
  };
  const result = await f.controller.sync(f.id);
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(result.diagnostics.includes(version));
  assert.match(result.diagnostics, /stage=apply/);
  assert.match(result.diagnostics, /code=unknown/);
  assert.match(result.diagnostics, /lastSuccessfulStage=remote-query/);
  assert.doesNotMatch(result.diagnostics, /user|secret|company|Patient|My PC|https:|\.git/);
  assert.equal(result.recoveryFile, null);
  assert.match(result.message, /적용/);
});

test("legacy personal poll times do not appear as verified uploads after opening or reconfiguring", async t => {
  const f = await personalController(t);
  await f.controller.connect(f.id, f.cfg);
  f.controller.close();
  const record = await f.record(), legacy = "2026-11-01T00:00:00.000Z";
  delete record.lastRemoteCheck;
  record.lastSuccess = legacy;
  await writeFile(f.settingsFile, JSON.stringify({ [f.id]: record }));
  const reopened = await f.open();
  assert.equal(reopened.status().lastSuccess, null);
  assert.equal(reopened.status().lastBackupDay, null);
  assert.equal((await f.record()).lastSuccess, null);
  await writeFile(path.join(f.root, "Home.md"), "confirmed upload for this connection");
  const uploaded = (await reopened.sync(f.id)).lastSuccess;
  assert.ok(uploaded);
  f.clock.time += 1000;
  assert.equal((await reopened.connect(f.id, f.cfg)).lastSuccess, uploaded);
  const daily = await reopened.connect(f.id, { ...config, push: false });
  assert.equal(daily.lastRemoteCheck, null);
  assert.equal(daily.lastSuccess, null);
  assert.equal(daily.diagnostics, null);
  assert.deepEqual(daily.localOnlyFiles, []);
});

test("one manual check preserves incoming changes and uploads a completed copy while leaving an incomplete PDF pending", async t => {
  const f = await personalController(t, true);
  await f.controller.connect(f.id, f.cfg);
  const other = path.join(f.dir, "other");
  f.git(f.dir, "clone", f.bare, other);
  await writeFile(path.join(other, "Incoming.md"), "remote change");
  f.git(other, "add", "Incoming.md");
  f.git(other, "-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-m", "incoming");
  f.git(other, "push", "origin", "main");
  const storage = path.join(f.root, "File Storage");
  await mkdir(storage, { recursive: true });
  await writeFile(path.join(storage, "complete.pdf"), "%PDF-1.4\n%%EOF\n");
  await writeFile(path.join(storage, "partial.pdf"), "%PDF-1.4\ncopy in progress");
  await writeFile(path.join(storage, "changing.pdf"), "%PDF-1.4\nfirst\n%%EOF\n");
  const personal = f.controller.personal, sync = personal.sync.bind(personal);
  let passes = 0;
  personal.sync = async (...args) => {
    const result = await sync(...args);
    if (++passes === 1) await writeFile(path.join(storage, "changing.pdf"), "%PDF-1.4\nsecond version\n%%EOF\n");
    return result;
  };
  const before = f.counters.queries;
  const result = await f.controller.sync(f.id, { personalOnly: true });
  assert.deepEqual(result.pendingFiles.map(file => file.name).sort(), ["File Storage/changing.pdf", "File Storage/partial.pdf"]);
  assert.ok(result.changed.includes("Incoming.md"));
  assert.equal(f.counters.queries, before + 2, "the follow-up checks once even when a file is still incomplete");
  assert.equal(f.git(f.bare, "show", "main:File Storage/complete.pdf"), "%PDF-1.4\n%%EOF");
  assert.doesNotMatch(f.git(f.bare, "ls-tree", "-r", "--name-only", "main"), /(?:partial|changing)\.pdf/);
});

test("watch events from applying incoming notes do not leave a clean sync pending, while an actual late edit stays pending", async t => {
  const f = await personalController(t);
  await f.controller.connect(f.id, f.cfg);
  const other = path.join(f.dir, "other");
  f.git(f.dir, "clone", f.bare, other);
  await writeFile(path.join(other, "Incoming.md"), "received note");
  f.git(other, "add", "Incoming.md");
  f.git(other, "-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-m", "incoming");
  f.git(other, "push", "origin", "main");
  await writeFile(path.join(f.root, "Outgoing.md"), "local note");
  const store = f.controller.personal.store, git = store.git.bind(store);
  let lateEdit = false;
  store.git = async (args, options) => {
    if (args.includes("status") && args.includes("--ignored=matching")) {
      if (lateEdit) await writeFile(path.join(f.root, "Late.md"), "edited during sync");
      // Deliver events during the status scan, when the OS can also report our own checkout.
      f.controller.markDirty(f.id);
    }
    return git(args, options);
  };
  const complete = await f.controller.sync(f.id);
  assert.equal(complete.phase, "synced", complete.message);
  assert.deepEqual(complete.changed, ["Incoming.md"]);
  assert.equal(f.git(f.bare, "show", "main:Outgoing.md"), "local note");
  lateEdit = true;
  const pending = await f.controller.sync(f.id);
  assert.equal(pending.phase, "pending");
  assert.doesNotMatch(f.git(f.bare, "ls-tree", "-r", "--name-only", "main"), /Late\.md/);
  store.git = git;
  f.clock.time += 299999;
  await f.controller.sync(f.id, { automatic:true });
  assert.doesNotMatch(f.git(f.bare, "ls-tree", "-r", "--name-only", "main"), /Late\.md/);
  f.clock.time++;
  assert.equal((await f.controller.sync(f.id, { automatic:true })).phase, "synced");
  assert.equal(f.git(f.bare, "show", "main:Late.md"), "edited during sync");
});

test("legacy minute settings migrate to a daily schedule", () => {
  const normalized = validateGitConfig(config);
  assert.equal(normalized.schedule, "daily");
  assert.equal(normalized.interval, undefined);
});

test("simultaneously open vaults preserve each other's Git settings and history", async t => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const personal = await fixture();
  const team = await fixture();
  const settingsFile = path.join(personal.dir, "shared-backup.json");
  const controllers = [personal, team].map(f => new GitController({ settingsFile, run: f.run, setTimer: () => null }));
  t.after(async () => {
    for (const controller of controllers) controller.close();
    await Promise.all([personal.dir, team.dir].map(dir => rm(dir, { recursive: true, force: true })));
  });
  await Promise.all(controllers.map((controller, i) => controller.open({ id: `space-${i}`, root: [personal, team][i].root })));
  await writeFile(path.join(personal.root, "Home.md"), "personal bytes");
  await writeFile(path.join(team.root, "Home.md"), "team bytes");
  await Promise.all(controllers.map((controller, i) => controller.connect(`space-${i}`, config)));
  await controllers[0].disconnect("space-0");
  const records = JSON.parse(await readFile(settingsFile, "utf8"));
  assert.equal(records["space-0"].enabled, false);
  assert.equal(records["space-1"].enabled, true);
  assert.equal(personal.git(personal.bare, "show", "main:Home.md"), "personal bytes");
  assert.equal(team.git(team.bare, "show", "main:Home.md"), "team bytes");
});

test("missing app backup configuration does not claim an existing Git remote is disconnected", async (t) => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.git(f.root, "init", "--initial-branch=main"); f.git(f.root, "remote", "add", "origin", "https://existing.example.invalid/team.git");
  const before = await readFile(path.join(f.root, ".git/config"));
  const { GitController } = await import("../electron/git-controller.mjs");
  const controller = new GitController({ settingsFile: path.join(f.dir, "unset-backup.json"), run: f.run, setTimer: () => null });
  t.after(() => controller.close());
  assert.equal(controller.status().message, "Git 백업 미설정");
  await controller.open({ id: "existing-origin", root: f.root });
  assert.equal(controller.status().message, "Git 백업 미설정");
  assert.equal(f.git(f.root, "remote", "get-url", "origin"), "https://existing.example.invalid/team.git");
  assert.deepEqual(await readFile(path.join(f.root, ".git/config")), before);
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
  const storage = path.join(blank, "File Storage"), archive = path.join(storage, "keep.zip");
  await mkdir(storage); await writeFile(archive, "keep");
  await assert.rejects(GitBackup.clone(blank, config, f.run), /빈 폴더/);
  assert.equal(await readFile(archive, "utf8"), "keep");
  await unlink(archive);
  await assert.rejects(GitBackup.clone(blank, config, async () => { throw new Error("offline"); }), /offline/);
  assert.deepEqual(await readdir(storage), []);
  await GitBackup.clone(blank, config, f.run);
  assert.deepEqual(await readdir(storage), []);
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
  let clock = new Date(2026, 9, 20, 12);
  const settingsFile = path.join(f.dir, "backup.json");
  const options = { settingsFile, now: () => clock, run: f.run, onStatus: (value) => events.push(value), setTimer: (callback, ms) => { const timer = { callback, ms }; scheduled.push(timer); return timer; }, clearTimer: (timer) => cleared.push(timer) };
  const controller = new GitController(options);
  await controller.open({ id: "one", root: f.root });
  await controller.connect("one", config);
  assert.equal(controller.status().phase, "synced");
  assert.equal(scheduled.at(-1).ms, 60000);
  await writeFile(path.join(f.root, "Home.md"), "automatic tick");
  await scheduled.at(-1).callback();
  assert.notEqual(f.git(f.bare, "show", "main:Home.md"), "automatic tick");
  clock = new Date(2026, 9, 21, 23);
  await scheduled.at(-1).callback();
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "automatic tick");
  const restarted = new GitController(options);
  await restarted.open({ id: "one", root: f.root });
  assert.equal(restarted.status().config.remote, remote);
  assert.equal(restarted.status().config.schedule, "daily");
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

test("daily backup survives restart, catches missed days in background, and skips a second run", async () => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture(), ticks = [];
  let clock = new Date(2026, 9, 20, 12);
  const options = { settingsFile: path.join(f.dir, "daily.json"), run: f.run, now: () => clock,
    setTimer: (callback) => { ticks.push(callback); return callback; }, clearTimer: () => {} };
  const first = new GitController(options);
  await first.open({ id: "one", root: f.root }); await first.connect("one", config);
  assert.equal(first.status().lastBackupDay, "2026-10-20");
  await writeFile(path.join(f.root, "Home.md"), "next work");
  first.close();
  const second = new GitController(options);
  await second.open({ id: "one", root: f.root }); await second.tail;
  assert.equal(f.git(f.bare, "rev-list", "--count", "main"), "1");
  clock = new Date(2026, 9, 21, 9); await ticks.at(-1)();
  assert.equal(f.git(f.bare, "rev-list", "--count", "main"), "1", "yesterday was backed up; wait for tonight");
  second.close(); clock = new Date(2026, 9, 22, 9);
  let started, release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const resumed = new GitController({ ...options, run: async (root, args, opts) => {
    if (args[0] === "push") { started(); await blocked; }
    return f.run(root, args, opts);
  } });
  await resumed.open({ id: "one", root: f.root });
  await entered; // open() returned before a blocked network request completed.
  release(); await resumed.tail;
  assert.equal(resumed.status().lastBackupDay, "2026-10-22");
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "next work");
  await writeFile(path.join(f.root, "Home.md"), "late work");
  clock = new Date(2026, 9, 22, 23); await ticks.at(-1)();
  assert.equal(f.git(f.bare, "rev-list", "--count", "main"), "2");
  resumed.close();
});

test("daily offline retries upload the recorded commit without committing later edits", async () => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture(); let tick, clock = new Date(2026, 9, 20, 12);
  const options = { settingsFile: path.join(f.dir, "daily.json"), run: f.run, now: () => clock,
    setTimer: (callback) => { tick = callback; return callback; }, clearTimer: () => {} };
  const controller = new GitController(options);
  await controller.open({ id: "one", root: f.root }); await controller.connect("one", config);
  await writeFile(path.join(f.root, "Home.md"), "daily snapshot");
  await rename(f.bare, f.bare + ".offline"); clock = new Date(2026, 9, 21, 23);
  await tick(); const head = f.git(f.root, "rev-parse", "HEAD");
  assert.equal(controller.status().pendingCommit, head);
  await writeFile(path.join(f.root, "Home.md"), "later local edit");
  clock = new Date(2026, 9, 21, 23, 11); await tick();
  assert.equal(f.git(f.root, "rev-parse", "HEAD"), head);
  controller.close(); await rename(f.bare + ".offline", f.bare);
  const resumed = new GitController(options);
  await resumed.open({ id: "one", root: f.root }); await resumed.tail;
  assert.equal(f.git(f.bare, "rev-parse", "main"), head);
  assert.equal(f.git(f.bare, "show", "main:Home.md"), "daily snapshot");
  assert.equal(await readFile(path.join(f.root, "Home.md"), "utf8"), "later local edit");
  assert.equal(resumed.status().pendingCommit, null);
  resumed.close();
});

test("retry recognizes a pending commit already included in a newer remote history", async () => {
  const f = await fixture(); await f.service.connect(config); await f.service.sync(config);
  const pending = f.git(f.root, "rev-parse", "HEAD");
  const other = path.join(f.dir, "other"); f.git(f.dir, "clone", f.bare, other);
  await writeFile(path.join(other, "Other.md"), "another device"); f.git(other, "add", ".");
  f.git(other, "-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-m", "later remote");
  f.git(other, "push", "origin", "main");
  const newer = f.git(f.bare, "rev-parse", "main");
  await writeFile(path.join(f.root, "Home.md"), "uncommitted local edit");
  const result = await f.service.sync(config, { commit: false, revision: pending });
  assert.equal(result.phase, "synced");
  assert.equal(f.git(f.bare, "rev-parse", "main"), newer);
  assert.equal(f.git(f.root, "rev-parse", "HEAD"), pending);
  assert.equal(await readFile(path.join(f.root, "Home.md"), "utf8"), "uncommitted local edit");
});

test("re-enabling the same daily backup shows an enabled waiting state without another commit", async () => {
  const { GitController } = await import("../electron/git-controller.mjs");
  const f = await fixture();
  const controller = new GitController({ settingsFile: path.join(f.dir, "daily.json"), run: f.run,
    now: () => new Date(2026, 9, 20, 12), setTimer: () => 1, clearTimer: () => {} });
  await controller.open({ id: "one", root: f.root }); await controller.connect("one", config);
  const head = f.git(f.root, "rev-parse", "HEAD"); await controller.disconnect("one");
  await writeFile(path.join(f.root, "Home.md"), "later edits");
  const status = await controller.connect("one", config);
  assert.equal(status.enabled, true); assert.equal(status.phase, "ready"); assert.match(status.message, /대기/);
  assert.equal(f.git(f.root, "rev-parse", "HEAD"), head);
  controller.close();
});
