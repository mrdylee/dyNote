import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('temporary documents survive reopening and deletion only removes the selected draft', async t => {
  const { DocumentDrafts } = await import('../electron/document-drafts.mjs').catch(() => ({}));
  assert.equal(typeof DocumentDrafts, 'function', 'temporary document store is available');
  const root = await mkdtemp(path.join(tmpdir(), 'dynote-drafts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new DocumentDrafts(root);
  const draft = { id: randomUUID(), vaultId: 'a'.repeat(16), source: { path: 'Copilot Note/source.md', title: '대화', content: '# 원본' }, fileName: '새 문서', content: '# 결과\n보관할 초안', promptId: 'default' };
  await store.write(draft);
  const other = { ...draft, id: randomUUID() };
  await store.write(other);
  assert.match(await readFile(path.join(root, `${draft.id}.json`), 'utf8'), /보관할 초안/);
  assert.deepEqual((await new DocumentDrafts(root).list()).find(item => item.id === draft.id), draft);
  await store.remove(draft.id);
  assert.deepEqual(await store.list(), [other]);
  await assert.rejects(store.write({ ...draft, id: '../outside' }), /임시/);
  await assert.rejects(store.remove('../outside'), /임시/);
});
