import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, chmod, lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  PersonalSyncStore,
  devicePath,
  deviceRecord,
  conflictFolder,
  assertSyncEntry,
  blobLimit,
} from "../core/personal-sync-store.mjs";
import { PersonalSync } from "../core/personal-sync.mjs";
import { runGit } from "../core/git-backup.mjs";
import { localOnlyFiles } from "../core/git-file-status.mjs";
import { validFilePath, validPersonalFilePath } from "../core/vault.mjs";
import { mergeCaptureBlocks, textChoices } from "../core/personal-sync-text.mjs";
import { integrate, chooseVersion, checkTreeChanges, normalizePublished } from "../core/personal-sync-merge.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-sync-store-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "vault");
  await mkdir(root);
  const store = new PersonalSyncStore(root);
  await store.git(["init", "--initial-branch=main"]);
  const config = { authorName: "Note Writer", authorEmail: "test@example.invalid" };
  const cloud = deviceRecord(randomUUID(), "Cloud PC"),
    local = deviceRecord(randomUUID(), "Local PC"),
    late = deviceRecord(randomUUID(), "Laptop");
  async function checkpoint(parent, device, files) {
    const updates = new Map([[devicePath(device.id), await store.storeRecord(device)]]);
    for (const [name, content] of Object.entries(files))
      updates.set(name, content === null ? null : await store.storeBytes(Buffer.from(content)));
    const tree = await store.writeTree(parent, updates);
    return store.commitTree(tree, parent ? [parent] : [], "노트 저장", device, config);
  }
  return { root, store, config, cloud, local, late, checkpoint };
}

async function workingCopies(t) {
  const { root, local, cloud, config } = await fixture(t);
  const bare = root + ".git", remote = "https://example.invalid/personal.git";
  await runGit(root, ["init", "--bare", "--initial-branch=main", bare]);
  let time = 1000000;
  async function pc(device) {
    const dir = await realpath(await mkdtemp(path.join(path.dirname(root), "pc-")));
    await runGit(dir, ["init", "--initial-branch=main"]);
    await runGit(dir, ["config", "url." + bare + ".insteadOf", remote]);
    const service = new PersonalSync({ root: dir }, runGit, device.id, { now: () => time });
    const cfg = { ...config, branch: "main", deviceName: device.name, remote };
    return { dir, service, cfg, sync: (options) => service.sync(cfg, options) };
  }
  return { a: await pc(local), b: await pc(cloud), bare, tick: () => new Date(++time).toISOString() };
}

test("File Storage uses the selected Git mode's eligibility rules for ZIP", async t => {
  const { store, root } = await fixture(t), git = args => store.git(args);
  await mkdir(path.join(root, "File Storage"));
  await writeFile(path.join(root, "File Storage", "sample.zip"), "sample");
  const team = await localOnlyFiles(git, validFilePath);
  assert.deepEqual(team.map(file => file.name), ["File Storage/sample.zip"]);
  assert.match(team[0].message, /형식/);
  assert.deepEqual(await localOnlyFiles(git, validPersonalFilePath), []);
});

