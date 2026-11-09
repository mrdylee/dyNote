import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-tree-resize-')));
const profile = path.join(root, 'profile'), personal = path.join(root, 'Personal'), team = path.join(root, 'Team');
const errors = [];
let app;
try {
  await Promise.all([profile, personal, team].map(directory => mkdir(directory)));
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    vaultRoot: team, vaults: [team, personal], vaultPurposes: { [team]: 'team', [personal]: 'personal' },
  }));
  for (const directory of [personal, team]) {
    for (let index = 0; index < 18; index++) await mkdir(path.join(directory, `Folder${String(index).padStart(2, '0')}`));
  }
  app = await electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve('node_modules/electron/dist', process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron'),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1380, 900));
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  const teamTree = page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true });
  const divider = page.getByRole('separator', { name: '개인 노트와 팀 노트 높이', exact: true });
  await personalTree.waitFor();
  await divider.waitFor();
  assert.equal(await divider.getAttribute('aria-orientation'), 'horizontal');
  const before = await personalTree.boundingBox();
  const available = before.height + (await teamTree.boundingBox()).height;
  const minimum = Math.min(available / 2, Math.max(84, available * 0.2));
  const expectedIncrease = Math.min(95, available - minimum - before.height);
  const handle = await divider.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 95, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(({ before, expectedIncrease }) => {
    const height = document.querySelector('.space-tree-group').getBoundingClientRect().height;
    return Math.abs(height - before - expectedIncrease) < 2;
  }, { before: before.height, expectedIncrease });
  const after = await personalTree.boundingBox();
  assert.ok(after.height >= before.height + expectedIncrease - 2, 'drag expands personal tree up to the team minimum');
  assert.ok((await teamTree.boundingBox()).height > 60, 'team heading and rows remain available');
  for (const tree of [personalTree, teamTree]) {
    const size = await tree.locator('.file-tree').evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
    assert.ok(size.content > size.height, 'each tree scrolls independently');
  }
  await personalTree.locator('.file-tree').hover();
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => document.querySelector('.space-tree-group .file-tree').scrollTop > 0);
  assert.equal(await teamTree.locator('.file-tree').evaluate(element => element.scrollTop), 0);
  const saved = Number(await divider.getAttribute('aria-valuenow'));
  await page.reload();
  await divider.waitFor();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), saved, 'split survives reload');
  await divider.focus();
  await divider.press('ArrowUp');
  assert.ok(Number(await divider.getAttribute('aria-valuenow')) < saved);
  await divider.press('End');
  assert.ok((await teamTree.boundingBox()).height >= 83, 'drag limits keep team usable');
  await divider.press('Home');
  assert.ok((await personalTree.boundingBox()).height >= 83, 'drag limits keep personal usable');
  const cancelHandle = await divider.boundingBox();
  await page.mouse.move(cancelHandle.x + 30, cancelHandle.y + 3);
  await page.mouse.down();
  await divider.dispatchEvent('pointercancel', { pointerId: 1 });
  const canceled = Number(await divider.getAttribute('aria-valuenow'));
  await page.mouse.move(cancelHandle.x + 30, cancelHandle.y + 70);
  await page.mouse.up();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), canceled, 'canceled drag stops resizing');
  await divider.dblclick();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 50);
  const filter = page.getByRole('combobox', { name: '문서 공간 범위', exact: true });
  await filter.selectOption('personal');
  await teamTree.waitFor({ state: 'hidden' });
  assert.equal(await divider.count(), 0);
  await filter.selectOption('all');
  await divider.waitFor();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 50);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 700));
  const layout = await page.locator('.space-trees').evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight }));
  assert.ok(layout.content <= layout.height + 1, 'small window keeps both regions inside the panel');
  assert.deepEqual(errors, []);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/space-tree-resize.png' });
  console.log('Space tree resize: mouse drag, visible team region, independent scroll, persistence, keyboard, reset, filters, and small window passed.');
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
