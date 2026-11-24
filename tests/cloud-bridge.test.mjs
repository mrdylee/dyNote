import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BridgeGit } from "../electron/bridge-git.mjs";
import { BridgeClient, BridgeWorker } from "../electron/cloud-bridge.mjs";
import { managedBridgePath, openBridge } from "../electron/bridge-policy.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-bridge-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const remote = path.join(dir, "mail.git");
  execFileSync("git", ["init", "--quiet", "--bare", remote]);
  const a = generateKeyPairSync("ed25519"), b = generateKeyPairSync("ed25519");
  const channel = randomUUID();
  const store = (name, key, peer) => new BridgeGit({ directory: path.join(dir, name), remote, channel, privateKey: key.privateKey, peerKey: peer.publicKey });
  const local = store("local", a, b), cloud = store("cloud", b, a);
  const receipt = path.join(dir, "receipt.json");
  const client = new BridgeClient(local, receipt);
  return { client, local, cloud, receipt, dir, store, a, b };
}

test("a single Ask survives reopening; signed claim prevents repeated inference", async t => {
  const { client, local, cloud, receipt, dir } = await fixture(t);
  let calls = 0;
  const worker = new BridgeWorker(cloud, path.join(dir, "result.json"), async prompt => { calls++; return prompt + " 답변"; });
  await client.submit("vault-a", "합성 질문");
  await assert.rejects(client.submit("vault-b", "두 번째"), /진행/);
  await client.tick();
  assert.equal((await client.view("vault-a")).state, "QUEUED");
  assert.equal((await client.view("vault-b")).prompt, undefined);
  await worker.tick();
  await worker.tick();
  const reopened = new BridgeClient(local, receipt);
  await reopened.tick();
  assert.equal((await reopened.view("vault-a")).answer, "합성 질문 답변");
  assert.equal((await reopened.view("vault-a")).state, "COMPLETED");
  assert.equal(calls, 1);
});

test("another signer cannot submit a job to the worker", async t => {
  const { cloud, dir, store, b } = await fixture(t);
  const rogue = store("rogue", generateKeyPairSync("ed25519"), b);
  const client = new BridgeClient(rogue, path.join(dir, "rogue.json"));
  await client.submit("a", "합성"); await client.tick();
  const worker = new BridgeWorker(cloud, path.join(dir, "result.json"), () => assert.fail("unexpected inference"));
  await assert.rejects(worker.tick(), /서명/);
});

test("managed mailbox stays at the configured location with ordinary Git URL aliases", async t => {
  const { local, cloud, dir } = await fixture(t);
  const alternate = path.join(dir, "other.git");
  execFileSync("git", ["init", "--quiet", "--bare", alternate]);
  await local.git(["config", "url." + alternate + ".pushInsteadOf", local.remote]);
  await cloud.git(["config", "url." + alternate + ".insteadOf", cloud.remote]);
  await local.write("request", { sample: "fixture" });
  assert.equal(execFileSync("git", ["-C", alternate, "for-each-ref", "--format=%(refname)"], {encoding:"utf8"}), "");
  assert.equal((await cloud.read("request")).value.sample, "fixture");
});

test("worker recovers a lost claim acknowledgement before calling Copilot", async t => {
  const { client, cloud, dir } = await fixture(t);
  await client.submit("vault", "claim"); await client.tick();
  let calls = 0;
  const restart = () => new BridgeWorker(cloud, path.join(dir, "pending.json"), async () => { calls++; return "답변"; });
  const write = cloud.write.bind(cloud);
  cloud.write = async (...args) => { await write(...args); throw new Error("lost claim ACK"); };
  await assert.rejects(restart().tick(), /lost claim ACK/);
  cloud.write = write;
  assert.equal(calls, 0);
  await restart().tick();
  await client.tick();
  assert.equal((await client.view("vault")).state, "COMPLETED");
  assert.equal(calls, 1);
});

test("after interruption inside inference the recovered worker reports an uncertain outcome only once", async t => {
  const { client, cloud, dir } = await fixture(t);
  await client.submit("vault", "inference"); await client.tick();
  const file = path.join(dir, "pending.json");
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  // Suspend the old process precisely at the model boundary; only its replacement acts again.
  void new BridgeWorker(cloud, file, () => { started(); return new Promise(() => {}); }).tick();
  await entered;
  const recovered = new BridgeWorker(cloud, file, () => assert.fail("repeated inference"));
  await recovered.tick(); await recovered.tick(); await client.tick();
  const job = await client.view("vault");
  assert.equal(job.state, "FAILED");
  assert.equal(job.reason, "OUTCOME_UNKNOWN");
});

