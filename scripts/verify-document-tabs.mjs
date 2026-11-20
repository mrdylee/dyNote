import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../core/vault.mjs';
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-document-tabs-')));
const profile = path.join(root, 'profile'), personal = path.join(root, 'Personal'), team = path.join(root, 'Team');
const transcript = 'Copilot Note/' + 'a'.repeat(20) + '/' + 'b'.repeat(20) + '.md';
let app;
try {
  for (const dir of [profile, path.dirname(path.join(personal, transcript)), path.join(personal, 'Archive'), path.join(personal, 'Copies'), team]) await mkdir(dir, { recursive: true });
  await writeFile(path.join(personal, transcript), '# Test conversation\n\nQuestion and answer');
  await writeFile(path.join(personal, 'Home.md'), '# Home\n\nDrop here\n');
  await writeFile(path.join(team, 'Team.md'), '# Team\n');
  await writeFile(path.join(personal, 'Travel.md'), '# Travel\n');
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ vaultRoot: personal, vaults: [personal, team], vaultPurposes: { [personal]: 'personal', [team]: 'team' } }));
  await mkdir(path.join(profile, 'updates'), { recursive: true });
  await writeFile(path.join(profile, 'updates/settings.json'), JSON.stringify({ preferences: { enabled: false } }));
  const sourceVault = await Vault.open(personal, profile), teamVault = await Vault.open(team, profile);
  const teamNote = (await teamVault.documentSnapshot()).notes[0];
  const pending = { path: teamNote.path, kind: 'edit', original: teamNote.content, content: teamNote.content + 'Pending', aiContent: teamNote.content + 'Pending', revision: teamNote.revision, userEdited: false };
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || (await import('electron')).default, args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1320, 900);
    ipcMain.removeHandler('notes:copilot-status');
    ipcMain.handle('notes:copilot-status', () => ({ ok: true, value: { authenticated: true, login: 'fixture', models: [{ id: 'auto', name: 'Auto' }] } }));
    ipcMain.removeHandler('notes:copilot-send');
    ipcMain.handle('notes:copilot-send', (event, args) => {
      globalThis.documentRequest = args;
      globalThis.documentEmit = (type, data = {}) => event.sender.send('notes:copilot-event', { requestId: args.requestId, type, ...data });
      return { ok: true };
    });
    ipcMain.removeHandler('notes:copilot-cancel');
    ipcMain.handle('notes:copilot-cancel', () => { globalThis.documentEmit('canceled'); return { ok: true }; });
  });
  await page.getByRole('button', { name: '파일 목록', exact: true }).waitFor();
  await page.evaluate(({ id, pending }) => { localStorage.setItem('dynote.startup', 'files'); localStorage.setItem(`dynote.copilot.drafts.${id}`, JSON.stringify([pending])); }, { id: teamVault.id, pending });
  await page.reload();
  const file = name => page.locator(`.file-row[title="${name}"]`);
  await file(transcript).click();
  const heading = page.locator('.document-pane .pane-heading');
  await heading.getByRole('button', { name: '문서로 만들기', exact: true }).click();
  await page.locator('.conversation-document:visible').getByRole('button', { name: '초안 만들기', exact: true }).click();
  await page.locator('.tab.generating').waitFor();
  const updateDuringGeneration = await app.evaluate(({ BrowserWindow, ipcMain }) => new Promise(resolve => {
    const listener = (_event, id, ready) => { if (id === 987653) { ipcMain.removeListener('notes:close-ready', listener); resolve(ready); } };
    ipcMain.on('notes:close-ready', listener);
    BrowserWindow.getAllWindows()[0].webContents.send('notes:before-close', { id: 987653, mode: 'quit', updating: true });
  }));
  assert.equal(updateDuringGeneration, false, 'update must wait for background generation');
  assert.equal(await page.getByRole('dialog', { name: '문서로 만들기', exact: true }).count(), 0);
  await file('Home.md').click();
  await page.locator('.document-pane[data-document-path="Home.md"]').waitFor();
  const request = await app.evaluate(() => globalThis.documentRequest);
  assert.equal(request.mode, 'chat'); assert.equal(request.context.path, transcript); assert.equal(request.vaultId, sourceVault.id);
  await app.evaluate(() => globalThis.documentEmit('done', { content: '# Generated\n\nUseful body' }));
  await page.locator('.tab.draft-ready').waitFor();
  assert.equal(await page.locator('.document-pane[data-document-path="Home.md"]').count(), 1);
  await page.locator('.tab.draft-ready .tab-label').click();
  const draft = page.locator('.conversation-document:visible');
  await draft.getByText('어디에 저장할까요?', { exact: true }).waitFor();
  await draft.getByLabel('파일 이름', { exact: true }).fill('Home');
  await draft.getByRole('button', { name: '새 문서로 저장', exact: true }).click();
  await draft.getByRole('alert').waitFor();
  assert.match(await draft.getByLabel('Markdown 초안', { exact: true }).inputValue(), /Useful body/);
  const temporary = await page.evaluate(async () => (await window.notes.documentDrafts()).value);
  assert.equal(temporary.length, 1);
  assert.match(temporary[0].content, /Useful body/);
  const temporaryFile = path.join(profile, 'tmp/copilot-documents', `${temporary[0].id}.json`);
  assert.match(await readFile(temporaryFile, 'utf8'), /Useful body/);
  await page.reload();
  await page.locator('.tab.draft-ready .tab-label').click();
  assert.match(await draft.getByLabel('Markdown 초안', { exact: true }).inputValue(), /Useful body/);
  // Hold the debounce so only the close handshake can persist the final edit.
  await page.evaluate(() => { window.originalTimeout = window.setTimeout; window.setTimeout = (fn, ms, ...args) => window.originalTimeout(fn, ms === 250 ? 30000 : ms, ...args); });
  await draft.getByLabel('Markdown 초안', { exact: true }).fill('# Last edit before closing');
  const closeReady = await app.evaluate(({ BrowserWindow, ipcMain }) => new Promise(resolve => {
    const listener = (_event, id, ready) => { if (id === 987654) { ipcMain.removeListener('notes:close-ready', listener); resolve(ready); } };
    ipcMain.on('notes:close-ready', listener);
    BrowserWindow.getAllWindows()[0].webContents.send('notes:before-close', { id: 987654, mode: 'quit' });
  }));
  assert.equal(closeReady, true);
  assert.equal(JSON.parse(await readFile(temporaryFile, 'utf8')).content, '# Last edit before closing');
  await page.evaluate(() => { window.setTimeout = window.originalTimeout; });
  await draft.getByLabel('Markdown 초안', { exact: true }).fill('');
  await draft.getByLabel('Markdown 초안', { exact: true }).fill('# Generated\n\nUseful body');
  await draft.getByLabel('파일 이름', { exact: true }).fill('Generated');
  await draft.getByLabel('저장할 폴더', { exact: true }).selectOption('Archive');
  await draft.getByRole('button', { name: '새 문서로 저장', exact: true }).click();
  await file('Archive/Generated.md').waitFor();
  await assert.rejects(readFile(temporaryFile), { code: 'ENOENT' });
  assert.match(await readFile(path.join(personal, 'Archive/Generated.md'), 'utf8'), /Useful body/);
  assert.equal(await readFile(path.join(team, 'Team.md'), 'utf8'), teamNote.content);
  assert.deepEqual(await page.evaluate(id => JSON.parse(localStorage.getItem(`dynote.copilot.drafts.${id}`)), teamVault.id), [pending]);

  // Pending team edits must not prevent folder creation in that tree.
  const teamTree = page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true });
  await teamTree.locator('h3').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '폴더 추가', exact: true }).click();
  const folderDialog = page.getByRole('dialog', { name: '폴더 추가', exact: true });
  await folderDialog.getByLabel('폴더 이름', { exact: true }).fill('New folder');
  await folderDialog.getByRole('button', { name: '만들기', exact: true }).click();
  await teamTree.getByTitle('New folder', { exact: true }).waitFor();
  assert.deepEqual(await readdir(path.join(team, 'New folder')), []);

  // Real Chromium DragEvent/DataTransfer exercises source handlers, destination handlers and confirmation.
  const drag = async (source, target, ctrlKey = false) => {
    if (process.env.DYNOTE_NATIVE_DRAG) {
      await source.scrollIntoViewIfNeeded();
      const start = await source.boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      if (ctrlKey) await page.keyboard.down('Control');
      await page.mouse.down();
      try {
        await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2);
        await target.scrollIntoViewIfNeeded();
        const end = await target.boundingBox();
        await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
        await page.mouse.move(end.x + end.width / 2 + 1, end.y + end.height / 2);
        if (await target.getAttribute('data-tree-drop-vault')) await target.and(page.locator('[data-drop-label]')).waitFor();
        else await page.locator('.pane-drop-target.link').waitFor();
      } finally {
        await page.mouse.up();
        if (ctrlKey) await page.keyboard.up('Control');
      }
      return;
    }
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await source.dispatchEvent('dragstart', { dataTransfer: transfer, ctrlKey });
    const box = await target.boundingBox();
    const event = { dataTransfer: transfer, ctrlKey, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await target.dispatchEvent('dragover', event);
    await target.dispatchEvent('drop', event);
    await source.dispatchEvent('dragend', { dataTransfer: transfer });
    await transfer.dispose();
  };
  const tab = name => page.locator(`.tabs .tab-label[title$="${name}"]`);
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  // Clear unrelated pending edits for operations that rewrite other files' links.
  await page.evaluate(id => localStorage.removeItem(`dynote.copilot.drafts.${id}`), teamVault.id);
  await page.reload();
  await file('Archive/Generated.md').click();
  await drag(tab('Archive/Generated.md'), personalTree.getByTitle('Copies', { exact: true }), true);
  await file('Copies/Generated.md').waitFor();
  assert.match(await readFile(path.join(personal, 'Archive/Generated.md'), 'utf8'), /Useful body/);
  await drag(tab('Archive/Generated.md'), personalTree.locator('h3'));
  const move = page.getByRole('dialog', { name: '이동할까요?', exact: true });
  await move.waitFor();
  await assert.rejects(readFile(path.join(personal, 'Generated.md')), { code: 'ENOENT' });
  await move.getByRole('button', { name: '취소', exact: true }).click();
  await drag(tab('Archive/Generated.md'), personalTree.locator('h3'));
  await move.getByRole('button', { name: '이동', exact: true }).click();
  await file('Generated.md').waitFor();
  await assert.rejects(readFile(path.join(personal, 'Archive/Generated.md')), { code: 'ENOENT' });
  await file('Home.md').click();
  const editor = page.locator('.document-pane[data-document-path="Home.md"] .cm-content');
  await drag(tab('Generated.md'), editor);
  await page.locator('.tab-return-preview').waitFor();
  assert.equal(await page.locator('.tab-return-preview').evaluate(element => element.getAnimations()[0].effect.getTiming().duration), 420);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.cmTile?.root?.view.state.doc.toString().includes('[[Generated.md|Generated]]'));
  await tab('Generated.md').waitFor();
  await page.locator('.tab-return-preview').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.save-status.saved'));
  assert.match(await readFile(path.join(personal, 'Home.md'), 'utf8'), /\[\[Generated.md\|Generated\]\]/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await drag(tab('Generated.md'), editor);
  assert.equal(await page.locator('.tab-return-preview').count(), 0);
  await page.getByRole('button', { name: '읽기 보기', exact: true }).click();
  const preview = page.locator('.document-pane[data-document-path="Home.md"] .markdown-preview');
  await drag(tab('Generated.md'), preview);
  await preview.locator('a[data-note="Generated.md"]').first().click();
  await page.locator('.document-pane[data-document-path="Generated.md"]').waitFor();
  await file('Travel.md').click();
  await drag(tab('Travel.md'), teamTree.getByTitle('New folder', { exact: true }));
  await move.getByRole('button', { name: '이동', exact: true }).click();
  await teamTree.getByTitle('New folder/Travel.md', { exact: true }).waitFor();
  assert.equal(await readFile(path.join(team, 'New folder/Travel.md'), 'utf8'), '# Travel\n');
  await assert.rejects(readFile(path.join(personal, 'Travel.md')), { code: 'ENOENT' });
  assert.deepEqual(errors, []);
  console.log('PASS: background document tab, destination save with unrelated AI drafts, conflict retention, folder menus, Ctrl copy, confirmed move, body link and return animation. Synthetic AI transport; real Electron, editor and files.');
} catch (error) {
  const page = app && (await app.windows())[0];
  if (page) { console.error((await page.locator('body').innerText()).slice(-10000)); await page.screenshot({ path: path.join(root, 'document-tabs-failure.png') }); }
  throw error;
} finally { await app?.close(); await rm(root, { recursive: true, force: true }); }
