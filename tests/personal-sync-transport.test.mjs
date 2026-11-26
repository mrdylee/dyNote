import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import fs, { mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { PersonalSync, installDevice } from "../core/personal-sync.mjs";
import { integrate } from "../core/personal-sync-merge.mjs";
import { conflictFolder } from "../core/personal-sync-store.mjs";
import { runGit } from "../core/git-backup.mjs";

async function fixture(t) {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "dynote-device-")));
  t.after(() => rm(temp, { force: true, recursive: true }));
  const bare = path.join(temp, "remote");
  await mkdir(bare);
  await runGit(bare, ["init", "--bare", "--initial-branch=main"]);
  const remote = "https://example.invalid/personal.git";
  let now = 1000000;
  async function pc(name, options = {}) {
    const root = path.join(temp, name);
    await mkdir(root);
    const cfg = {
      remote,
      branch: "main",
      authorName: "Writer",
      authorEmail: "writer@example.invalid",
      deviceName: name,
    };
    const transport = (cwd, args, opts) =>
      runGit(
        cwd,
        args.map((arg) => (arg === remote ? bare : arg)),
        opts
      );
    await transport(root, ["init", "--initial-branch=main"]);
    const service = new PersonalSync({ root }, transport, randomUUID(), { now: () => now, ...options });
    return {
      root,
      cfg,
      service,
      sync: (opts) => service.sync(cfg, opts),
      write: (file, bytes) => writeFile(path.join(root, file), bytes),
      read: (file) => readFile(path.join(root, file)),
    };
  }
  return { pc, bare, temp, advance: (ms) => (now += ms) };
}

test("independent working copies register, hand off Markdown and stable PDF, and idle polls add zero commits", async (t) => {
  const { pc, advance, temp } = await fixture(t);
  assert.equal(...(await Promise.all([installDevice(temp), installDevice(temp)])));
  const a = await pc("Cloud"),
    b = await pc("Local");
  await a.write("회의.md", "보고서\n");
  await a.sync({ register: true });
  const received = await b.sync({ register: true });
  assert.equal(received.devices.length, 2);
  assert.equal((await b.read("회의.md")).toString(), "보고서\n");
  await b.write("회의.md", "보고서\n3시\n");
  await b.write("첨부.pdf", "%PDF-1.4\n%%EOF\n");
  assert.equal((await b.sync()).pendingFiles.length, 1);
  advance(2000);
  await b.sync();
  const update = await a.sync();
  assert.equal(update.phase, "synced");
  assert.equal((await a.read("회의.md")).toString(), "보고서\n3시\n");
  assert.deepEqual(await a.read("첨부.pdf"), await b.read("첨부.pdf"));
  const head = await a.service.disk.head();
  await b.sync();
  await a.sync();
  assert.equal(await b.service.disk.head(), head);
  assert.equal(await a.service.disk.head(), head);
  assert.equal((await a.service.store.git(["status", "--porcelain"])).stdout, "");
});

test("a CRLF checkout registers, receives device changes, and still rejects edited registration data", async (t) => {
  const { pc, bare } = await fixture(t);
  const local = await pc("Local"), cloud = await pc("Cloud");
  await local.sync({ register: true });
  // Reproduce a Git for Windows checkout in the existing Cloud vault.
  await cloud.service.store.git(["fetch", "--", bare, "main"]);
  await cloud.service.store.git(["-c", "core.autocrlf=true", "merge", "--ff-only", "FETCH_HEAD"]);
  const record = `.dynote-sync/devices/${local.service.deviceId}.json`;
  assert.match((await cloud.read(record)).toString(), /\r\n$/);
  const registered = await cloud.sync({ register: true });
  assert.deepEqual(registered.devices.map(d => d.name).sort(), ["Cloud", "Local"]);
  const attachment = "File Storage/test.png", bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  await mkdir(path.join(local.root, "File Storage"));
  await local.write(attachment, bytes);
  local.cfg.deviceName = "Local renamed";
  await local.sync({ register: true });
  const received = await cloud.sync();
  assert.equal(received.phase, "synced");
  assert.equal(JSON.parse(await cloud.read(record)).name, "Local renamed");
  assert.deepEqual(await cloud.read(attachment), bytes);
  const edited = JSON.stringify({ ...JSON.parse(await cloud.read(record)), active: false }) + "\r\n";
  await cloud.write(record, edited);
  await assert.rejects(cloud.sync({ force: false }), /동기화 관리 파일/);
  assert.equal((await cloud.read(record)).toString(), edited);
});

