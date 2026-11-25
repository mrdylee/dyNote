import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Vault } from "../core/vault.mjs";
import { GitController } from "../electron/git-controller.mjs";

const hash = (data) => createHash("sha1").update(data).digest("hex");
const blobId = (bytes) => hash(Buffer.concat([Buffer.from("blob " + bytes.length + "\0"), bytes]));
const config = {
  mode: "github-api",
  remote: "https://github.com/example/notes.git",
  branch: "main",
  token: "test-secret",
};
const secretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString(),
};
async function fixture(t, { empty = false, staleRefAfterSeed = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blobs = new Map(),
    trees = new Map(),
    commits = new Map(),
    requests = [];
  let head, race, seedPending = false;
  function commit(files, parent) {
    const tree = hash(JSON.stringify(files)),
      sha = hash(tree + (parent || ""));
    trees.set(tree, files);
    commits.set(sha, { tree, parent });
    return sha;
  }
  head = empty ? null : commit({}, null);
  const contents = () => trees.get(commits.get(head).tree);
  async function fetcher(url, options) {
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    const route = url.replace("https://api.github.com/repos/example/notes", "");
    const method = options.method || "GET",
      body = JSON.parse(options.body || "null");
    requests.push(method + " " + route);
    const result = (value, status = 200) => Response.json(value, { status });
    if (method === "GET" && route === "/git/ref/heads/main") {
      if (seedPending) { seedPending = false; return result({}, 409); }
      return head ? result({ object: { sha: head } }) : result({}, 409);
    }
    if (route === "") return result({ default_branch: "main" });
    if (route === "/branches?per_page=1") return result(head ? [{ name: "main" }] : []);
    if (route.startsWith("/contents/") && method === "PUT") {
      if (head) return result({}, 422);
      const bytes = Buffer.from(body.content, "base64"),
        sha = blobId(bytes);
      blobs.set(sha, bytes);
      head = commit({ [decodeURIComponent(route.slice(10))]: sha }, null);
      seedPending = staleRefAfterSeed;
      return result({ commit: { sha: head } }, 201);
    }
    if (route.startsWith("/compare/")) return result({ status: "ahead" });
    if (route.startsWith("/git/commits/"))
      return result({ tree: { sha: commits.get(route.split("/").pop()).tree } });
    if (route.startsWith("/git/trees/")) {
      const key = route.split("/").pop().split("?")[0];
      return result({
        truncated: false,
        tree: Object.entries(trees.get(key)).map(([path, sha]) => ({
          path,
          sha,
          mode: "100644",
          type: "blob",
          size: blobs.get(sha).length,
        })),
      });
    }
    if (route.startsWith("/git/blobs/"))
      return result({ encoding: "base64", content: blobs.get(route.split("/").pop()).toString("base64") });
    if (route === "/git/blobs") {
      const bytes = Buffer.from(body.content, "base64"),
        sha = blobId(bytes);
      blobs.set(sha, bytes);
      return result({ sha }, 201);
    }
    if (route === "/git/trees") {
      const files = { ...trees.get(body.base_tree) };
      assert(trees.has(body.base_tree));
      for (const row of body.tree) {
        if (row.content !== undefined) {
          const bytes = Buffer.from(row.content);
          const sha = blobId(bytes);
          blobs.set(sha, bytes);
          files[row.path] = sha;
        } else if (row.sha === null) delete files[row.path];
        else files[row.path] = row.sha;
      }
      const sha = hash(JSON.stringify(files));
      trees.set(sha, files);
      return result({ sha }, 201);
    }
    if (route === "/git/commits") {
      const sha = commit(trees.get(body.tree), body.parents[0]);
      return result({ sha }, 201);
    }
    if (route === "/git/refs/heads/main") {
      assert.equal(body.force, false);
      if (race) {
        const task = race;
        race = null;
        await task();
      }
      if (commits.get(body.sha).parent !== head) return result({}, 422);
      head = body.sha;
      return result({ object: { sha: head } });
    }
    throw new Error("Unexpected " + method + " " + route);
  }
  async function pc(label) {
    const folder = path.join(dir, label);
    await mkdir(folder);
    const vault = await Vault.open(folder, path.join(dir, "recovery"));
    const settingsFile = path.join(dir, label + ".json");
    const phases = [];
    const create = () =>
      new GitController({
        settingsFile,
        fetcher,
        secretStorage,
        onStatus: (s) => phases.push(s.phase),
        isPersonal: () => true,
        setTimer: () => null,
        run: () => {
          throw new Error("local Git called");
        },
      });
    let controller = create();
    await controller.open(vault);
    t.after(() => controller.close());
    return {
      folder,
      settingsFile,
      phases,
      poll: () => controller.sync(vault.id, { automatic: true, personalOnly: true }),
      connect: (input = config) => controller.connect(vault.id, input),
      attempt: () => controller.sync(vault.id, { personalOnly: true }),
      saveDraft: (name, content, rev) =>
        controller.saveNote(name, content, rev, () => vault.save(name, content, rev)),
      note: (name) => vault.readNote(name),
      status: () => controller.status(),
      sync: async () => {
        const s = await controller.sync(vault.id, { personalOnly: true });
        assert.notEqual(s.phase, "error", s.message);
        return s;
      },
      save: (name, value) => writeFile(path.join(folder, name), value),
      read: (name) => readFile(path.join(folder, name), "utf8"),
      restart: async () => {
        controller.close();
        controller = create();
        await controller.open(vault);
        await controller.tail;
      },
    };
  }
  return { a: await pc("a"), b: await pc("b"), requests, onPublish: (fn) => (race = fn), contents };
}
test("API-only PCs exchange notes, restart with private credentials, and idle polls do not create commits", async (t) => {
  const { a, b, requests } = await fixture(t);
  await a.save("one.md", "first");
  const status = await a.connect();
  assert.equal(status.phase, "synced", status.message);
  assert(!JSON.stringify(status).includes("test-secret"));
  assert(!(await readFile(a.settingsFile, "utf8")).includes("test-secret"));
  await b.connect();
  assert.equal(await b.read("one.md"), "first");
  await b.save("one.md", "second");
  await b.sync();
  await a.restart();
  assert.equal(await a.read("one.md"), "second");
  requests.length = 0;
  await a.sync();
  assert.deepEqual(requests, ["GET /git/ref/heads/main"]);
  assert(!(await readdir(a.folder)).includes(".git"));
});
test("retry persists a received note's baseline after a settings write failure so deletion survives restart", async (t) => {
  const { a, b, contents } = await fixture(t);
  await a.connect();
  await b.connect();
  await a.save("new.md", "from the other PC");
  await a.sync();
  const backup = b.settingsFile + ".bak";
  await rename(b.settingsFile, backup);
  await mkdir(b.settingsFile);
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(await b.read("new.md"), "from the other PC");
  await rm(b.settingsFile, { recursive: true });
  await rename(backup, b.settingsFile);
  await b.sync();
  await unlink(path.join(b.folder, "new.md"));
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  assert(!Object.hasOwn(contents(), "new.md"));
});
test("concurrent writes retry without force and divergent copies survive edit/edit and edit/delete", async (t) => {
  const { a, b, onPublish } = await fixture(t);
  await a.save("note.md", "base");
  await a.connect();
  await b.connect();
  await a.save("a.md", "a");
  await b.save("b.md", "b");
  onPublish(() => a.sync());
  await b.sync();
  await a.sync();
  assert.equal(await a.read("b.md"), "b");
  assert.equal(await b.read("a.md"), "a");
  await a.save("note.md", "cloud");
  await b.save("note.md", "local");
  await a.sync();
  await b.sync();
  await a.sync();
  const copy = (await readdir(a.folder)).find((n) => n.includes("충돌"));
  assert(copy);
  assert.equal(await a.read(copy), "local");
  assert.equal(await b.read(copy), "local");
  assert.equal(await b.read("note.md"), "cloud");
  await unlink(path.join(a.folder, "note.md"));
  await a.sync();
  await b.save("note.md", "offline");
  await b.sync();
  await a.sync();
  assert(!(await readdir(b.folder)).includes("note.md"));
  const copies = (await readdir(a.folder)).filter((n) => n.includes("충돌"));
  assert.deepEqual((await Promise.all(copies.map((n) => a.read(n)))).sort(), ["local", "offline"]);
});
test("empty repository is seeded from a real note and handles nested binary paths", async (t) => {
  const { a, b } = await fixture(t, { empty: true });
  await mkdir(path.join(a.folder, "File Storage"));
  await a.save("가.md", "노트");
  const bytes = Buffer.from([0, 255, 12]);
  await a.save("File Storage/image.png", bytes);
  const result = await a.connect();
  assert.equal(result.phase, "synced", result.message);
  await b.connect();
  assert.equal(await b.read("가.md"), "노트");
  assert.deepEqual(await readFile(path.join(b.folder, "File Storage/image.png")), bytes);
});
test("the initial sync uses the confirmed seed commit while the branch lookup still reports an empty repository", async t => {
  const { a, contents } = await fixture(t, { empty: true, staleRefAfterSeed: true });
  await a.save("first.md", "first");
  await a.save("second.md", "second");
  const status = await a.connect();
  assert.equal(status.phase, "synced", status.message);
  assert.deepEqual(Object.keys(contents()).sort(), ["first.md", "second.md"]);
});

test("a removed local note colliding with a remote edit restores that edit and reports the deletion conflict", async (t) => {
  const { a, b } = await fixture(t);
  await a.save("n.md", "base");
  await a.connect();
  await b.connect();
  await a.save("n.md", "updated");
  await a.sync();
  await unlink(path.join(b.folder, "n.md"));
  const result = await b.sync();
  assert.match(result.message, /삭제/);
  assert.equal(await b.read("n.md"), "updated");
  await b.sync();
  assert(b.status().apiConflicts.some((item) => item.includes("n.md")));
});
test("replacing a synced folder with a symbolic link never publishes deletion of its children", async (t) => {
  const { a, b, contents } = await fixture(t);
  await mkdir(path.join(a.folder, "notes"));
  await a.save("notes/n.md", "mine");
  await a.connect();
  await b.connect();
  await rm(path.join(a.folder, "notes"), { recursive: true });
  await symlink(b.folder, path.join(a.folder, "notes"), process.platform === "win32" ? "junction" : "dir");
  assert.equal((await a.attempt()).phase, "error");
  assert(contents()["notes/n.md"]);
});
test("an editor saving a stale revision leaves the received note intact and its draft in a sibling file", async (t) => {
  const { a, b } = await fixture(t);
  await a.save("n.md", "base");
  await a.connect();
  await b.connect();
  const original = await b.note("n.md");
  await a.save("n.md", "remote");
  await a.sync();
  await b.sync();
  const draft = await b.saveDraft("n.md", "unsent local draft", original.revision);
  assert.equal(draft.preserved, true);
  assert.equal(await b.read("n.md"), "remote");
  await b.sync();
  await a.sync();
  const copy = (await readdir(a.folder)).find((n) => n.includes("충돌"));
  assert.equal(await a.read(copy), "unsent local draft");
});
test("uploading the only note to a brand new repository records the first successful upload", async (t) => {
  const { a } = await fixture(t, { empty: true });
  await a.save("one.md", "first");
  const result = await a.connect();
  assert.equal(result.phase, "synced");
  assert(result.lastSuccess);
});
test("an external edit during publication survives download and converges on retry", async (t) => {
  const { a, b, onPublish } = await fixture(t);
  await a.save("read.md", "old");
  await a.connect();
  await b.connect();
  await a.save("read.md", "incoming");
  await a.sync();
  await b.save("send.md", "outgoing");
  onPublish(() => b.save("read.md", "late draft"));
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(await b.read("read.md"), "late draft");
  await b.sync();
  await a.sync();
  const copy = (await readdir(a.folder)).find((n) => n.includes("충돌"));
  assert.equal(await a.read(copy), "late draft");
  assert.equal(await b.read("read.md"), "incoming");
});
test("an incomplete PDF is retained locally until copying finishes", async (t) => {
  const { a, contents } = await fixture(t);
  await a.connect();
  await a.save("file.pdf", "%PDF-partial");
  const status = await a.attempt();
  assert.notEqual(status.phase, "synced");
  assert(!contents()["file.pdf"]);
  await a.save("file.pdf", "%PDF-complete\n%%EOF\n");
  await a.sync();
  assert(contents()["file.pdf"]);
});
test("several Markdown edits use one tree and commit and an unchanged background check stays quiet", async (t) => {
  const { a, requests } = await fixture(t);
  await a.connect();
  requests.length = 0;
  await a.save("first.md", "First");
  await a.save("second.md", "Second");
  await a.sync();
  assert.equal(requests.filter((x) => x === "POST /git/blobs").length, 0);
  assert.equal(requests.filter((x) => x === "POST /git/commits").length, 1);
  a.phases.length = 0;
  await a.poll();
  assert(!a.phases.includes("saving"));
});
