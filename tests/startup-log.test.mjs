import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createStartupLog } from "../electron/startup-log.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "dynote-startup-log-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function entries(dir) {
  const log = await readFile(path.join(dir, "startup.log"), "utf8");
  return log.trim().split("\n").map(line => JSON.parse(line));
}

test("records a pending startup step before its operation finishes", async t => {
  const dir = await fixture(t);
  const log = createStartupLog(dir);
  let finish;
  const pending = log.run("vault.initial-snapshot", () => new Promise(resolve => { finish = resolve; }));

  const [begin] = await entries(dir);
  assert.equal(begin.stage, "vault.initial-snapshot");
  assert.equal(begin.event, "begin");
  assert.equal(begin.durationMs, undefined);

  finish("note data");
  assert.equal(await pending, "note data");
  assert.equal(await log.run("vault.initial-snapshot", () => "later read"), "later read");
  const recorded = await entries(dir);
  assert.deepEqual(recorded.map(row => row.event), ["begin", "ok"]);
  assert.equal(begin.run, recorded[1].run);
  assert.ok(recorded[1].durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(recorded), /note data|later read/);
});

test("records the failed stage without copying the error message", async t => {
  const dir = await fixture(t);
  const log = createStartupLog(dir);
  const error = new Error("Private vault path");

  await assert.rejects(log.run("vault.open-selected", () => { throw error; }), reason => reason === error);
  const recorded = await entries(dir);
  assert.deepEqual(recorded.map(row => row.event), ["begin", "error"]);
  assert.doesNotMatch(JSON.stringify(recorded), /Private vault path/);
});

test("rotates an old log and allows startup when the log location is unavailable", async t => {
  const dir = await fixture(t);
  const oldLog = "x".repeat(128 * 1024);
  await writeFile(path.join(dir, "startup.log"), oldLog);
  createStartupLog(dir).mark("process.start");
  assert.equal(await readFile(path.join(dir, "startup.previous.log"), "utf8"), oldLog);
  assert.equal((await entries(dir))[0].stage, "process.start");

  const unreachable = createStartupLog(path.join(dir, "startup.log"));
  assert.equal(await unreachable.run("profile.prepare", () => "ready"), "ready");
});