test("a Windows checkout restores an LF-only PDF without publishing converted bytes", async t => {
  const { pc, bare, advance } = await fixture(t);
  const local = await pc("Local"), cloud = await pc("Cloud");
  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const object of ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"]) {
    offsets.push(body.length);
    body += offsets.length + " 0 obj\n" + object + "\nendobj\n";
  }
  const pdf = Buffer.from(body + "xref\n0 4\n0000000000 65535 f \n" +
    offsets.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") +
    "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + body.length + "\n%%EOF\n");
  await local.write("paper.pdf", pdf);
  await local.sync({ register: true });
  advance(2000);
  await local.sync();
  await cloud.service.store.git(["fetch", "--", bare, "main"]);
  await cloud.service.store.git(["-c", "core.autocrlf=true", "merge", "--ff-only", "FETCH_HEAD"]);
  assert.notDeepEqual(await cloud.read("paper.pdf"), pdf);
  await cloud.sync({ register: true });
  advance(2000);
  await cloud.sync();
  assert.deepEqual((await runGit(bare, ["show", "main:paper.pdf"], { encoding: null })).stdout, pdf);
  assert.deepEqual(await cloud.read("paper.pdf"), pdf);
  const edited = Buffer.from(pdf.toString().replace("200 200", "220 220"));
  await cloud.write("paper.pdf", edited);
  await cloud.sync();
  advance(2000);
  await cloud.sync();
  assert.deepEqual((await runGit(bare, ["show", "main:paper.pdf"], { encoding: null })).stdout, edited);
});

test("receiving over a CRLF note leaves no phantom edit and retains an open draft", async t => {
  const { pc, bare } = await fixture(t);
  const local = await pc("Local"), cloud = await pc("Cloud");
  await local.write("note.md", "first\n");
  await local.sync({ register: true });
  await cloud.service.store.git(["fetch", "--", bare, "main"]);
  await cloud.service.store.git(["-c", "core.autocrlf=true", "merge", "--ff-only", "FETCH_HEAD"]);
  const revision = createHash("sha256").update(await cloud.read("note.md")).digest("hex");
  await cloud.sync({ register: true });
  await local.write("note.md", "second\n");
  await local.sync();
  await cloud.sync();
  const head = await cloud.service.disk.head();
  assert.deepEqual((await cloud.sync()).conflicts, []);
  assert.equal(await cloud.service.disk.head(), head);
  assert.equal((await cloud.service.saveDraft("note.md", "my edit", revision, cloud.cfg))?.preserved, true);
});

test("a CRLF clone of existing conflict history can join and preserves original versions", async t => {
  const { pc, bare } = await fixture(t);
  const local = await pc("Local"), cloud = await pc("Cloud");
  const file = "meeting.md";
  await local.write(file, "before\n");
  await local.write("photo.png", Buffer.from([137, 0, 10]));
  await local.sync({ register: true });
  await cloud.sync({ register: true });
  await local.write(file, "local edit\n");
  await cloud.write(file, "cloud edit\n");
  await local.write("photo.png", Buffer.from([137, 0, 1, 10]));
  await cloud.write("photo.png", Buffer.from([137, 0, 2, 10]));
  await local.sync();
  await cloud.sync();
  const fresh = await pc("New PC");
  await fresh.service.store.git(["fetch", "--", bare, "main"]);
  await fresh.service.store.git(["-c", "core.autocrlf=true", "merge", "--ff-only", "FETCH_HEAD"]);
  const versions = (await cloud.service.versions(file)).versions;
  const state = await fresh.sync({ register: true });
  assert.equal(state.devices.length, 3);
  assert.equal((await fresh.sync({ force: false })).phase, "synced");
  assert.equal((await fresh.service.store.tree(await fresh.service.disk.head())).get(file).oid,
    (await cloud.service.store.tree(await cloud.service.disk.head())).get(file).oid);
  for (const { commit } of versions)
    assert.deepEqual(await fresh.service.preview(file, commit), await cloud.service.preview(file, commit));
  await cloud.write("new.md", "available");
  await cloud.sync();
  await fresh.sync();
  assert.equal((await fresh.read("new.md")).toString(), "available");
  const files = await fresh.service.store.tree(await fresh.service.disk.head());
  const body = [...files.keys()].find(name => name.startsWith(conflictFolder("photo.png")) && name.endsWith(".blob"));
  const original = await fresh.read(body);
  await fresh.write(body, Buffer.concat([original.subarray(0, -1), Buffer.from("\r\n")]));
  await assert.rejects(fresh.sync({ force: false }), error => error.message.includes(body));
  await fresh.write(body, original);
  const unknown = ".dynote-sync/devices/unknown.json";
  await fresh.write(unknown, "{}\n");
  await assert.rejects(fresh.sync({ force: false }), error => error.message.includes(unknown));
  await rm(path.join(fresh.root, unknown));
  const record = [...files.keys()].find(name => name.startsWith(".dynote-sync/conflicts/") && name.endsWith(".json"));
  await fresh.write(record, "{}\r\n");
  await assert.rejects(fresh.sync(), error => error.message.includes(record));
  assert.equal((await fresh.read(record)).toString(), "{}\r\n");
});