test("File Storage transfers arbitrary formats and reports Git exclusions separately from transfer waits", async t => {
  const { a, b, bare } = await workingCopies(t);
  await a.sync({ register: true });
  await b.sync({ register: true });
  const folder = path.join(a.dir, "File Storage");
  await mkdir(path.join(folder, "excluded"), { recursive: true });
  await writeFile(path.join(a.dir, ".git", "info", "exclude"), "private.md\n/File Storage/excluded/\n");
  for (const name of ["paper.docx", "private.md", "excluded/nested.md", "~$lock.docx", ".DS_Store", "desktop.ini", "copy.tmp"])
    await writeFile(path.join(folder, name), name);
  const bytes = Buffer.from([0x4d, 0x5a, 0, 0xff, 13, 10]);
  await mkdir(path.join(folder, "tools"));
  for (const name of ["tools/setup.exe", "tools/README"]) await writeFile(path.join(folder, name), bytes);
  await writeFile(path.join(a.dir, "outside.exe"), bytes);
  const large = path.join(folder, "large.pdf");
  await writeFile(large, "");
  await truncate(large, blobLimit + 1);
  await writeFile(path.join(folder, "hand-off.md"), "received");
  const mixed = await a.sync(), local = mixed.localOnlyFiles;
  assert.deepEqual(local?.map(f => f.name).sort(), [
    "File Storage/excluded/", "File Storage/private.md",
  ]);
  assert.match(local.find(f => f.name.endsWith("private.md")).message, /Git.*제외/);
  assert.match(local.find(f => f.name.endsWith("excluded/")).message, /Git.*제외/);
  assert.deepEqual(mixed.pendingFiles.map(f => f.name), ["File Storage/large.pdf"]);
  assert.match(mixed.message, /전송 대기/);
  assert.match(mixed.message, /이 PC에만/);
  await b.sync();
  const received = await readFile(path.join(b.dir, "File Storage", "hand-off.md"), "utf8");
  assert.equal(received, "received");
  assert.deepEqual((await runGit(bare, ["ls-tree", "-r", "--name-only", "main", "--", "File Storage"])).stdout.trim().split("\n"),
    ["File Storage/copy.tmp", "File Storage/desktop.ini", "File Storage/hand-off.md", "File Storage/paper.docx", "File Storage/tools/README", "File Storage/tools/setup.exe"]);
  for (const name of ["tools/setup.exe", "tools/README"])
    assert.deepEqual(await readFile(path.join(b.dir, "File Storage", name)), bytes);
  await assert.rejects(readFile(path.join(b.dir, "outside.exe")), { code: "ENOENT" });
  await rm(large);
  const exclusions = await a.sync();
  assert.equal(exclusions.phase, "local-only");
  assert.match(exclusions.message, /이 PC에만/);
  assert.deepEqual(exclusions.pendingFiles, []);
  const copy = "File Storage/copy.pdf";
  await writeFile(path.join(a.dir, copy), "incomplete");
  assert((await a.sync()).pendingFiles.some(f => f.name === copy));
  await appendFile(path.join(a.dir, ".git", "info", "exclude"), "/" + copy + "\n");
  await writeFile(path.join(folder, "hand-off.md"), "new unsent edit");
  const poll = await a.sync({ force: false });
  assert(poll.localOnlyFiles.some(f => f.name === copy));
  assert(!poll.pendingFiles.some(f => f.name === copy));
});

test("an incoming path collision leaves an ignored local document private and lets the download resume after a move", async t => {
  const { a, b, bare } = await workingCopies(t);
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  const name = "File Storage/private.md", file = path.join(a.dir, name);
  for (const pc of [a, b]) await mkdir(path.join(pc.dir, "File Storage"));
  await writeFile(path.join(a.dir, ".git", "info", "exclude"), "/File Storage/private.md\n");
  await writeFile(file, "local-only bytes");
  await writeFile(path.join(b.dir, name), "incoming bytes");
  await b.sync();
  const remoteHead = (await runGit(bare, ["rev-parse", "main"])).stdout;
  await assert.rejects(a.sync(), /Git 제외 규칙/);
  assert.equal(await readFile(file, "utf8"), "local-only bytes");
  assert.equal((await runGit(a.dir, ["for-each-ref", "refs/dynote-sync/inputs/"])).stdout, "");
  const moved = path.join(a.dir, "private.copy");
  await rename(file, moved);
  await a.sync();
  await a.sync();
  assert.equal(await readFile(file, "utf8"), "incoming bytes");
  assert.equal(await readFile(moved, "utf8"), "local-only bytes");
  assert.equal((await runGit(bare, ["rev-parse", "main"])).stdout, remoteHead);
});

