import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PluginStore } from '../core/plugin-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dynote-plugin-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await mkdir(source);
  const manifest = { id: 'test-plugin', name: 'Test', version: '1.0.0' };
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(source, 'main.js'), 'module.exports = class Test {};\n');
  return { root, source, manifest, store: new PluginStore(path.join(root, 'store')) };
}

test('imports exact program bytes, optional CSS, and excludes source data', async t => {
  const { source, store, manifest } = await fixture(t);
  await writeFile(path.join(source, 'styles.css'), '.original { color: red }');
  await writeFile(path.join(source, 'data.json'), '{"private":true}');
  assert.deepEqual(await store.import(source), manifest);
  const program = await store.program(manifest.id);
  assert.equal(program.source, await readFile(path.join(source, 'main.js'), 'utf8'));
  assert.equal(program.css, '.original { color: red }');
  assert.equal(await store.loadData('0123456789abcdef', manifest.id), null);
  assert.equal((await store.list('0123456789abcdef'))[0].enabled, false);
});

test('state and original plugin data persist per vault', async t => {
  const { source, store } = await fixture(t); await store.import(source);
  await store.setEnabled('0123456789abcdef', 'test-plugin', true);
  await Promise.all([store.saveData('0123456789abcdef', 'test-plugin', { recentFiles: ['A.md'] }), store.saveData('fedcba9876543210', 'test-plugin', { recentFiles: ['B.md'] })]);
  assert.equal((await store.list('0123456789abcdef'))[0].enabled, true);
  assert.equal((await store.list('fedcba9876543210'))[0].enabled, false);
  assert.deepEqual(await store.loadData('0123456789abcdef', 'test-plugin'), { recentFiles: ['A.md'] });
  assert.deepEqual(await store.loadData('fedcba9876543210', 'test-plugin'), { recentFiles: ['B.md'] });
  await store.setEnabled('0123456789abcdef', 'test-plugin', false);
  assert.equal((await store.list('0123456789abcdef'))[0].enabled, false);
});

test('rejects malformed manifests, missing programs and symlink source files', async t => {
  const { source, store } = await fixture(t);
  await writeFile(path.join(source, 'manifest.json'), '{"id":"../escape","name":"Test","version":"1"}');
  await assert.rejects(store.import(source), /manifest|플러그인/);
  await writeFile(path.join(source, 'manifest.json'), '{"id":"test-plugin","name":"Test","version":"1"}');
  await rm(path.join(source, 'main.js'));
  await assert.rejects(store.import(source), /ENOENT|main.js/);
  await writeFile(path.join(source, 'outside.js'), 'outside');
  await symlink(path.join(source, 'outside.js'), path.join(source, 'main.js'));
  await assert.rejects(store.import(source), /링크|일반/);
  for (const id of ['../escape', '/tmp/file', '__proto__']) await assert.rejects(store.program(id), /플러그인/);
  await assert.rejects(store.loadData('../escape', 'test-plugin'), /보관함/);
});
