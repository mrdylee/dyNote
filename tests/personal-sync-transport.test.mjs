import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { PersonalSync, installDevice } from "../core/personal-sync.mjs";
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
  await a.service.resolve(a.cfg, "time.md", basis, picked.commit);
  await b.sync();
  assert.equal((await b.read("time.md")).toString(), "3시\n");
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