test("an answer finished before expiry can be retrieved after a late upload without a new Ask", async t => {
  const { client, cloud, dir } = await fixture(t);
  await client.submit("vault", "delayed"); await client.tick();
  const write = cloud.write.bind(cloud);
  cloud.write = async (...args) => {
    if (args[1].state === "COMPLETED") throw new Error("offline");
    return write(...args);
  };
  let calls = 0;
  const worker = new BridgeWorker(cloud, path.join(dir, "pending.json"), async () => { calls++; return "늦게 도착"; });
  await assert.rejects(worker.tick(), /offline/);
  t.mock.method(Date, "now", () => new Date().getTime() + 11 * 60_000);
  await client.tick();
  const timedOut = await client.view("vault");
  assert.equal(timedOut.state, "TIMEOUT");
  cloud.write = write;
  await worker.tick();
  await assert.rejects(client.recheck("other-vault", timedOut.requestId));
  const job = await client.recheck("vault", timedOut.requestId);
  assert.equal(job.answer, "늦게 도착");
  assert.equal(calls, 1);
});

test("retry after a lost request acknowledgement or result upload does not run inference twice", async t => {
  const { client, local, cloud, dir } = await fixture(t);
  const writeRequest = local.write.bind(local);
  local.write = async (...args) => { await writeRequest(...args); throw new Error("lost ACK"); };
  await client.submit("vault", "재시도");
  await assert.rejects(client.tick(), /lost ACK/);
  local.write = writeRequest;
  await client.tick();
  let calls = 0;
  const file = path.join(dir, "pending.json");
  const worker = () => new BridgeWorker(cloud, file, async () => { calls++; return "완료"; });
  const writeResponse = cloud.write.bind(cloud);
  cloud.write = async (...args) => {
    if (args[1].state === "COMPLETED") throw new Error("network offline");
    return writeResponse(...args);
  };
  await assert.rejects(worker().tick(), /network offline/);
  await client.tick();
  assert.equal((await client.view("vault")).state, "RUNNING");
  cloud.write = writeResponse;
  await worker().tick();
  await client.tick();
  assert.equal((await client.view("vault")).answer, "완료");
  assert.equal(calls, 1);
});

test("expired text and injected context never reach the model", async t => {
  const { local, cloud, dir } = await fixture(t);
  let calls = 0;
  const worker = new BridgeWorker(cloud, path.join(dir, "result.json"), async () => { calls++; });
  const old = await local.write("request", { id: randomUUID(), created: 0, prompt: "만료" });
  await worker.tick();
  await local.write("request", { id: randomUUID(), created: Date.now(), prompt: "질문", context: "private" }, old);
  await assert.rejects(worker.tick(), /유효하지/);
  assert.equal(calls, 0);
});

test("a request that expires while looking up the previous tip is never published", async t => {
  const { client, local, cloud } = await fixture(t);
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  await client.submit("vault", "expired before push");
  const read = local.read.bind(local);
  local.read = async (...args) => {
    const result = await read(...args);
    if (args[0] === "request") clock += 11 * 60000;
    return result;
  };
  await client.tick();
  assert.equal(await cloud.read("request"), null);
  assert.equal((await client.view("vault")).state, "TIMEOUT");
});

test("absent policy retains Direct; unreadable keys or malformed policy block Cloud execution", async t => {
  const { dir, a, b } = await fixture(t);
  const file = path.join(dir, "managed.json");
  assert.equal(await openBridge(file, dir), null);
  await writeFile(file, "{}");
  assert.equal((await openBridge(file, dir)).role, "blocked");
  const policy = { channel: randomUUID(), role: "client", remote: "https://example.invalid/approved/ai.git",
    privateKeyFile: path.join(dir, "own.pem"), peerPublicKeyFile: path.join(dir, "peer.pem") };
  await writeFile(file, JSON.stringify(policy));
  assert.equal((await openBridge(file, dir)).role, "blocked");
  await writeFile(policy.privateKeyFile, a.privateKey.export({ format: "pem", type: "pkcs8" }));
  await writeFile(policy.peerPublicKeyFile, b.publicKey.export({ format: "pem", type: "spki" }));
  assert.equal((await openBridge(file, dir)).role, "client");
  await writeFile(file, JSON.stringify({ ...policy, role: "worker", model: "auto" }));
  assert.equal((await openBridge(file, dir)).role, "blocked");
});

test("Windows policy uses the machine folder and blocks Direct on discovery failure", async () => {
  assert.equal(managedBridgePath("win32", () => "D:\\공용 데이터"), "D:\\공용 데이터\\Dynote\\cloud-bridge.json");
  const missing = managedBridgePath("win32", () => { throw new Error("known folder unavailable"); });
  assert.equal(missing, null);
  assert.equal((await openBridge(missing)).role, "blocked");
});