test("remote receive retains a displaced open writer and publishes the late bytes as a separate version", async (t) => {
  const { pc } = await fixture(t);
  const a = await pc("Cloud"),
    b = await pc("Local");
  await a.write("time.md", "1시\n");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  const handle = await open(path.join(b.root, "time.md"), "r+");
  try {
    await a.write("time.md", "2시\n");
    await a.sync();
    await b.sync();
    const restarted = new PersonalSync({ root: b.root }, b.service.store.run, b.service.deviceId);
    await restarted.sync(b.cfg);
    await handle.write(Buffer.from("3시\n"), 0, 5, 0);
    await handle.sync();
    await restarted.sync(b.cfg);
  } finally {
    await handle.close();
  }
  await b.sync();
  const state = await a.sync();
  assert.equal(state.conflicts[0].count, 2);
  assert.deepEqual(await a.read("time.md"), Buffer.from("2시\n"));
  const { versions, basis } = await a.service.versions("time.md");
  const picked = versions.find((v) => v.device === "Local");
  assert(picked);
  const offline = t.mock.method(a.service.store, "remoteHead", () => { throw new Error("offline"); });
  const changed = await a.service.resolve(a.cfg, "time.md", basis, picked.commit);
  assert(changed.includes("time.md"));
  assert.equal((await a.read("time.md")).toString(), "3시\n");
  assert.deepEqual((await a.service.versions("time.md")).basis, []);
  assert.equal(offline.mock.callCount(), 0);
  assert.equal((await b.read("time.md")).toString(), "2시\n");
  await assert.rejects(a.sync(), /offline/);
  assert.equal((await a.read("time.md")).toString(), "3시\n");
  offline.mock.restore();
  await a.sync();
  await b.sync();
  assert.equal((await b.read("time.md")).toString(), "3시\n");
});

function interceptFs(t, method, intercept) {
  const original = fs[method];
  fs[method] = (...args) => intercept(original, ...args);
  syncBuiltinESMExports();
  t.after(() => {
    fs[method] = original;
    syncBuiltinESMExports();
  });
}

for (const [method, code, advice] of [["link", "ENOTSUP", /하드링크/], ["rename", "EBUSY", /닫|사용 중/]]) {
  test(`the storage probe detects a rejected ${method} between the vault and recovery folder before registration`, async t => {
    const { pc } = await fixture(t), a = await pc("A");
    await a.write("local.md", "mine");
    const git = path.join(a.root, ".git") + path.sep;
    let blocked = true;
    interceptFs(t, method, (original, from, to) => {
      if (blocked && from.startsWith(git) !== to.startsWith(git))
        throw Object.assign(new Error("injected"), { code });
      return original(from, to);
    });
    await assert.rejects(a.service.init(), error =>
      error.code === code && error.syncStage === "apply" && advice.test(error.message));
    assert.deepEqual((await readdir(a.root)).sort(), [".git", "local.md"]);
    assert.deepEqual(await readdir(path.join(git, "dynote-personal")), []);
    assert.equal((await a.read("local.md")).toString(), "mine");
    blocked = false;
    assert.equal((await a.sync({ register: true })).phase, "synced");
  });
}

