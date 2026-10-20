import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Vault } from "../core/vault.mjs";
import { GitHistory } from "../core/git-history.mjs";

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-history-")), root = path.join(dir, "vault");
  await mkdir(root);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, "no-config"), GIT_CONFIG_NOSYSTEM: "1" }, stdio: ["pipe", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "History"); git("config", "user.email", "history@example.invalid");
  await writeFile(path.join(root, "한글 #.md"), "\ufeff# First\r\n");
  await writeFile(path.join(root, "image.png"), Buffer.from([0, 255, 2]));
  git("add", "."); git("commit", "-m", "First backup");
  const before = git("rev-parse", "HEAD");
  await writeFile(path.join(root, "한글 #.md"), "# Second\n");
  await unlink(path.join(root, "image.png"));
  await writeFile(path.join(root, "New.md"), "new note");
  git("add", "-A"); git("commit", "-m", "Second backup");
  const head = git("rev-parse", "HEAD"), vault = await Vault.open(root, path.join(dir, "recovery"));
  return { dir, root, git, before, head, vault, history: new GitHistory(vault) };
}

test("calendar lists current-branch commits and previews supported file changes", async () => {
  const f = await fixture(), now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const history = await f.history.list(month);
  assert.equal(history.entries.length, 2);
  assert.equal(history.entries[0].hash, f.head);
  assert.match(history.entries[0].date, new RegExp(`^${month}`));
  const preview = await f.history.preview(f.before);
  assert.deepEqual(preview.changes.map((c) => [c.path, c.kind]).sort(), [["New.md", "delete"], ["image.png", "add"], ["한글 #.md", "modify"]]);
  assert.equal(typeof preview.revision, "string");
  await assert.rejects(f.history.list("2026-99"), /월/);
  await assert.rejects(f.history.preview("--all"), /기록/);
});

test("restore preserves HEAD, unsupported files, binary bytes and a complete recovery copy", async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, "private.txt"), "leave this alone");
  await writeFile(path.join(f.root, "Draft.md"), "not committed yet");
  const preview = await f.history.preview(f.before);
  const restored = await f.history.restore(f.before, preview.revision);
  assert.equal(f.git("rev-parse", "HEAD"), f.head);
  assert.equal(await readFile(path.join(f.root, "한글 #.md"), "utf8"), "\ufeff# First\r\n");
  assert.deepEqual(await readFile(path.join(f.root, "image.png")), Buffer.from([0, 255, 2]));
  await assert.rejects(readFile(path.join(f.root, "New.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(f.root, "private.txt"), "utf8"), "leave this alone");
  assert.equal(await readFile(path.join(restored.recoveryPath, "files", "New.md"), "utf8"), "new note");
  assert.equal(await readFile(path.join(restored.recoveryPath, "files", "한글 #.md"), "utf8"), "# Second\n");
  await assert.rejects(readFile(path.join(f.root, "Draft.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(restored.recoveryPath, "files", "Draft.md"), "utf8"), "not committed yet");
  assert.equal(restored.snapshot.notes.length, 1);
});

test("stale previews and manually staged work cannot be restored over", async () => {
  const f = await fixture(), preview = await f.history.preview(f.before);
  await writeFile(path.join(f.root, "New.md"), "external edit");
  await assert.rejects(f.history.restore(f.before, preview.revision), /변경/);
  assert.equal(await readFile(path.join(f.root, "New.md"), "utf8"), "external edit");
  const refreshed = await f.history.preview(f.before);
  f.git("add", "New.md");
  await assert.rejects(f.history.restore(f.before, refreshed.revision), /스테이징/);
  assert.equal(f.git("diff", "--cached", "--name-only"), "New.md");
});

test("restore rejects symlink targets and commits outside the current history", async () => {
  const f = await fixture();
  await writeFile(path.join(f.dir, "outside.md"), "outside");
  await unlink(path.join(f.root, "한글 #.md"));
  await symlink(path.join(f.dir, "outside.md"), path.join(f.root, "한글 #.md"));
  await assert.rejects(f.history.preview(f.before), /링크/);
  assert.equal(await readFile(path.join(f.dir, "outside.md"), "utf8"), "outside");
  f.git("checkout", "--orphan", "unrelated");
  f.git("rm", "-rf", ".");
  await writeFile(path.join(f.root, "Other.md"), "other");
  f.git("add", "."); f.git("commit", "-m", "Unrelated");
  const foreign = f.git("rev-parse", "HEAD"); f.git("checkout", "main");
  await assert.rejects(f.history.preview(foreign), /이력/);
});

test("restoration refuses case-only path collisions without removing current files", async () => {
  const f = await fixture(), before = await f.vault.captureFiles();
  const files = before.files.map((file) => file.path === "New.md" ? { ...file, path: "new.md" } : file);
  await assert.rejects(f.vault.applySnapshot(files, before.revision), /대소문자|중복/);
  assert.equal(await readFile(path.join(f.root, "New.md"), "utf8"), "new note");
});

test("a write failure rolls back applied changes and retains a recovery copy", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const { chmod, readdir } = await import("node:fs/promises");
  const f = await fixture(), before = await f.vault.captureFiles();
  const locked = path.join(f.root, "locked"); await mkdir(locked); await chmod(locked, 0o500);
  try {
    const files = [...await f.history.files(f.before), { path: "locked/Blocked.md", bytes: Buffer.from("blocked") }];
    await assert.rejects(f.vault.applySnapshot(files, before.revision), /복구 사본/);
    assert.equal((await f.vault.captureFiles()).revision, before.revision);
    assert.equal((await readdir(path.join(f.vault.recoveryRoot, "git-restore"))).length, 1);
    assert.equal(f.git("rev-parse", "HEAD"), f.head);
  } finally { await chmod(locked, 0o700); }
});


test("an empty backup removes supported files only after preserving a recovery snapshot", async () => {
  const f = await fixture();
  f.git("rm", "-rf", "."); f.git("commit", "-m", "Empty backup");
  const empty = f.git("rev-parse", "HEAD");
  await writeFile(path.join(f.root, "Draft.md"), "preserve before removal");
  const preview = await f.history.preview(empty);
  assert.deepEqual(preview.changes, [{ path: "Draft.md", kind: "delete" }]);
  const result = await f.history.restore(empty, preview.revision);
  assert.equal(result.snapshot.notes.length, 0);
  assert.equal(await readFile(path.join(result.recoveryPath, "files", "Draft.md"), "utf8"), "preserve before removal");
  assert.equal(f.git("rev-parse", "HEAD"), empty);
});