test("managed repository selection persists independently, respects note remotes and holds outstanding jobs", async t => {
  const { dir, a, b } = await fixture(t);
  const file = path.join(dir, "policy.json"), primary = "https://git.example.test/team/ask.git", second = "https://git.example.test/team/second.git";
  const policy = { role: "client", channel: randomUUID(), remote: primary, additionalRemotes: [second],
    privateKeyFile: path.join(dir, "private"), peerPublicKeyFile: path.join(dir, "public") };
  await writeFile(policy.privateKeyFile, a.privateKey.export({ format: "pem", type: "pkcs8" }));
  await writeFile(policy.peerPublicKeyFile, b.publicKey.export({ format: "pem", type: "spki" }));
  await writeFile(file, JSON.stringify(policy));
  let notes = ["git@git.example.test:Team/Second.git"];
  const reopen = () => openBridge(file, dir, undefined, async () => notes);
  let bridge = await reopen();
  assert.equal(bridge.settings().remote, primary);
  assert.deepEqual(bridge.settings().remotes, [primary, second]);
  await assert.rejects(bridge.select(second), /노트/);
  await assert.rejects(bridge.select("https://git.example.test/team/unknown.git"), /승인/);
  assert.throws(() => bridge.checkNoteRemote("ssh://git@git.example.test/team/Ask"), /중계/);
  notes = [];
  await bridge.select(second);
  bridge = await reopen();
  assert.equal(bridge.settings().remote, second);
  await bridge.use("submit", "vault", "pending question");
  await assert.rejects(bridge.select(primary), /진행|작업/);
  notes = [second];
  bridge = await reopen();
  assert.match(bridge.settings().error, /노트/);
  await assert.rejects(bridge.use("tick"), /노트/);
  await writeFile(file, JSON.stringify({ ...policy, additionalRemotes: [] }));
  bridge = await reopen();
  assert.equal(bridge.settings().remote, "");
  await assert.rejects(bridge.use("submit", "vault", "stale selection"), /승인/);
  await bridge.select(primary);
  assert.equal((await reopen()).settings().remote, primary);
});

test("Windows native policy discovery returns an absolute machine path", { skip: process.platform !== "win32" }, () => {
  const file = managedBridgePath();
  assert.ok(file && path.win32.isAbsolute(file));
  assert.equal(path.win32.basename(path.win32.dirname(file)), "Dynote");
});

test("offline expiry releases other vaults and recovers an existing timely answer", async t => {
  const { client, local, cloud, receipt, dir } = await fixture(t);
  let clock = Date.now(), calls = 0;
  t.mock.method(Date, "now", () => clock);
  const { requestId } = await client.submit("one", "original");
  await client.tick();
  const worker = new BridgeWorker(cloud, path.join(dir, "pending.json"), async () => { calls++; return "saved"; });
  await worker.tick();
  const read = t.mock.method(local, "read", async () => { throw new Error("offline"); });
  clock += 10 * 60000;
  const reopened = new BridgeClient(local, receipt);
  await assert.rejects(reopened.tick(), /offline/);
  const expired = await reopened.view("one");
  assert.equal(expired.state, "TIMEOUT");
  assert.equal(expired.awaitingConfirmation, true);
  assert.equal((await reopened.view("two")).state, "IDLE");
  await assert.rejects(reopened.recheck("two", requestId));
  read.mock.restore();
  await reopened.tick();
  assert.equal((await reopened.view("one")).answer, "saved");
  assert.equal(calls, 1);
});

test("an unsent question can be replaced after its offline deadline", async t => {
  const { client, local, cloud } = await fixture(t);
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  await client.submit("one", "old");
  clock += 10 * 60000;
  const read = t.mock.method(local, "read", async () => { throw new Error("offline"); });
  await assert.rejects(client.tick(), /offline/);
  const next = await client.submit("two", "new");
  read.mock.restore();
  await client.tick();
  assert.equal((await cloud.read("request")).value.id, next.requestId);
});

test("worker retires an orphaned result only for a new signed request and never repeats it", async t => {
  const { local, cloud, dir } = await fixture(t);
  const first = { id: randomUUID(), created: Date.now(), prompt: "first" };
  const firstTip = await local.write("request", first);
  const calls = [];
  const restart = () => new BridgeWorker(cloud, path.join(dir, "pending.json"), async (prompt, id, deadline) => {
    calls.push({ id, deadline });
    return prompt;
  });
  const write = cloud.write.bind(cloud);
  cloud.write = async (...args) => {
    if (args[1].state === "COMPLETED") throw new Error("upload offline");
    return write(...args);
  };
  await assert.rejects(restart().tick(), /upload offline/);
  cloud.write = write;
  execFileSync("git", ["-C", local.remote, "update-ref", "-d", cloud.ref("job/" + first.id)]);
  await assert.rejects(restart().tick(), /변경/);
  const next = { id: randomUUID(), created: Date.now(), prompt: "next" };
  const nextTip = await local.write("request", next, firstTip);
  await restart().tick();
  await restart().tick();
  assert.equal((await local.read("job/" + next.id)).value.answer, "next");
  await local.write("request", first, nextTip);
  await restart().tick();
  assert.equal(await local.read("job/" + first.id), null);
  assert.deepEqual(calls, [first, next].map(r => ({ id: r.id, deadline: r.created + 10 * 60000 })));
});