async function incomingNote(t) {
  const { pc } = await fixture(t), a = await pc("A"), b = await pc("B");
  const name = "paper.md", file = path.join(b.root, name);
  await a.write(name, "original");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  await a.write(name, "incoming");
  await a.sync();
  return { a, b, name, file, restart: () => new PersonalSync({ root: b.root }, b.service.store.run, b.service.deviceId) };
}

test("failed publication keeps the original readable on repeated errors and saves a subsequent edit on restart", async t => {
  const { b, name, file, restart } = await incomingNote(t);
  const previous = await b.service.disk.head();
  let blocked = true;
  interceptFs(t, "link", (original, from, to) => {
    if (blocked && to === file) throw Object.assign(new Error("injected"), { code: "ENOTSUP" });
    return original(from, to);
  });
  for (let retry = 0; retry < 2; retry++) {
    const error = await b.sync().then(() => null, failure => failure);
    assert.equal((await b.read(name).catch(() => null))?.toString(), "original");
    assert.equal(error?.code, "ENOTSUP");
    assert.match(error.message, /하드링크/);
    assert.equal(await b.service.disk.head(), previous);
    assert(await b.service.disk.job());
  }
  await b.write(name, "edited during interruption");
  blocked = false;
  const service = restart();
  await service.sync(b.cfg);
  const { versions } = await service.versions(name);
  assert.equal(versions.length, 2);
  assert.deepEqual(new Set(await Promise.all(versions.map(async v => (await service.preview(name, v.commit)).toString()))),
    new Set(["edited during interruption", "incoming"]));
  assert.equal(await service.disk.job(), null);
});

test("a failed publication reports the retained original when another file occupies its destination", async t => {
  const { b, name, file, restart } = await incomingNote(t);
  let compete = true, unsupported = false;
  interceptFs(t, "link", async (original, from, to) => {
    if (unsupported) throw Object.assign(new Error("injected"), { code: "ENOTSUP" });
    if (compete && to === file && from.endsWith(".part")) {
      compete = false;
      await writeFile(to, "competing file", { flag: "wx" });
    }
    return original(from, to);
  });
  const error = await b.sync().then(() => null, failure => failure);
  const row = (await b.service.disk.job()).records.find(r => r.name === name);
  assert.equal(error.code, "EEXIST");
  assert.equal(error.recoveryFile, row.saved);
  assert(error.message.includes(row.saved));
  assert.equal(await readFile(await b.service.disk.recoveryPath(error.recoveryFile), "utf8"), "original");
  await assert.rejects(b.service.disk.recoveryPath(row.saved + ".source.json"), /복구 사본/);
  await assert.rejects(b.service.disk.recoveryPath(randomUUID()), /복구 사본/);
  assert.equal((await b.read(name)).toString(), "competing file");
  const service = restart();
  unsupported = true;
  await assert.rejects(service.sync(b.cfg), { code: "ENOTSUP", recoveryFile: row.saved });
  assert.equal(await readFile(await service.disk.recoveryPath(row.saved), "utf8"), "original");
  unsupported = false;
  await service.sync(b.cfg);
  const { versions } = await service.versions(name);
  assert.equal(versions.length, 2);
  assert.deepEqual(new Set(await Promise.all(versions.map(async v => (await service.preview(name, v.commit)).toString()))),
    new Set(["competing file", "incoming"]));
  await assert.rejects(service.disk.recoveryPath(row.saved), /복구 사본/);
});

test("running out of space preparing the incoming file never displaces the original", async t => {
  const { b, name, file } = await incomingNote(t);
  let moved = false;
  interceptFs(t, "rename", (original, from, to) => {
    if (from === file) moved = true;
    return original(from, to);
  });
  interceptFs(t, "writeFile", (original, dest, ...args) => {
    if (dest.endsWith(".part")) throw Object.assign(new Error("injected"), { code: "ENOSPC" });
    return original(dest, ...args);
  });
  await assert.rejects(b.sync(), { code: "ENOSPC" });
  assert.equal(moved, false);
  assert.equal((await b.read(name)).toString(), "original");
});