test("remote checks, downloads and blocked uploads retain the time of the last confirmed push", async t => {
  const { a, b, tick } = await workingCopies(t);
  const initial = tick(), events = [];
  const onStage = (...event) => events.push(event);
  const registered = await a.sync({ register: true, onStage });
  assert.equal(registered.lastSuccess, initial);
  assert.equal(registered.lastRemoteCheck, initial);
  assert(events.some(([stage, done, time]) => stage === "push" && done && time === initial));
  await b.sync({ register: true });
  const download = tick(), received = await a.sync({ onStage });
  assert.equal(received.lastRemoteCheck, download);
  assert.equal(received.lastSuccess, undefined);
  const idle = tick(), checked = await a.sync();
  assert.equal(checked.lastRemoteCheck, idle);
  assert.equal(checked.lastSuccess, undefined);
  await writeFile(path.join(a.dir, "draft.pdf"), "copy in progress");
  const pending = tick(), blocked = await a.sync();
  assert.equal(blocked.phase, "pending");
  assert.equal(blocked.lastRemoteCheck, pending);
  assert.equal(blocked.lastSuccess, undefined);

  const original = a.service.store.run;
  a.service.store.run = async (...args) => {
    const result = await original(...args);
    if (args[1][0] === "push") throw new Error("lost acknowledgement");
    return result;
  };
  await writeFile(path.join(a.dir, "handoff.md"), "new");
  const advanced = tick(), saved = await a.sync({ onStage });
  assert.equal(saved.lastSuccess, advanced);
  assert(events.some(([stage, done, time]) => stage === "push" && done && time === advanced));
  const updates = await b.sync();
  assert(updates.changed.includes("handoff.md"));
  assert.equal(updates.lastSuccess, undefined);
});

test("a lost upload response is confirmed when another PC already advanced the same branch", async t => {
  const { a, b, tick } = await workingCopies(t);
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  const run = a.service.store.run;
  let pushes = 0;
  a.service.store.run = async (...args) => {
    const result = await run(...args);
    if (args[1][0] === "push" && ++pushes === 1) {
      await writeFile(path.join(b.dir, "other.md"), "other PC");
      await b.sync();
      throw new Error("lost acknowledgement");
    }
    return result;
  };
  await writeFile(path.join(a.dir, "local.md"), "this PC");
  const saved = tick(), state = await a.sync();
  assert.equal(pushes, 1);
  assert.equal(state.lastSuccess, saved);
  assert.equal(await readFile(path.join(a.dir, "other.md"), "utf8"), "other PC");
});

test("device JSON formatting is repaired before registration and incoming changes while user bytes are retained", async t => {
  const { a, b, bare } = await workingCopies(t);
  await a.sync({ register: true });
  await b.sync({ register: true });
  await a.sync();
  const localPath = devicePath(a.service.deviceId), file = path.join(b.dir, localPath);
  const original = await readFile(file);
  const pretty = Buffer.from("\uFEFF" + JSON.stringify(JSON.parse(original), null, 4).replaceAll("\n", "\r\n") + "\r\n");
  await writeFile(file, pretty);
  await writeFile(path.join(b.dir, "user.md"), pretty);
  const updated = await b.sync();
  assert.equal(updated.phase, "synced");
  assert.deepEqual(await readFile(file), original);
  assert.deepEqual((await runGit(bare, ["show", "main:user.md"], { encoding: null })).stdout, pretty);
  await writeFile(file, pretty);
  a.cfg.deviceName = "Local renamed";
  await a.sync({ register: true });
  const received = await b.sync();
  assert.equal(received.lastSuccess, undefined);
  assert.equal(JSON.parse(await readFile(file)).name, "Local renamed");
  const ownFile = path.join(b.dir, devicePath(b.service.deviceId));
  await writeFile(ownFile, "\uFEFF" + await readFile(ownFile, "utf8"));
  b.cfg.deviceName = "Cloud renamed";
  await b.sync({ register: true });
  assert.equal(JSON.parse(await readFile(ownFile)).name, "Cloud renamed");
});

