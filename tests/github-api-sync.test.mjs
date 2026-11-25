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
async function fixture(t, { empty = false, staleRefAfterSeed = false, branch = "main", loginApi, controllerOptions = {}, requestHook, commitPageSize = 100 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blobs = new Map(),
    trees = new Map(),
    commits = new Map(),
    requests = [];
  let head, race, seedPending = false;
  function commit(files, parent, message) {
    const tree = hash(JSON.stringify(files)),
      sha = hash(tree + (parent || ""));
    trees.set(tree, files);
    commits.set(sha, { tree, parent, message });
    return sha;
  }
  head = empty ? null : commit({}, null);
  const contents = () => trees.get(commits.get(head).tree);
  async function fetcher(url, options) {
    const loginResponse = loginApi?.(url, options);
    if (loginResponse) return Response.json(loginResponse);
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    const route = url.replace("https://api.github.com/repos/example/notes", "");
    const method = options.method || "GET",
      body = JSON.parse(options.body || "null");
    requests.push(method + " " + route);
    const result = (value, status = 200) => Response.json(value, { status });
    if (method === "GET" && route === "/git/ref/heads/" + branch) {
      if (seedPending) { seedPending = false; return result({}, 409); }
      return head ? result({ object: { sha: head } }) : result({}, 409);
    }
    if (route === "") return result({ default_branch: branch });
    if (route === "/branches?per_page=1") return result(head ? [{ name: "main" }] : []);
    if (route.startsWith("/contents/") && method === "PUT") {
      if (head) return result({}, 422);
      const bytes = Buffer.from(body.content, "base64"),
        sha = blobId(bytes);
      blobs.set(sha, bytes);
      head = commit({ [decodeURIComponent(route.slice(10))]: sha }, null, body.message);
      seedPending = staleRefAfterSeed;
      return result({ commit: { sha: head } }, 201);
    }
    if (route.startsWith("/compare/")) {
      const [ancestor, current] = route.slice("/compare/".length).split("...");
      for (let sha = current; sha; sha = commits.get(sha)?.parent)
        if (sha === ancestor) return result({ status: sha === current ? "identical" : "ahead" });
      return result({ status: "diverged" });
    }
    if (route.startsWith("/commits?")) {
      const query = new URL(url).searchParams, name = query.get("path");
      const rows = [];
      for (let sha = query.get("sha"); sha; sha = commits.get(sha).parent) {
        const item = commits.get(sha);
        const before = item.parent && trees.get(commits.get(item.parent).tree)[name];
        if (trees.get(item.tree)[name] !== before) rows.push({ sha, commit: { message: item.message } });
      }
      const page = Number(query.get("page") || 1);
      const perPage = Math.min(commitPageSize, Number(query.get("per_page") || 30));
      const pages = Math.ceil(rows.length / perPage), links = [];
      const link = (number, rel) => {
        const address = new URL(url);
        address.searchParams.set("page", number);
        return '<' + address + '>; rel="' + rel + '"';
      };
      if (page < pages) links.push(link(page + 1, "next"));
      if (page === 1 && pages > 1) links.push(link(pages, "last"));
      return Response.json(rows.slice((page - 1) * perPage, page * perPage), { headers: { link: links.join(", ") } });
    }
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
      const sha = commit(trees.get(body.tree), body.parents[0], body.message);
      return result({ sha }, 201);
    }
    if (route === "/git/refs/heads/" + branch) {
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
        ...controllerOptions,
        settingsFile,
        fetcher: requestHook ? (url, options) => requestHook(url, options, () => fetcher(url, options)) : fetcher,
        secretStorage: controllerOptions.secretStorage ?? secretStorage,
        onStatus: (s) => phases.push(s.phase),
        isPersonal: () => true,
        setTimer: controllerOptions.setTimer ?? (() => null),
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
      recoveryRoot: vault.recoveryRoot,
      phases,
      markDirty: () => controller.markDirty(vault.id),
      poll: () => controller.sync(vault.id, { automatic: true, personalOnly: true }),
      connect: (input = config) => controller.connect(vault.id, input),
      login: (action, sessionId) => controller.githubAuth(vault.id, {action, sessionId}),
      disconnect: () => controller.disconnect(vault.id),
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
  return { a: await pc("a"), b: await pc("b"), pc, fetcher, requests, onPublish: (fn) => (race = fn), contents };
}
test("edits saved while a REST upload is in flight stay pending until their bytes reach the other PC", async t => {
  const {a, b, onPublish, contents} = await fixture(t);
  await a.connect();
  await b.connect();
  await a.save("first.md", "first save");
  onPublish(async () => {
    await a.save("later.md", "saved during the upload");
    a.markDirty();
  });
  const first = await a.sync();
  assert(!Object.hasOwn(contents(), "later.md"));
  assert.equal(first.phase, "pending", first.message);
  assert.equal((await a.sync()).phase, "synced");
  await b.sync();
  assert.equal(await b.read("later.md"), "saved during the upload");
});

test("saving identical bytes during an upload finishes synced without another commit", async t => {
  const {a, onPublish, requests} = await fixture(t);
  await a.connect();
  await a.save("unchanged.md", "same bytes");
  onPublish(async () => {
    await a.save("unchanged.md", "same bytes");
    a.markDirty();
  });
  assert.equal((await a.sync()).phase, "synced");
  await a.poll();
  assert.equal(requests.filter(request => request.startsWith("PATCH ")).length, 1);
});

test("a disconnect that cannot save settings leaves the connection usable until a successful retry", async t => {
  const timers = new Set();
  const {a, b, requests} = await fixture(t, {controllerOptions:{
    setTimer(callback) { timers.add(callback); return callback; },
    clearTimer(callback) { timers.delete(callback); },
  }});
  await a.connect();
  const [aTimer] = timers;
  await b.connect();
  const copy = a.settingsFile + ".bak";
  await rename(a.settingsFile, copy);
  await mkdir(a.settingsFile);
  await assert.rejects(a.disconnect(), /연결 해제를 저장하지 못했습니다/);
  await rm(a.settingsFile, {recursive:true});
  await rename(copy, a.settingsFile);
  assert.equal(a.status().enabled, true);
  assert(timers.has(aTimer));
  await a.save("before-disconnect.md", "still connected");
  await aTimer();
  assert.equal(a.status().phase, "synced");
  await b.sync();
  assert.equal(await b.read("before-disconnect.md"), "still connected");
  await a.disconnect();
  assert(!timers.has(aTimer));
  await a.save("after-disconnect.md", "only on this PC");
  const previousRequests = requests.length;
  await a.restart();
  assert.equal((await a.poll()).enabled, false);
  assert.equal(requests.length, previousRequests);
});

test("rejecting a replacement repository preserves the original connection across restart", async t => {
  const {a, b, requests} = await fixture(t, {controllerOptions: {checkRemote(remote) {
    if (remote !== config.remote) throw new Error("This repository is not allowed here");
  }}});
  await a.connect();
  await b.connect();
  const saved = await readFile(a.settingsFile, "utf8");
  const previousRequests = requests.length;
  await assert.rejects(a.connect({...config, remote:"https://github.com/example/other.git"}), /not allowed/);
  assert.equal(requests.length, previousRequests);
  assert.equal(await readFile(a.settingsFile, "utf8"), saved);
  await a.restart();
  await a.save("same-repo.md", "original destination");
  await a.sync();
  await b.sync();
  assert.equal(await b.read("same-repo.md"), "original destination");
});

test("overlapping manual syncs and a background poll publish a change just once", async t => {
  const {a, b, requests} = await fixture(t);
  await a.connect();
  await b.connect();
  await a.save("double-click.md", "one commit");
  const statuses = await Promise.all([a.attempt(), a.attempt(), a.poll()]);
  assert.deepEqual(statuses.map(status => status.phase), ["synced", "synced", "synced"]);
  assert.equal(requests.filter(request => request === "PATCH /git/refs/heads/main").length, 1);
  await b.sync();
  assert.equal(await b.read("double-click.md"), "one commit");
});

for (const statusCode of [403, 429]) {
  test(`a rejected branch update (HTTP ${statusCode}) keeps local work for a manual retry`, async t => {
    let blocked = false, calls = 0;
    const {a, b, contents} = await fixture(t, {
      requestHook(url, options, next) {
        calls++;
        if (blocked && options.method === "PATCH") return Response.json({}, {status:statusCode});
        return next();
      },
    });
    await a.connect();
    await b.connect();
    await a.save("queued.md", "my saved edit");
    blocked = true;
    assert.equal((await a.attempt()).phase, "error");
    assert(!Object.hasOwn(contents(), "queued.md"));
    const atFailure = calls;
    await a.poll();
    assert.equal(calls, atFailure);
    assert.equal(await a.read("queued.md"), "my saved edit");
    blocked = false;
    await a.sync();
    await b.sync();
    assert.equal(await b.read("queued.md"), "my saved edit");
  });
}

test("a truncated remote file listing cannot publish a local change or remove a local note", async t => {
  let truncated = false;
  const {a, b, contents} = await fixture(t, {requestHook(url, options, next) {
    if (truncated && new URL(url).pathname.includes("/git/trees/")) return Response.json({truncated:true, tree:[]});
    return next();
  }});
  await a.save("kept.md", "original");
  await a.connect();
  await b.connect();
  await b.save("incoming.md", "new remote file");
  await b.sync();
  const remoteBefore = {...contents()};
  await a.save("queued.md", "new local file");
  truncated = true;
  assert.equal((await a.attempt()).phase, "error");
  assert.deepEqual(contents(), remoteBefore);
  assert.equal(await a.read("kept.md"), "original");
  assert.equal(await a.read("queued.md"), "new local file");
  truncated = false;
  await a.sync();
  await b.sync();
  assert.equal(await a.read("incoming.md"), "new remote file");
  assert.equal(await b.read("queued.md"), "new local file");
});

test("a damaged incoming blob leaves the local file intact until the download is retried", async t => {
  let damaged = false;
  const {a, b} = await fixture(t, {requestHook(url, options, next) {
    if (damaged && new URL(url).pathname.includes("/git/blobs/"))
      return Response.json({encoding:"base64", content:Buffer.from("partial").toString("base64")});
    return next();
  }});
  await a.save("incoming.md", "old bytes");
  await a.connect();
  await b.connect();
  await b.save("incoming.md", "complete update");
  await b.sync();
  damaged = true;
  assert.equal((await a.attempt()).phase, "error");
  assert.equal(await a.read("incoming.md"), "old bytes");
  damaged = false;
  assert.equal((await a.sync()).phase, "synced");
  assert.equal(await a.read("incoming.md"), "complete update");
});

test("a batch crossing the inline size limit makes one commit and the next receive downloads only the edited note", async t => {
  const {a, b, requests} = await fixture(t);
  await a.connect();
  await b.connect();
  const large = "메모\r\n".repeat(131072);
  assert.equal(Buffer.byteLength(large), 1024 * 1024);
  await a.save("large.md", large);
  await a.save("small.md", "두 번째\r\n");
  requests.length = 0;
  await a.sync();
  assert.equal(requests.filter(r => r === "POST /git/blobs").length, 1);
  assert.equal(requests.filter(r => r === "POST /git/commits").length, 1);
  await b.sync();
  assert.equal(await b.read("large.md"), large);
  assert.equal(await b.read("small.md"), "두 번째\r\n");
  await b.save("small.md", "수정\r\n");
  await b.sync();
  requests.length = 0;
  await a.sync();
  assert.deepEqual(requests.filter(r => r.startsWith("GET /git/blobs/")), ["GET /git/blobs/" + blobId(Buffer.from("수정\r\n"))]);
  assert.equal(await a.read("small.md"), "수정\r\n");
});

test("a locked OS credential store stops setup before any HTTP request and works after unlocking", async t => {
  let unlocked = false, calls = 0;
  const {a, b} = await fixture(t, {
    controllerOptions:{secretStorage:{...secretStorage, isEncryptionAvailable:() => unlocked}},
    requestHook(url, options, next) { calls++; return next(); },
  });
  await a.save("waiting.md", "written while locked");
  await assert.rejects(a.login("start"), /보안 자격 증명 저장소/);
  await assert.rejects(a.connect(), /보안 자격 증명 저장소/);
  assert.equal(calls, 0);
  assert.equal(a.status().enabled, false);
  unlocked = true;
  await a.connect();
  await b.connect();
  assert.equal(await b.read("waiting.md"), "written while locked");
});

test("a diverged branch history stops sync before an offline edit or remote file is replaced", async t => {
  let diverged = false;
  const {a, b, contents, requests} = await fixture(t, {requestHook(url, options, next) {
    if (diverged && new URL(url).pathname.includes("/compare/")) return Response.json({status:"diverged"});
    return next();
  }});
  await a.save("offline.md", "base");
  await a.connect();
  await b.connect();
  await b.save("other.md", "other history");
  await b.sync();
  await a.save("offline.md", "unsent");
  const remoteBefore = {...contents()};
  requests.length = 0;
  diverged = true;
  const result = await a.attempt();
  assert.equal(result.phase, "error");
  assert.match(result.message, /이력이 변경/);
  assert.equal(await a.read("offline.md"), "unsent");
  assert.deepEqual(contents(), remoteBefore);
  assert(!requests.some(r => /^(PATCH|POST|PUT) /.test(r)));
});

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
test("new ordinary personal folders offer GitHub login first and existing Git folders keep their Git setup", async t => {
  const {a} = await fixture(t);
  assert.equal(a.status().suggestedMode,"github-api");
  await mkdir(path.join(a.folder,".git"));
  await a.restart();
  assert.equal(a.status().suggestedMode,"personal-sync");
});
async function browserFixture(t, options = {}) {
  let time = Date.now(), refreshes = 0;
  const repo = {id:7, full_name:"example/notes", default_branch:"trunk", permissions:{push:true}, private:true};
  const setup = await fixture(t, {branch:repo.default_branch, ...options,
    controllerOptions:{...options.controllerOptions, now:()=>new Date(time), openExternal:async()=>{}},
    loginApi:(url, options) => {
      const route = new URL(url).pathname;
      if (route === "/apps/dynote-note-sync") return {client_id:"example-client",slug:"dynote-note-sync",owner:{id:131228699}};
      if (route === "/login/device/code") return {device_code:"device",user_code:"ABCD-EFGH",interval:1,expires_in:900,verification_uri:"https://github.com/login/device"};
      if (route === "/login/oauth/access_token") {
        if (options.body.get("grant_type")==="refresh_token") refreshes++;
        return {access_token:"test-secret",refresh_token:"private-rotation-"+refreshes,expires_in:3600,token_type:"bearer"};
      }
      if (route === "/user/installations") return {total_count:1,installations:[{id:8,permissions:{contents:"write"}}]};
      if (route === "/user/installations/8/repositories") return {total_count:1,repositories:[repo]};
      if (route === "/repos/example/notes") return repo;
    },
  });
  return {...setup, expire:() => { time += 3600000; }, refreshes:() => refreshes,
    async authorize(pc) {
      const device = await pc.login("start");
      time += device.waitMs;
      await pc.login("poll", device.id);
      await pc.login("repositories", device.id);
      return {mode:"github-api", sessionId:device.id, repositoryId:repo.id};
    },
  };
}

test("cancelling login while GitHub verifies the branch never saves a connection or uploads a note", async t => {
  const checkingBranch = Promise.withResolvers(), continueCheck = Promise.withResolvers();
  const {a, authorize, requests} = await browserFixture(t, {
    async requestHook(url, options, next) {
      if (new URL(url).pathname.endsWith("/git/ref/heads/trunk")) {
        checkingBranch.resolve();
        await continueCheck.promise;
      }
      return next();
    },
  });
  await a.save("private-draft.md", "local draft");
  const selected = await authorize(a);
  const connecting = a.connect(selected);
  await checkingBranch.promise;
  await a.login("cancel", selected.sessionId);
  continueCheck.resolve();
  await assert.rejects(connecting, /로그인/);
  assert.equal(a.status().enabled, false);
  assert(!requests.some(request => /^(PATCH|POST|PUT) /.test(request)));
  await a.restart();
  assert.equal(a.status().enabled, false);
  assert.equal(await a.read("private-draft.md"), "local draft");
});

test("browser reauthorization keeps the custom branch already used with a personal token", async t => {
  const {a, b, authorize, requests} = await browserFixture(t, {branch:"notes-v2"});
  await a.connect({...config, branch:"notes-v2"});
  await a.save("custom.md", "custom branch");
  const connected = await a.connect(await authorize(a));
  assert.equal(connected.config.branch, "notes-v2");
  assert.equal(connected.phase, "synced", connected.message);
  await a.restart();
  assert.equal(a.status().config.branch, "notes-v2");
  await b.connect({...config, branch:"notes-v2"});
  assert.equal(await b.read("custom.md"), "custom branch");
  assert(!requests.some(request => request.endsWith("/heads/trunk")));
});

test("retrying a failed write of rotated credentials reuses the new grant and survives restart", async t => {
  const {a, b, authorize, expire, refreshes} = await browserFixture(t);
  await a.connect(await authorize(a));
  await b.connect({...config, branch:"trunk"});
  expire();
  const copy = a.settingsFile + ".bak";
  await rename(a.settingsFile, copy);
  await mkdir(a.settingsFile);
  assert.equal((await a.attempt()).phase, "error");
  assert.equal(refreshes(), 1);
  await rm(a.settingsFile, {recursive:true});
  await rename(copy, a.settingsFile);
  await a.save("retry.md", "queued offline");
  await a.sync();
  await a.restart();
  assert.equal(a.status().phase, "synced");
  assert.equal(refreshes(), 1);
  await b.sync();
  assert.equal(await b.read("retry.md"), "queued offline");
});

test("browser selection connects a vault using the repository default, persists refreshed credentials, and disconnects", async (t) => {
  const destinations = [];
  const {a, requests, authorize, expire, refreshes} = await browserFixture(t, {
    controllerOptions: {checkRemote:remote=>destinations.push(remote)},
  });
  await a.save("hello.md","first via login");
  const status = await a.connect({...await authorize(a),branch:"ignored",remote:"https://github.com/unselected/other"});
  assert.equal(status.phase,"synced",status.message);
  assert.equal(status.config.branch,"trunk");
  assert.deepEqual(destinations,[config.remote]);
  assert(requests.includes("PATCH /git/refs/heads/trunk"));
  assert(!JSON.stringify(status).match(/test-secret|private-rotation/));
  expire();
  await a.restart();
  assert.equal(a.status().phase,"synced",a.status().message);
  assert.equal(refreshes(),1);
  const stored = Object.values(JSON.parse(await readFile(a.settingsFile,"utf8")))[0];
  assert(!JSON.stringify(stored).match(/test-secret|private-rotation/));
  assert(stored.encryptedLogin);
  await a.disconnect();
  assert(!Object.values(JSON.parse(await readFile(a.settingsFile,"utf8")))[0].encryptedLogin);
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

test("an accepted update with a lost response retains both drafts and an occupied conflict filename on retry", async (t) => {
  let loseResponse = false;
  const { a, b, requests, contents } = await fixture(t, {
    requestHook: async (url, options, next) => {
      const response = await next();
      if (loseResponse && options.method === "PATCH") {
        loseResponse = false;
        throw new Error("Connection closed after updating the reference");
      }
      return response;
    },
  });
  const draft = "보내지 못한 초안\n";
  const prefix = "note (충돌 " + blobId(Buffer.from(draft)).slice(0, 10);
  const occupied = prefix + ").md", copy = prefix + "-2).md";
  await a.save("note.md", "base");
  await a.save(occupied, "my existing note");
  await a.connect();
  await b.connect();
  await a.save("note.md", "server edit");
  await a.sync();
  await b.save("note.md", draft);
  requests.length = 0;
  loseResponse = true;
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(await b.read("note.md"), draft);
  assert.equal(contents()[copy], blobId(Buffer.from(draft)));
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  await a.sync();
  for (const device of [a, b]) {
    assert.equal(await device.read("note.md"), "server edit");
    assert.equal(await device.read(occupied), "my existing note");
    assert.equal(await device.read(copy), draft);
  }
  assert.deepEqual(Object.keys(contents()).sort(), [occupied, copy, "note.md"].sort());
  assert.equal(requests.filter(request => request === "POST /git/commits").length, 1);
});

test("a restart keeps a deletion and an edit made after receiving files but before the settings write succeeded", async (t) => {
  const { a, b, contents, requests } = await fixture(t);
  await a.save("edit.md", "base");
  await a.connect();
  await b.connect();
  await a.save("edit.md", "A's update");
  await a.save("remove.md", "A's new note");
  await a.sync();
  const backup = b.settingsFile + ".bak";
  await rename(b.settingsFile, backup);
  await mkdir(b.settingsFile);
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(await b.read("edit.md"), "A's update");
  assert.equal(await b.read("remove.md"), "A's new note");
  await b.save("edit.md", "B's revision of A's update");
  await unlink(path.join(b.folder, "remove.md"));
  await rm(b.settingsFile, { recursive: true });
  await rename(backup, b.settingsFile);
  requests.length = 0;
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  await a.sync();
  for (const device of [a, b]) {
    assert.deepEqual(await readdir(device.folder), ["edit.md"]);
    assert.equal(await device.read("edit.md"), "B's revision of A's update");
  }
  assert.deepEqual(contents(), { "edit.md": blobId(Buffer.from("B's revision of A's update")) });
  await b.sync();
  await a.sync();
  assert.equal(requests.filter(request => request === "POST /git/commits").length, 1);
});

test("three PCs converge after racing and offline changes to shared notes, separate notes and a binary file", async (t) => {
  const { a, b, pc, contents, onPublish, requests } = await fixture(t);
  const c = await pc("c");
  const devices = [a, b, c];
  await a.save("journal.md", "base");
  await a.save("retired.md", "removed by B");
  await a.save("picture.png", Buffer.from([0, 255, 1]));
  for (const device of devices) await device.connect();

  await a.save("journal.md", "A's journal");
  await a.save("A.md", "alpha");
  await b.save("journal.md", "B's journal");
  await b.save("B.md", "bravo");
  await unlink(path.join(b.folder, "retired.md"));
  const picture = Buffer.from([255, 0, 127, 11]);
  await c.save("journal.md", "C's journal");
  await c.save("C.md", "charlie");
  await c.save("picture.png", picture);
  onPublish(() => a.sync());
  await b.sync();
  await c.sync();
  for (const device of devices) await device.sync();

  const expected = new Map([
    ["journal.md", "A's journal"], ["A.md", "alpha"], ["B.md", "bravo"], ["C.md", "charlie"],
    ["picture.png", picture],
  ]);
  for (const text of ["B's journal", "C's journal"]) {
    const suffix = blobId(Buffer.from(text)).slice(0, 10);
    expected.set("journal (충돌 " + suffix + ").md", text);
  }
  const paths = [...expected.keys()].sort();
  assert.deepEqual(Object.keys(contents()).sort(), paths);
  for (const device of devices) {
    assert.deepEqual((await readdir(device.folder)).sort(), paths);
    for (const [name, value] of expected)
      assert.deepEqual(await readFile(path.join(device.folder, name)), Buffer.from(value));
  }
  requests.length = 0;
  for (const device of devices) await device.sync();
  assert.deepEqual(requests, devices.map(() => "GET /git/ref/heads/main"));
});

test("deleting and editing published notes after a settings failure survives restart without another conflict", async (t) => {
  const { a, b, contents, requests } = await fixture(t);
  await a.save("tracked.md", "base");
  await a.connect();
  await b.connect();
  await b.save("tracked.md", "first local edit");
  await b.save("outgoing.md", "new upload");
  const backup = b.settingsFile + ".bak";
  await rename(b.settingsFile, backup);
  await mkdir(b.settingsFile);
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(contents()["outgoing.md"], blobId(Buffer.from("new upload")));
  await b.save("tracked.md", "second local edit");
  await unlink(path.join(b.folder, "outgoing.md"));
  await rm(b.settingsFile, { recursive: true });
  await rename(backup, b.settingsFile);
  requests.length = 0;
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  await a.sync();
  for (const device of [a, b]) {
    assert.deepEqual(await readdir(device.folder), ["tracked.md"]);
    assert.equal(await device.read("tracked.md"), "second local edit");
  }
  assert.equal(requests.filter(request => request === "POST /git/commits").length, 1);
});

test("an interrupted download acknowledges the published file and keeps the unread remote edit in conflict", async (t) => {
  let offline = false;
  const { a, b, contents } = await fixture(t, {
    requestHook: (url, options, next) => {
      if (offline && url.includes("/git/blobs/")) throw new Error("Connection dropped during download");
      return next();
    },
  });
  await a.save("shared.md", "base");
  await a.connect();
  await b.connect();
  await a.save("shared.md", "A's update");
  await a.sync();
  await b.save("outgoing.md", "new upload");
  offline = true;
  assert.equal((await b.attempt()).phase, "error");
  assert.equal(await b.read("shared.md"), "base");
  assert.equal(contents()["outgoing.md"], blobId(Buffer.from("new upload")));
  await b.save("shared.md", "B's independent edit");
  await unlink(path.join(b.folder, "outgoing.md"));
  offline = false;
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  await a.sync();
  const copy = "shared (충돌 " + blobId(Buffer.from("B's independent edit")).slice(0, 10) + ").md";
  for (const device of [a, b]) {
    assert.deepEqual((await readdir(device.folder)).sort(), ["shared.md", copy].sort());
    assert.equal(await device.read("shared.md"), "A's update");
    assert.equal(await device.read(copy), "B's independent edit");
  }
});

test("a failed recovery receipt rolls back the incoming batch before a retry", async (t) => {
  let failReceipt;
  const { a, b } = await fixture(t, {
    requestHook: async (url, options, next) => {
      const response = await next();
      if (failReceipt && url.includes("/git/blobs/")) {
        const block = failReceipt;
        failReceipt = null;
        await mkdir(block);
      }
      return response;
    },
  });
  await a.save("edit.md", "before");
  await a.connect();
  await b.connect();
  await a.save("edit.md", "after");
  await a.save("incoming.md", "new");
  await a.sync();
  const receipt = path.join(b.recoveryRoot, "github-api-receipt.json");
  await rm(receipt, { force: true });
  failReceipt = receipt;
  assert.equal((await b.attempt()).phase, "error");
  assert.deepEqual(await readdir(b.folder), ["edit.md"]);
  assert.equal(await b.read("edit.md"), "before");
  await rm(receipt, { recursive: true });
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  assert.equal(await b.read("edit.md"), "after");
  assert.equal(await b.read("incoming.md"), "new");
});

test("editing a draft again after its conflict upload but before download keeps both versions", async (t) => {
  let drop = false;
  const { a, b, contents } = await fixture(t, {
    requestHook: (url, options, next) => {
      if (drop && url.includes("/git/blobs/")) throw new Error("Interrupted before receiving the conflict copy");
      return next();
    },
  });
  await a.save("note.md", "base");
  await a.connect();
  await b.connect();
  await a.save("note.md", "A");
  await a.sync();
  await b.save("note.md", "B");
  drop = true;
  assert.equal((await b.attempt()).phase, "error");
  assert.deepEqual(await readdir(b.folder), ["note.md"]);
  await b.save("note.md", "B2");
  drop = false;
  await b.restart();
  assert.equal(b.status().phase, "synced", b.status().message);
  await a.sync();
  const expected = { "note.md": "A" };
  for (const version of ["B", "B2"])
    expected["note (충돌 " + blobId(Buffer.from(version)).slice(0, 10) + ").md"] = version;
  assert.deepEqual(Object.keys(contents()).sort(), Object.keys(expected).sort());
  for (const device of [a, b]) {
    assert.deepEqual((await readdir(device.folder)).sort(), Object.keys(expected).sort());
    for (const [name, content] of Object.entries(expected)) assert.equal(await device.read(name), content);
  }
});

test("an empty repository receipt acknowledges only its accepted seed when the remaining upload fails", async (t) => {
  let stopAfterSeed = true;
  const { a, b, contents } = await fixture(t, {
    empty: true,
    requestHook: (url, options, next) => {
      if (stopAfterSeed && options.method === "POST" && url.endsWith("/git/trees")) {
        stopAfterSeed = false;
        throw new Error("Disconnected before the remaining notes were published");
      }
      return next();
    },
  });
  const originals = { "one.md": "first draft", "two.md": "second draft" };
  for (const [name, content] of Object.entries(originals)) await a.save(name, content);
  assert.equal((await a.connect()).phase, "error");
  const [seed] = Object.keys(contents());
  assert.equal(Object.keys(contents()).length, 1);
  const pending = Object.keys(originals).find(name => name !== seed);
  await unlink(path.join(a.folder, seed));
  await b.connect();
  await b.save(pending, "independently created by B");
  await b.sync();
  await a.restart();
  assert.equal(a.status().phase, "synced", a.status().message);
  await b.sync();
  const copy = path.basename(pending, ".md") + " (충돌 " + blobId(Buffer.from(originals[pending])).slice(0, 10) + ").md";
  for (const device of [a, b]) {
    assert.deepEqual((await readdir(device.folder)).sort(), [pending, copy].sort());
    assert.equal(await device.read(pending), "independently created by B");
    assert.equal(await device.read(copy), originals[pending]);
  }
});

test("switching a vault to a new repository ignores the previous connection's unapplied settings receipt", async (t) => {
  const other = await fixture(t);
  await other.a.save("same.md", "new repository");
  await other.a.connect();
  const { a, b } = await fixture(t, {
    requestHook: (url, options, next) => url.includes("/repos/example/other")
      ? other.fetcher(url.replace("/repos/example/other", "/repos/example/notes"), options) : next(),
  });
  await a.save("same.md", "previous repository");
  await a.connect();
  await b.connect();
  const backup = b.settingsFile + ".bak";
  await rename(b.settingsFile, backup);
  await mkdir(b.settingsFile);
  await a.save("same.md", "previous repository updated");
  await a.sync();
  assert.equal((await b.attempt()).phase, "error");
  await unlink(path.join(b.folder, "same.md"));
  await rm(b.settingsFile, { recursive: true });
  await rename(backup, b.settingsFile);
  const next = await b.connect({ ...config, remote: "https://github.com/example/other.git" });
  assert.equal(next.phase, "synced", next.message);
  assert.deepEqual(next.apiConflicts, []);
  assert.equal(await b.read("same.md"), "new repository");
});

test("a newly uploaded note deleted after a lost ref response stays deleted when another PC advances the branch", async (t) => {
  let lose = true;
  const { a, b, requests, contents } = await fixture(t, {
    requestHook: async (url, options, next) => {
      const response = await next();
      if (lose && options.method === "PATCH") {
        lose = false;
        throw new Error("Connection closed after applying the ref update");
      }
      return response;
    },
  });
  await a.connect();
  await b.connect();
  await a.save("sent.md", "original upload");
  assert.equal((await a.attempt()).phase, "error");
  assert.equal(contents()["sent.md"], blobId(Buffer.from("original upload")));
  await b.save("independent.md", "B's change");
  await b.sync();
  await unlink(path.join(a.folder, "sent.md"));
  requests.length = 0;
  await a.restart();
  assert.equal(a.status().phase, "synced", a.status().message);
  await b.sync();
  for (const device of [a, b]) assert.deepEqual(await readdir(device.folder), ["independent.md"]);
  assert(!Object.hasOwn(contents(), "sent.md"));
  assert.equal(requests.filter(request => request === "POST /git/commits").length, 1);
});

test("a rejected ref update never turns a later independent remote note into an acknowledged upload", async (t) => {
  let reject = true;
  const { a, b, requests } = await fixture(t, {
    requestHook: (url, options, next) => {
      if (reject && options.method === "PATCH") {
        reject = false;
        return Response.json({ message: "protected branch" }, { status: 403 });
      }
      return next();
    },
  });
  await a.connect();
  await b.connect();
  await a.save("shared.md", "rejected upload");
  assert.equal((await a.attempt()).phase, "error");
  await unlink(path.join(a.folder, "shared.md"));
  await b.save("shared.md", "created independently by B");
  await b.sync();
  requests.length = 0;
  await a.restart();
  assert.equal(a.status().phase, "synced", a.status().message);
  assert.deepEqual(a.status().apiConflicts, []);
  assert.equal(await a.read("shared.md"), "created independently by B");
  assert(!requests.includes("POST /git/commits"));
});

for (const editSeed of [false, true]) {
  test("an accepted seed with a lost Contents response recovers a later deletion" + (editSeed ? " against an independent edit" : " after another PC adds a file"), async (t) => {
    let drop = true;
    let failPage = editSeed;
    const historyPages = [];
    const { a, b, contents } = await fixture(t, {
      empty: true,
      commitPageSize: 1,
      requestHook: async (url, options, next) => {
        const requestUrl = new URL(url);
        const history = requestUrl.pathname.endsWith("/commits") && requestUrl.searchParams.has("path");
        const page = Number(requestUrl.searchParams.get("page") || 1);
        if (history) {
          historyPages.push(page);
          assert.equal(requestUrl.searchParams.get("path"), "seed.md");
          if (failPage && page === 2) {
            failPage = false;
            return Response.json({}, { status: 503 });
          }
        }
        const response = await next();
        if (drop && options.method === "PUT") {
          drop = false;
          throw new Error("Connection closed after creating the file");
        }
        if (history && editSeed && response.headers.get("link")) {
          const headers = new Headers(response.headers);
          headers.set("link", headers.get("link").split(", ").filter(link => link.includes('rel="next"')).join(", "));
          return new Response(response.body, { status: response.status, headers });
        }
        return response;
      },
    });
    await a.save("seed.md", "original seed");
    assert.equal((await a.connect()).phase, "error");
    await b.connect();
    await b.save("later.md", "another PC's addition");
    if (editSeed) await b.save("seed.md", "another PC's edit");
    await b.sync();
    await unlink(path.join(a.folder, "seed.md"));
    await a.restart();
    if (editSeed) {
      assert.equal(a.status().phase, "error", a.status().message);
      assert.deepEqual(await readdir(a.folder), []);
      assert.deepEqual(historyPages, [1, 2]);
      await a.sync();
      assert.deepEqual(historyPages, [1, 2, 1, 2]);
    }
    assert.equal(a.status().phase, "synced", a.status().message);
    assert.equal(a.status().apiConflicts.some(name => name.includes("삭제")), editSeed);
    await b.sync();
    for (const device of [a, b]) {
      assert.equal(await device.read("later.md"), "another PC's addition");
      if (editSeed) assert.equal(await device.read("seed.md"), "another PC's edit");
      else assert.deepEqual(await readdir(device.folder), ["later.md"]);
    }
    assert.equal(Object.hasOwn(contents(), "seed.md"), editSeed);
  });
}