test("a deletion after the original was restored survives another failed probe and restart", async t => {
  const { b, name, file, restart } = await incomingNote(t);
  let blocked = true;
  interceptFs(t, "link", (original, from, to) => {
    if (blocked) throw Object.assign(new Error("injected"), { code: "ENOTSUP" });
    return original(from, to);
  });
  await assert.rejects(b.sync(), { code: "ENOTSUP" });
  assert.equal((await b.read(name)).toString(), "original");
  await rm(file);
  const service = restart();
  await assert.rejects(service.sync(b.cfg), { code: "ENOTSUP" });
  await assert.rejects(b.read(name), { code: "ENOENT" });
  blocked = false;
  await service.sync(b.cfg);
  const { versions } = await service.versions(name);
  assert.equal(versions.length, 2);
  assert(versions.some(version => version.blob === null));
});

test("a failed storage probe makes a displaced legacy original visible and leaves its journal resumable", async t => {
  const { a, b, name, file, restart } = await incomingNote(t);
  const disk = b.service.disk;
  await b.service.store.git(["fetch", "--", a.root, "main"]);
  await disk.begin("main", await disk.head(), await a.service.disk.head());
  const row = (await disk.job()).records.find(r => r.name === name);
  await rename(file, path.join(disk.dir, row.saved));
  let blocked = true;
  interceptFs(t, "link", (original, from, to) => {
    if (blocked) throw Object.assign(new Error("injected"), { code: "ENOTSUP" });
    return original(from, to);
  });
  const service = restart();
  await assert.rejects(service.sync(b.cfg), { code: "ENOTSUP" });
  assert.equal((await b.read(name).catch(() => null))?.toString(), "original");
  assert.equal((await disk.job()).records.find(r => r.name === name).saved, row.saved);
  blocked = false;
  assert.equal((await service.sync(b.cfg)).phase, "synced");
  assert.equal((await b.read(name)).toString(), "incoming");
  assert.deepEqual((await service.versions(name)).versions, []);
});

test("a device permission change during replacement keeps the original record", { skip: process.platform === "win32" }, async t => {
  const { pc } = await fixture(t), a = await pc("A"), b = await pc("B");
  await a.sync({ register: true });
  await b.sync({ register: true });
  a.cfg.deviceName = "renamed";
  await a.sync({ register: true });
  const name = `.dynote-sync/devices/${a.service.deviceId}.json`, file = path.join(b.root, name);
  const before = await b.read(name);
  let change = true;
  interceptFs(t, "rename", async (original, from, to) => {
    if (change && from === file) {
      change = false;
      await fs.chmod(from, 0o755);
    }
    return original(from, to);
  });
  await assert.rejects(b.sync(), { syncReason: "managed-record" });
  assert.deepEqual(await b.read(name), before);
  assert((await fs.stat(file)).mode & 0o111);
  await fs.chmod(file, 0o644);
  assert.equal((await b.sync()).phase, "synced");
  assert.equal(JSON.parse(await b.read(name)).name, "renamed");
});

test("an edited CRLF device record interrupts an older formatting repair without reading an unstored preimage", async t => {
  const { pc } = await fixture(t), a = await pc("A");
  await a.sync({ register: true });
  const disk = a.service.disk, head = await disk.head(), name = `.dynote-sync/devices/${a.service.deviceId}.json`;
  const entry = (await a.service.store.tree(head)).get(name), original = JSON.parse(await a.read(name));
  await a.write(name, JSON.stringify(original, null, 2).replaceAll("\n", "\r\n") + "\r\n");
  const before = (await disk.read(name)).oid;
  await disk.startJob("main", head, head, [{ name, before, after: entry.oid, mode: entry.mode, size: entry.size, saved: randomUUID() }]);
  const edited = JSON.stringify({ ...original, active: false }) + "\r\n";
  await a.write(name, edited);
  await assert.rejects(a.sync(), { syncReason: "managed-record", syncStage: "apply" });
  assert.equal((await a.read(name)).toString(), edited);
});

