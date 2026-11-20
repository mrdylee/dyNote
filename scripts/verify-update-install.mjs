import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await mkdtemp(path.join(tmpdir(), 'dynote-auto-update-'));
const profile = path.join(root, 'profile'), vault = path.join(root, 'vault');
let app;
try {
  await mkdir(path.join(profile, 'updates'), { recursive: true }); await mkdir(vault);
  await writeFile(path.join(vault, 'Keep.md'), '# Keep\n');
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ vaultRoot: vault, vaultPurposes: { [vault]: 'personal' } }));
  await writeFile(path.join(profile, 'updates/settings.json'), JSON.stringify({ preferences: { enabled: false } }));
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || (await import('electron')).default, args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '파일 목록', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    globalThis.updateFixture = { installSupported: true, installation: null, phase: 'ready', message: '', preferences: { enabled: true, backgroundDownload: true, autoInstall: true, includePrerelease: false, ignored: [], downloadDirectory: 'C:\\Downloads' }, downloadedPath: 'C:\\Downloads\\Setup.exe', result: { available: true, latest: { tag: 'v99.0.0', name: 'Fixture update', assets: [{ digest: 'test' }] } } };
    globalThis.installRequests = 0; globalThis.closeResponses = [];
    globalThis.sendUpdateFixture = () => BrowserWindow.getAllWindows()[0].webContents.send('notes:update-status', globalThis.updateFixture);
    for (const name of ['update-state', 'update-settings', 'update-install']) ipcMain.removeHandler(`notes:${name}`);
    ipcMain.handle('notes:update-state', () => ({ ok: true, value: globalThis.updateFixture }));
    ipcMain.handle('notes:update-settings', (_event, args) => { Object.assign(globalThis.updateFixture.preferences, args); globalThis.sendUpdateFixture(); return { ok: true, value: globalThis.updateFixture }; });
    ipcMain.handle('notes:update-install', event => {
      globalThis.installRequests++;
      globalThis.updateFixture.phase = 'installing'; globalThis.sendUpdateFixture();
      setTimeout(() => event.sender.send('notes:before-close', { id: 92345, mode: 'quit', updating: true }), 20);
      return { ok: true, value: true };
    });
    ipcMain.on('notes:close-ready', (_event, id, ready) => { if (id === 92345) globalThis.closeResponses.push(ready); });
  });
  await page.reload();
  await page.clock.install();
  const requests = () => app.evaluate(() => globalThis.installRequests);
  const ready = async (changes = {}) => { await app.evaluate(({ }, changes) => { Object.assign(globalThis.updateFixture, { phase: 'ready' }, changes); globalThis.sendUpdateFixture(); }, changes); await page.locator('.classification-notice').filter({ hasText: '다운로드 검증 완료' }).waitFor(); };
  const settings = async () => { await page.getByRole('button', { name: '명령 팔레트', exact: true }).click(); await page.getByRole('textbox', { name: '명령 검색' }).fill('Dynote 업데이트 확인'); await page.keyboard.press('Enter'); };
  await settings();
  await page.getByLabel('자동 설치 및 다시 시작', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('자동 설치 및 다시 시작', { exact: true }).isChecked(), true);
  await page.clock.fastForward(61000); assert.equal(await requests(), 0, 'open settings blocks automatic restart');
  await page.getByLabel('자동 설치 및 다시 시작', { exact: true }).uncheck();
  await page.keyboard.press('Escape'); await page.clock.fastForward(61000); assert.equal(await requests(), 0, 'disabled preference blocks automatic install');
  await settings(); await page.getByLabel('자동 설치 및 다시 시작', { exact: true }).check(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '나중에', exact: true }).click();
  await page.clock.fastForward(61000); assert.equal(await requests(), 0, 'Later defers this session');
  await page.reload(); await page.locator('.classification-notice').filter({ hasText: '다운로드 검증 완료' }).waitFor();
  await page.clock.install();
  await page.getByRole('button', { name: '파일 목록', exact: true }).click();
  await page.locator('.file-row[title="Keep.md"]').click();
  await page.evaluate(() => window.dispatchEvent(new CompositionEvent('compositionstart')));
  await page.clock.fastForward(120000); assert.equal(await requests(), 0, 'unfinished IME composition blocks restart');
  await page.evaluate(() => window.dispatchEvent(new CompositionEvent('compositionend')));
  await page.clock.fastForward(59000); assert.equal(await requests(), 0);
  await page.keyboard.press('ArrowLeft');
  await page.clock.fastForward(59000); assert.equal(await requests(), 0, 'new input resets idle time');
  await page.clock.fastForward(2000);
  // Let native IPC acknowledge the save; no real installer or application quit is invoked.
  for (let i = 0; i < 50 && !(await app.evaluate(() => globalThis.closeResponses.length)); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await requests(), 1);
  assert.deepEqual(await app.evaluate(() => globalThis.closeResponses), [true]);
  await ready({ installation: { tag: 'v99.0.0', error: 'fixture failure' }, message: 'fixture failure' });
  await page.clock.fastForward(120000); assert.equal(await requests(), 1, 'failed version does not retry automatically');
  await page.getByRole('button', { name: '지금 설치하고 다시 시작', exact: true }).click();
  assert.equal(await requests(), 2, 'manual retry is available');
  assert.equal(await readFile(path.join(vault, 'Keep.md'), 'utf8'), '# Keep\n');
  assert.deepEqual(errors, []);
  console.log('PASS: installed update controls, idle timer, input reset, settings hold, auto-install off, Later, save handshake, failed-attempt suppression and manual retry. Installer IPC is controlled; no installed app changed.');
} catch (error) {
  if (app) console.error(await app.evaluate(() => ({ requests: globalThis.installRequests, responses: globalThis.closeResponses, state: globalThis.updateFixture })));
  throw error;
} finally {
  // Real shutdown is covered by verify-windows-installer. This fixture replaces
  // install IPC and sends synthetic close requests, so stop only its own process.
  const child = app?.process();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(10000) });
    child.kill('SIGKILL');
    await exited;
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
console.log('Closed the controlled update UI fixture.');
