import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rename, access, realpath } from "node:fs/promises";
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