test("restarts at the gap between rename and publication; an outside replacement remains reachable", async (t) => {
  const { pc } = await fixture(t),
    a = await pc("A"),
    b = await pc("B");
  await a.write("paper.md", "base");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  await a.write("paper.md", "remote");
  await a.sync();
  const old = await b.service.disk.head(),
    next = await a.service.disk.head();
  await b.service.store.git(["fetch", "--", a.root, "main"]);
  await b.service.disk.begin("main", old, next);
  const job = await b.service.disk.job(),
    row = job.records.find((r) => r.name === "paper.md");
  await rename(path.join(b.root, row.name), path.join(b.service.disk.dir, row.saved));
  await b.write(row.name, "local while interrupted");
  const restarted = new PersonalSync({ root: b.root }, b.service.store.run, b.service.deviceId);
  await restarted.sync(b.cfg);
  await restarted.sync(b.cfg);
  const status = await a.sync();
  assert.equal(status.conflicts[0].count, 2);
  const { versions } = await a.service.versions(row.name);
  assert.deepEqual(
    new Set(await Promise.all(versions.map(async (v) => (await a.service.preview(row.name, v.commit)).toString()))),
    new Set(["remote", "local while interrupted"])
  );
});

test("a stale open editor creates a recoverable side commit using its actual base", async (t) => {
  const { pc } = await fixture(t),
    a = await pc("A"),
    b = await pc("B");
  await a.write("notes.md", "1");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  await a.write("notes.md", "2");
  await a.sync();
  await b.sync();
  const rev = createHash("sha256").update("1").digest("hex");
  assert((await b.service.saveDraft("notes.md", "3", rev, b.cfg)).preserved);
  await b.sync();
  await a.sync();
  assert.equal((await a.service.versions("notes.md")).versions.length, 2);
});

test("daily batch waits five minutes, rejects rewritten remotes and never publishes an excluded tracked file", async (t) => {
  const { pc, bare, advance } = await fixture(t),
    a = await pc("A");
  await a.write("notes.md", "1");
  await a.sync({ register: true });
  const base = await a.service.disk.head();
  await a.write("notes.md", "2");
  await a.sync({ force: false });
  advance(299999);
  await a.sync({ force: false });
  assert.equal(await a.service.disk.head(), base);
  advance(1);
  await a.sync({ force: false });
  const updated = await a.service.disk.head();
  assert.notEqual(updated, base);
  await runGit(bare, ["update-ref", "refs/heads/main", base, updated]);
  await assert.rejects(a.sync(), /재작성/);
  assert.equal(await a.service.disk.head(), updated);
  await runGit(bare, ["update-ref", "refs/heads/main", updated, base]);
  await a.write(".outside", "private");
  await a.service.store.git(["add", "--", ".outside"]);
  await a.service.store.git([
    "-c",
    "user.name=external",
    "-c",
    "user.email=external@example.invalid",
    "commit",
    "-m",
    "external",
  ]);
  await assert.rejects(a.sync(), /범위 밖/);
  assert.equal((await runGit(bare, ["rev-parse", "main"])).stdout.trim(), updated);
});

test("a 528 MiB incoming tree resumes past 512 MiB without losing an offline edit", async (t) => {
  const { pc } = await fixture(t),
    a = await pc("A");
  await a.write("root.md", "initial");
  await a.sync({ register: true });
  const head = await a.service.disk.head(),
    store = a.service.store;
  const entry = await store.storeBytes(Buffer.alloc(24 * 1024 * 1024, 65));
  const names = Array.from({ length: 22 }, (_, i) => "attachments/" + String(i).padStart(2, "0") + ".png");
  const tree = await store.writeTree(head, new Map(names.map((name) => [name, entry])));
  const device = { id: a.service.deviceId, name: "A" };
  const remote = await store.commitTree(tree, [head], "large attachment batch", device, a.cfg);
  await store.git(["push", "--", a.cfg.remote, remote + ":refs/heads/main"]);
  const partial = await a.sync();
  assert.equal(partial.phase, "pending");
  assert.equal(await a.service.disk.head(), head);
  await a.write(names.at(-1), "bytes written between batches");
  const restarted = new PersonalSync({ root: a.root }, store.run, a.service.deviceId);
  const final = await restarted.sync(a.cfg);
  assert.equal(final.conflicts[0].name, names.at(-1));
  assert.equal((await restarted.store.tree(await restarted.disk.head())).get(names[0]).oid, entry.oid);
  assert.equal((await restarted.versions(names.at(-1))).basis.length, 2);
});