test("real device-record edits, duplicate or unknown fields, and invalid bytes are preserved and identified", async t => {
  const { a, bare } = await workingCopies(t);
  await a.sync({ register: true });
  const name = devicePath(a.service.deviceId), file = path.join(a.dir, name);
  const original = await readFile(file, "utf8"), record = JSON.parse(original);
  const originalHead = (await runGit(bare, ["rev-parse", "main"])).stdout;
  for (const [bytes, detail] of [
    [JSON.stringify({ ...record, active: false }), /active/],
    [JSON.stringify({ ...record, name: "Private company title" }), /name/],
    [JSON.stringify({ id: record.id, name: record.name }), /active|필드/],
    [original.replace('"active":true', '"active":false,"active":true'), /형식|중복/],
    [JSON.stringify({ ...record, extra: "Private company title" }), /형식|필드/],
    [Buffer.concat([Buffer.from([0xff]), Buffer.from(original)]), /형식|UTF-8/],
  ]) {
    await writeFile(file, bytes);
    await assert.rejects(a.sync(), error => {
      assert.equal(error.syncReason, "managed-record");
      assert.match(error.message, detail);
      assert(!error.message.includes("Private company title"));
      return true;
    });
    assert.deepEqual(await readFile(file), Buffer.from(bytes));
    assert.equal((await runGit(bare, ["rev-parse", "main"])).stdout, originalHead);
  }
});

test("changed device file modes and types are preserved even when Git ignores executable bits", { skip: process.platform === "win32" }, async t => {
  const { a } = await workingCopies(t);
  await a.sync({ register: true });
  const name = devicePath(a.service.deviceId), file = path.join(a.dir, name);
  const original = await readFile(file);
  await runGit(a.dir, ["config", "core.filemode", "false"]);
  await chmod(file, 0o654);
  await assert.rejects(a.sync(), /권한/);
  assert.equal((await lstat(file)).mode & 0o777, 0o654);
  const target = path.join(a.dir, "reference");
  await writeFile(target, original);
  await rm(file);
  await symlink(target, file);
  await assert.rejects(a.sync(), error => error.syncReason === "managed-record" && /종류|링크/.test(error.message));
  assert((await lstat(file)).isSymbolicLink());
  assert.deepEqual(await readFile(target), original);
});

test("personal merge preserves all variants, includes independent notes, and protects selection when a later PC edits the published value", async (t) => {
  const { root, store, config, cloud, local, late, checkpoint } = await fixture(t);
  const file = "회의록.md";
  const base = await checkpoint(null, cloud, { [file]: "1시\n", "자료.zip": Buffer.from([0, 1]) });
  const a = await checkpoint(base, cloud, { [file]: "2시\n", "자료.zip": Buffer.from([0, 2]) });
  const b = await checkpoint(base, local, { [file]: "3시\n", "자료.zip": Buffer.from([0, 3]), "독립.md": "전달" });
  await writeFile(path.join(root, "unrelated.md"), "user draft");
  const merged = await integrate(store, a, b, local, config),
    files = await store.tree(merged);
  const state = await store.metadata(files);
  assert.deepEqual(state.groups.get(file).pending, [a, b].sort());
  assert.equal((await store.blob(files.get(file).oid)).toString(), "2시\n");
  assert.equal((await store.blob(files.get("독립.md").oid)).toString(), "전달");
  assert.equal(state.groups.get("자료.zip").pending.length, 2);
  const c = await checkpoint(a, late, { [file]: "4시\n" });
  const withLate = await integrate(store, merged, c, late, config);
  let latest = await store.tree(withLate);
  assert.equal((await store.blob(latest.get(file).oid)).toString(), "2시\n");
  const all = (await store.metadata(latest)).groups.get(file);
  assert.deepEqual(all.pending, [a, b, c].sort());
  assert.equal(all.versions.get(b).device, "Local PC");
  await assert.rejects(
    chooseVersion(store, withLate, file, state.groups.get(file).pending, b, local, config),
    /새 버전/
  );
  const choice = await chooseVersion(store, withLate, file, all.pending, b, local, config);
  latest = await store.tree(choice);
  assert.equal((await store.blob(latest.get(file).oid)).toString(), "3시\n");
  assert.deepEqual((await store.metadata(latest)).groups.get(file).pending, []);
  assert(latest.has(conflictFolder(file) + all.versions.get(c).blob + ".blob"));
  assert.equal(await integrate(store, choice, c, late, config), choice);
  assert.equal((await store.git(["ls-files", "--cached"])).stdout, "");
});

