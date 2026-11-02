import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rename, access, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { VaultRegistry } from "../electron/vault-registry.mjs";

test("legacy selected vault survives registry migration, switches and a new app instance", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-registry-")));
  const first = path.join(root, "내 노트"), second = path.join(root, "두번째");
  await mkdir(first); await mkdir(second);
  const file = path.join(root, "settings.json");
  await writeFile(file, JSON.stringify({ vaultRoot: first }));
  const registry = new VaultRegistry(file);
  await registry.load();
  assert.equal(registry.selected, first);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].purpose, null);
  await registry.select(second);
  const restarted = new VaultRegistry(file); await restarted.load();
  assert.equal(restarted.selected, second);
  assert.equal(restarted.list().length, 2);
  await restarted.forget(first);
  await access(first);
  assert.equal(restarted.list().length, 1);
  await assert.rejects(restarted.forget(second), /사용 중/);
  assert.equal(JSON.parse(await readFile(file, "utf8")).vaultRoot, second);
});

test("missing selected vault stays recorded and does not silently become a demo vault", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-registry-")));
  const folder = path.join(root, "notes"), file = path.join(root, "settings.json");
  await mkdir(folder);
  const registry = new VaultRegistry(file); await registry.load(); await registry.select(folder);
  await rename(folder, folder + "-offline");
  const restarted = new VaultRegistry(file); await restarted.load();
  assert.equal(restarted.selected, folder);
  assert.equal(restarted.list()[0].root, folder);
  await assert.rejects(restarted.select(folder));
  assert.equal(restarted.selected, folder);
});

test("corrupt registry is reported without overwriting its original bytes", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-registry-"))), file = path.join(root, "settings.json");
  await writeFile(file, "{broken");
  const registry = new VaultRegistry(file);
  await assert.rejects(registry.load(), /설정/);
  assert.equal(await readFile(file, "utf8"), "{broken");
});

test("personal and team purposes survive switching, restart and forgetting without changing notes", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-spaces-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const personal = path.join(root, "Personal"), team = path.join(root, "Team"), file = path.join(root, "settings.json");
  await mkdir(personal); await mkdir(team);
  const original = Buffer.from('\uFEFF# Private\r\nDo not move.\r\n');
  await writeFile(path.join(personal, "Journal.md"), original);
  const registry = new VaultRegistry(file); await registry.load();
  await registry.select(personal, "personal"); await registry.select(team, "team");
  await registry.select(personal);
  const restarted = new VaultRegistry(file); await restarted.load();
  assert.deepEqual(restarted.list().map(({ root, purpose }) => [root, purpose]), [[personal, "personal"], [team, "team"]]);
  assert.equal(restarted.selected, personal);
  await restarted.select(team + "/../Team");
  assert.equal(restarted.list().length, 2);
  assert.equal(restarted.list().find(entry => entry.active).purpose, "team");
  await restarted.forget(personal); await access(personal);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).vaultPurposes, { [team]: "team" });
  assert.deepEqual(await readFile(path.join(personal, "Journal.md")), original);
});

test("purpose changes require registered roots and valid choices and never rewrite failed settings", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-spaces-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "Notes"), file = path.join(root, "settings.json"); await mkdir(folder);
  const registry = new VaultRegistry(file); await registry.select(folder);
  assert.equal(registry.list()[0].purpose, null);
  await registry.setPurpose(folder, "personal");
  const before = await readFile(file);
  await assert.rejects(registry.setPurpose(folder, "public"), /용도/);
  await assert.rejects(registry.setPurpose(root, "team"), /등록/);
  await assert.rejects(registry.select(folder, "public"), /용도/);
  assert.deepEqual(await readFile(file), before);
  await registry.setPurpose(folder, "team");
  assert.equal(registry.list()[0].purpose, "team");
});

test("personal and team roots cannot contain each other, regardless of assignment order", async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-spaces-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = path.join(root, "Parent"), child = path.join(parent, "Child"), file = path.join(root, "settings.json");
  await mkdir(child, { recursive: true });
  const registry = new VaultRegistry(file); await registry.select(parent, "team");
  const before = await readFile(file);
  await assert.rejects(registry.select(child, "personal"), /서로 포함/);
  await assert.rejects(registry.checkPurpose(path.parse(parent).root, "personal"), /서로 포함/);
  assert.deepEqual(await readFile(file), before); assert.equal(registry.selected, parent);
  await registry.select(child);
  const legacy = await readFile(file);
  await assert.rejects(registry.setPurpose(child, "personal"), /서로 포함/);
  assert.deepEqual(await readFile(file), legacy);
  await registry.setPurpose(parent, "personal");
  await registry.setPurpose(child, "personal");
  await assert.rejects(registry.setPurpose(parent, "team"), /서로 포함/);
});