test("lost push acknowledgement, branch deletion and an invalid external copy", async (t) => {
  const { pc, bare, advance } = await fixture(t),
    a = await pc("A");
  await a.write("file.md", "base");
  await a.sync({ register: true });
  const run = a.service.store.run;
  let lost = false;
  a.service.store.run = async (root, args, opts) => {
    const result = await run(root, args, opts);
    if (args[0] === "push" && !lost) {
      lost = true;
      throw new Error("lost acknowledgement");
    }
    return result;
  };
  await a.write("file.md", "new");
  await a.sync();
  const head = await a.service.disk.head();
  await a.sync();
  assert(lost);
  assert.equal(await a.service.disk.head(), head);
  await a.write("draft.pdf", "%PDF without final bytes");
  await a.write("link.md", "![[draft.pdf]]");
  await a.sync();
  advance(5000);
  const partial = await a.sync();
  assert(partial.pendingFiles.some((f) => f.name === "link.md"));
  const file = partial.pendingFiles.find((f) => f.name === "draft.pdf");
  await a.service.confirm(file.name, file.oid);
  await a.sync();
  const files = await a.service.store.tree(await a.service.disk.head());
  assert(files.has("link.md") && files.has("draft.pdf"));
  await runGit(bare, ["update-ref", "-d", "refs/heads/main"]);
  await assert.rejects(a.sync(), /삭제/);
});

test("after interruption an externally changed displaced inode is preserved before the target is published", async (t) => {
  const { pc } = await fixture(t),
    a = await pc("A"),
    b = await pc("B");
  await a.write("open.md", "base");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  await a.write("open.md", "published");
  await a.sync();
  const service = b.service,
    old = await service.disk.head(),
    next = await a.service.disk.head();
  await service.store.git(["fetch", "--", a.root, "main"]);
  await service.disk.begin("main", old, next);
  const job = await service.disk.job(),
    row = job.records.find((r) => r.name === "open.md");
  const backup = path.join(service.disk.dir, row.saved),
    handle = await open(path.join(b.root, row.name), "r+");
  try {
    await rename(path.join(b.root, row.name), backup);
    await handle.write(Buffer.from("late"), 0, 4, 0);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const restarted = new PersonalSync({ root: b.root }, service.store.run, service.deviceId);
  await restarted.sync(b.cfg);
  const { versions } = await restarted.versions(row.name);
  assert.equal((await b.read(row.name)).toString(), "published");
  assert.deepEqual(
    new Set(await Promise.all(versions.map(async (v) => (await restarted.preview(row.name, v.commit)).toString()))),
    new Set(["late", "published"])
  );
});

test("renaming a device keeps its identity, and deregistration blocks a stale device until it explicitly rejoins", async (t) => {
  const { pc } = await fixture(t),
    a = await pc("Cloud"),
    b = await pc("Local");
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  b.cfg.deviceName = "Cloud";
  await b.sync({ register: true });
  const state = await a.sync();
  assert.equal(state.devices.length, 2);
  assert(state.devices.every((d) => d.name === "Cloud"));
  await a.service.removeDevice(a.cfg, b.service.deviceId);
  await b.write("offline.md", "kept");
  await assert.rejects(b.sync(), /등록이 해제/);
  await b.sync({ register: true });
  const joined = await a.sync();
  assert.equal(joined.devices.length, 2);
  assert.equal((await a.read("offline.md")).toString(), "kept");
});

async function conflictingPCs(t) {
  const {pc} = await fixture(t);
  const [a, b, c] = await Promise.all(["A", "B", "C"].map(name => pc(name)));
  const file = "meeting.md";
  await a.write(file, "0");
  for (const device of [a, b, c]) await device.sync({register:true});
  await a.sync();
  await b.sync();
  await a.write(file, "a");
  await b.write(file, "b");
  await a.sync();
  await b.sync();
  await a.sync();
  async function choose(device, value) {
    const {basis, versions} = await device.service.versions(file);
    for (const version of versions) {
      if (String(await device.service.preview(file, version.commit)) === value)
        return device.service.resolve(device.cfg, file, basis, version.commit);
    }
    assert.fail("Missing review candidate: " + value);
  }
  return {a, b, c, file, choose};
}

test("offline decisions and subsequent edits keep their own source commits", async t => {
  const {a, b, file, choose} = await conflictingPCs(t);
  await choose(a, "a");
  await choose(b, "b");
  await b.write(file, "b edited");
  await a.sync();
  await b.sync();
  await a.sync();
  const {versions} = await a.service.versions(file);
  const alternatives = await Promise.all(versions.map(async v => String(await a.service.preview(file, v.commit))));
  assert.deepEqual(alternatives.sort(), ["a", "b", "b edited"]);
  await choose(a, "b edited");
  await a.sync();
  await b.sync();
  assert.equal(String(await b.read(file)), "b edited");
  assert.deepEqual((await b.service.versions(file)).basis, []);
});

for (const choiceFirst of [true, false]) {
  test(`published text remains selectable beside an unseen edit (choice published first: ${choiceFirst})`, async t => {
    const {a, b, c, file, choose} = await conflictingPCs(t);
    await choose(b, "a");
    await c.write(file, "c");
    if (choiceFirst) await b.sync();
    await c.sync();
    await b.sync();
    await a.sync();
    assert.equal(String(await a.read(file)), "a");
    const {versions} = await a.service.versions(file);
    const alternatives = await Promise.all(versions.map(async v => String(await a.service.preview(file, v.commit))));
    assert.deepEqual(alternatives.sort(), ["a", "c"]);
    await choose(a, "a");
    await a.sync();
    await c.sync();
    assert.equal(String(await c.read(file)), "a");
    assert.deepEqual((await c.service.versions(file)).basis, []);
  });
}

test("local resolution completes while a previous remote query is still waiting", async t => {
  const {b, file} = await conflictingPCs(t);
  const {GitController} = await import("../electron/git-controller.mjs");
  const controller = new GitController({
    settingsFile:path.join(path.dirname(b.root), "settings.json"), isPersonal:() => true, setTimer:() => null,
  });
  const config = {...b.cfg, mode:"personal-sync"};
  Object.assign(controller, {
    vault:{id:"B", root:b.root}, canonicalRoot:b.root, personal:b.service,
    current:{enabled:true, config, phase:"synced"}, records:{B:{...config, enabled:true}},
  });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const remoteHead = b.service.store.remoteHead.bind(b.service.store);
  t.mock.method(b.service.store, "remoteHead", async (...args) => {
    entered.resolve();
    await release.promise;
    return remoteHead(...args);
  });
  const {basis, versions} = await b.service.versions(file);
  const poll = controller.sync("B", {automatic:true});
  await entered.promise;
  const applied = controller.personalAction("B", {action:"resolve", path:file, basis, commit:versions.find(v => v.device === "B").commit});
  let timeout;
  try {
    await Promise.race([applied, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Local apply waited for the remote query")), 15000);
    })]);
    assert.equal(String(await b.read(file)), "b");
  } finally {
    clearTimeout(timeout);
    release.resolve();
    await Promise.all([poll, applied]);
    await controller.tail;
    controller.close();
  }
});