test("personal sync path validation separates ZIP and built-in metadata from unrelated files", async (t) => {
  const { store } = await fixture(t);
  const blob = await store.storeBytes(Buffer.from("bytes"));
  assert.deepEqual([...checkTreeChanges(new Map(), new Map([["한글.Zip", blob]]))], ["한글.Zip"]);
  for (const name of ["~$잠김.zip", ".dynote-sync/private.txt", "../private.md", ".git/config", ".secrets"])
    assert.throws(() => checkTreeChanges(new Map(), new Map([[name, blob]])));
  assert.throws(
    () =>
      checkTreeChanges(
        new Map(),
        new Map([
          ["a/b.md", blob],
          ["A/c.md", blob],
        ])
      ),
    /경로/
  );
});

test("each conflicting Markdown hunk can be chosen independently while clean edits are retained", async (t) => {
  const { store, config, cloud, local, checkpoint } = await fixture(t);
  const path = "meeting.md",
    base = await checkpoint(null, cloud, { [path]: "first\nx\na\nb\nc\ny\nlast\nspacer\nend\n" });
  const a = await checkpoint(base, cloud, { [path]: "CLOUD INTRO\nx2\na\nb\nc\ny2\nlast\nspacer\nCLOUD END\n" });
  const b = await checkpoint(base, local, { [path]: "first\nx3\na\nb\nc\ny3\nLOCAL END\nspacer\nend\n" });
  const head = await integrate(store, a, b, local, config),
    files = await store.tree(head);
  const group = (await store.metadata(files)).groups.get(path);
  const parts = await textChoices(store, path, [...group.versions.values()]);
  for (const [side, ref] of [["original", base], [a, a], [b, b]]) {
    const document = parts.map(part => typeof part === "string" ? part : part.alternatives[side] ?? part.original).join("");
    assert.equal(document, (await store.blob((await store.tree(ref)).get(path).oid)).toString());
  }
  const final = await chooseVersion(store, head, path, group.pending, b, local, config, { hunks: [a, b] });
  const blob = (await store.tree(final)).get(path);
  assert.equal((await store.blob(blob.oid)).toString(), "CLOUD INTRO\nx2\na\nb\nc\ny3\nLOCAL END\nspacer\nCLOUD END\n");
  const original = await chooseVersion(store, head, path, group.pending, b, local, config, { hunks: ["original", b] });
  const mixed = (await store.tree(original)).get(path);
  assert.equal((await store.blob(mixed.oid)).toString(), "first\nx\na\nb\nc\ny3\nLOCAL END\nspacer\nCLOUD END\n");
});

test("simultaneous decisions survive even if one chooses the already published contents", async (t) => {
  const { store, config, cloud, local, checkpoint } = await fixture(t);
  const name = "보고.md",
    base = await checkpoint(null, cloud, { [name]: "1시" });
  const a = await checkpoint(base, cloud, { [name]: "2시" }),
    b = await checkpoint(base, local, { [name]: "3시" });
  const head = await integrate(store, a, b, local, config),
    basis = [a, b].sort();
  const ca = await chooseVersion(store, head, name, basis, a, cloud, config);
  const cb = await chooseVersion(store, head, name, basis, b, local, config);
  const merged = await integrate(store, ca, cb, cloud, config),
    state = await store.metadata(await store.tree(merged));
  assert.deepEqual(state.groups.get(name).pending, [ca, cb].sort());
  const chosen = await chooseVersion(store, merged, name, [ca, cb], ca, local, config);
  assert.equal((await store.blob((await store.tree(chosen)).get(name).oid)).toString(), "2시");
});

test("a new clone reconstructs edits published by a plain Git client while review was open", async (t) => {
  const { store, config, cloud, local, checkpoint } = await fixture(t);
  const name = "meeting.md",
    base = await checkpoint(null, cloud, { [name]: "1" });
  const a = await checkpoint(base, cloud, { [name]: "2" }),
    b = await checkpoint(base, local, { [name]: "3" });
  const review = await integrate(store, a, b, local, config);
  const four = await checkpoint(review, cloud, { [name]: "4" }),
    five = await checkpoint(four, cloud, { [name]: "5" });
  const normalized = await normalizePublished(store, five, local, config);
  const files = await store.tree(normalized),
    state = await store.metadata(files);
  assert.deepEqual(state.groups.get(name).pending, [a, b, four, five].sort());
  assert.equal((await store.blob(files.get(name).oid)).toString(), "2");
  assert.equal(await normalizePublished(store, normalized, local, config), normalized);
});

