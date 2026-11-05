import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../core/vault.mjs';
import { localDate } from '../core/periodic-notes.mjs';

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-daily-')));
const profile = path.join(root, 'profile'), personal = path.join(root, 'Personal'), team = path.join(root, 'Team');
const personalId = new Vault(personal, profile).id;
const todayPath = `Journal/${localDate()}.md`;
const yesterday = 'Records/2032_01_01.md', next = 'Records/2032_01_02.md', after = 'Records/2032_01_03.md';
const original = '# Keep my journal\n\n- Existing record';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const errors = [];
let app;
try {
  await Promise.all([profile, team, path.join(personal, 'Records')].map(directory => mkdir(directory, { recursive: true })));
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    vaultRoot: team, vaults: [team, personal], vaultPurposes: { [team]: 'team', [personal]: 'personal' },
  }));
  await writeFile(path.join(personal, 'Template.md'), '# {{title}}\n\n- Template for {{date:YYYY-MM-DD}}');
  await writeFile(path.join(personal, yesterday), original);
  await writeFile(path.join(team, 'Team.md'), '# Team document');
  app = await electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve('node_modules/electron/dist', process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'],
    env: { ...process.env, OPEN_NOTES_DATA: profile },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  const teamTree = page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true });
  const feed = page.getByRole('region', { name: '저널 피드', exact: true });
  const entry = file => feed.locator(`article[data-vault-id="${personalId}"][data-document-path="${file}"]`);
  await entry(todayPath).locator('.cm-focused').waitFor();
  await personalTree.getByTitle(todayPath, { exact: true }).waitFor();
  await teamTree.getByTitle('Team.md', { exact: true }).waitFor();
  assert.equal(await readFile(path.join(personal, todayPath), 'utf8'), `# ${localDate()}\n\n- `);
  await assert.rejects(readFile(path.join(team, todayPath)), { code: 'ENOENT' });

  await page.evaluate(id => localStorage.setItem(`dynote.journal.${id}`, JSON.stringify({
    daily: { folder: 'Records', format: 'YYYY_MM_DD', template: 'Template.md' },
  })), personalId);
  await page.clock.install({ time: new Date(2032, 0, 1, 23, 57) });
  await page.clock.pauseAt(new Date(2032, 0, 1, 23, 59, 55));
  await page.reload();
  const previousEditor = entry(yesterday).getByRole('textbox', { name: 'Markdown 편집기' });
  await previousEditor.focus();
  assert.equal(await readFile(path.join(personal, yesterday), 'utf8'), original);
  await page.keyboard.insertText(' before midnight');
  await page.clock.runFor(31000);
  await personalTree.getByTitle(next, { exact: true }).waitFor();
  assert.equal(await readFile(path.join(personal, next), 'utf8'), '# 2032_01_02\n\n- Template for 2032-01-02');
  await assert.rejects(readFile(path.join(team, next)), { code: 'ENOENT' });
  assert.equal(await previousEditor.evaluate(element => element === document.activeElement), true, 'a rollover does not interrupt typing');
  await page.keyboard.insertText(' after midnight');
  await page.keyboard.press(`${modifier}+s`);
  await page.locator('.save-status.saved').waitFor();
  assert.equal(await readFile(path.join(personal, yesterday), 'utf8'), original + ' before midnight after midnight');
  await page.getByRole('combobox', { name: '문서 공간 범위' }).focus();
  await entry(next).getByRole('textbox', { name: 'Markdown 편집기' }).waitFor();

  await page.evaluate(() => localStorage.setItem('dynote.startup', '"last"'));
  await page.clock.setSystemTime(new Date(2032, 0, 3, 12));
  await page.reload();
  await personalTree.getByTitle(after, { exact: true }).waitFor();
  assert.equal(await feed.count(), 0);
  assert.equal(await readFile(path.join(personal, after), 'utf8'), '# 2032_01_03\n\n- Template for 2032-01-03');
  assert.deepEqual(errors, []);
  console.log('Daily journal: startup, personal routing, local midnight, existing bytes, and last-document startup passed.');
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