test("retry repairs an unpublished beta.6 decision merge from its parents and retains its original head", async t => {
  const {a, b, file, choose} = await conflictingPCs(t);
  await choose(a, "a");
  await choose(b, "b");
  const {store, disk} = b.service, device = {id:b.service.deviceId, name:"B"};
  const decision = await disk.head();
  await b.write(file, "b edited");
  await b.service.checkpointFile(b.cfg, file, "후속 편집");
  const edit = await disk.head();
  await a.sync();
  await store.git(["fetch", "--", b.cfg.remote, "main"]);
  const remote = await disk.head("FETCH_HEAD");
  const merged = await integrate(store, remote, edit, device, b.cfg);
  const files = await store.tree(merged), folder = conflictFolder(file);
  const record = (await store.metadata(files)).groups.get(file).versions.get(decision);
  const legacyTree = await store.writeTree(merged, new Map([
    [folder + decision + ".json", await store.storeRecord({...record, blob:(await store.tree(edit)).get(file).oid})],
    [folder + edit + ".json", null],
  ]));
  const legacy = await store.commitTree(legacyTree, [remote, edit], "개인노트 변경 통합", device, b.cfg);
  await disk.begin(b.cfg.branch, edit, legacy);
  await b.service.resume(device, b.cfg);
  await b.sync();
  assert.equal(await disk.head("refs/dynote-sync/recovery/" + legacy), legacy);
  await a.sync();
  await choose(a, "b edited");
  await a.sync();
  await b.sync();
  assert.equal(String(await b.read(file)), "b edited");
});