test("file, metadata and review-page limits are independent", async (t) => {
  const { root, store, local, config } = await fixture(t);
  const device = await store.storeRecord(local);
  assert.doesNotThrow(() => assertSyncEntry("limit.pdf", { ...device, size: blobLimit }));
  assert.throws(() => assertSyncEntry("limit.pdf", { ...device, size: blobLimit + 1 }), /한도/);
  assert.throws(() => assertSyncEntry(devicePath(local.id), { ...device, size: 65537 }), /한도/);
  const name = "time.md",
    entries = new Map(),
    file = await store.storeBytes(Buffer.from("2"));
  entries.set(name, file);
  entries.set(conflictFolder(name) + file.oid + ".blob", file);
  for (let n = 0; n < 51; n++) {
    const commit = n.toString(16).padStart(40, "0");
    entries.set(
      conflictFolder(name) + commit + ".json",
      await store.storeRecord({
        path: name,
        commit,
        blob: file.oid,
        author: "Writer",
        device: "PC",
        id: local.id,
        time: new Date(n * 1000).toISOString(),
      })
    );
  }
  const head = await store.commitTree(await store.writeTree(null, entries), [], "pages", local, config);
  await store.git(["update-ref", "refs/heads/main", head]);
  const service = new PersonalSync({ root }, store.run, local.id);
  await service.init();
  const first = await service.versions(name),
    second = await service.versions(name, 50);
  assert.equal(first.versions.length, 50);
  assert.equal(second.versions.length, 1);
  assert.equal(first.basis.length, 51);
});

test("Journal union keeps original blocks and manual text in place and sorts only new links", () => {
  const block = (i) =>
    "<!-- dynote:copilot " +
    i +
    " -->\n- [[Copilot Note/" +
    i +
    "/" +
    i +
    ".md|chat]]\n<!-- /dynote:copilot " +
    i +
    " -->\n";
  const id = (i) => i.repeat(20),
    base = "intro\n\n" + block(id("a")) + "\nmanual after existing block\n";
  const left = base + "\n" + block(id("c")),
    right = base + "\n" + block(id("b"));
  const merged = mergeCaptureBlocks(base, left, right);
  assert(merged.startsWith(base));
  assert(merged.indexOf(id("b")) < merged.indexOf(id("c")));
  assert.equal(mergeCaptureBlocks(base, right, left), merged);
});

for (const [name, copy, taken] of [
  ["자료.xlsx", "자료 사본.xlsx", "taken.xlsx"],
  ["File Storage/v1.0/README", "File Storage/v1.0/README copy", "File Storage/v1.0/taken"],
]) {
  test("keeping both binary versions preserves both files for " + name, async (t) => {
    const { store, config, cloud, local, checkpoint } = await fixture(t);
    const parent = await checkpoint(null, cloud, { [name]: Buffer.from([0, 9]), [taken]: "occupied" });
    const a = await checkpoint(parent, cloud, { [name]: Buffer.from([0, 2]) });
    const b = await checkpoint(parent, local, { [name]: Buffer.from([0, 3]) });
    const head = await integrate(store, a, b, local, config),
      basis = [a, b].sort();
    await assert.rejects(
      chooseVersion(store, head, name, basis, b, local, config, { copies: { [a]: taken.replace("taken", "TAKEN") } }),
      /겹치지 않는/
    );
    const result = await chooseVersion(store, head, name, basis, b, local, config, {
      copies: { [a]: copy },
    });
    const files = await store.tree(result);
    assert.deepEqual(await store.blob(files.get(name).oid), Buffer.from([0, 3]));
    assert.deepEqual(await store.blob(files.get(copy).oid), Buffer.from([0, 2]));
  });
}
