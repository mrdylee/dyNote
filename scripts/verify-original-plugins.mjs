import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { _electron: electron } = require(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const fixture = await mkdtemp(`${tmpdir()}/dynote-original-plugins-`), vault = `${fixture}/vault`, profile = `${fixture}/profile`;
const output = process.env.DYNOTE_PLUGIN_REPORT || 'output/playwright/original-plugins';
const downloadRoot = process.env.DYNOTE_PLUGIN_DOWNLOADS || `${process.cwd()}/output/playwright/downloaded-plugins/downloads`;
await mkdir(output, { recursive: true }); await mkdir(vault); await mkdir(profile);
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
for (const [path, content] of [['Alpha.md', '# Alpha\n'], ['Beta.md', '# Beta\n'], ['2026-10-15.md', '# Existing date\n']]) await writeFile(`${vault}/${path}`, content);
let app, page; const errors = [], checks = [];
const disk = async (path, predicate) => {
  for (let i = 0; i < 100; i++) { try { const value = await readFile(path, 'utf8'); if (predicate(value)) return value; } catch {} await page.waitForTimeout(50); }
  throw new Error(`Expected file state: ${path}`);
};
const start = async () => {
  const executablePath = process.env.DYNOTE_EXECUTABLE_PATH || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;
  app = await electron.launch({ executablePath, args: process.env.DYNOTE_EXECUTABLE_PATH ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  page = (await app.windows()).find(page => page.url().endsWith('/index.html')) || await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message)); await page.getByRole('button', { name: '명령 팔레트', exact: true }).waitFor();
};
const settings = async () => {
  await page.bringToFront();
  if (!await page.getByRole('dialog', { name: '설정', exact: true }).isVisible()) await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '플러그인', exact: true }).click();
};
const row = id => page.locator(`[data-plugin-id="${id}"]`);
const importFolder = async folder => {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await settings(); await page.getByRole('button', { name: '플러그인 폴더 가져오기' }).click();
};
const pluginPage = async name => {
  for (let i = 0; i < 80; i++) { for (const candidate of await app.windows()) if (candidate.url().endsWith('/plugin.html') && (await candidate.locator('#name').textContent()).startsWith(name)) { candidate.setDefaultTimeout(10000); return candidate; } await page.waitForTimeout(100); }
  throw new Error(`Missing plugin window: ${name}`);
};
const open = async path => {
  await page.bringToFront(); if (await page.getByRole('dialog', { name: '설정', exact: true }).isVisible()) await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '명령 팔레트', exact: true }).click();
  await page.getByRole('textbox', { name: '명령 검색' }).fill('문서로 이동'); await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: '빠른 문서 검색' }).fill(`path:${path}`); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
};
try {
  await start();
  const vaultId = (await page.evaluate(() => window.notes.snapshot())).value.id;
  for (const [id, folder] of [['recent-files-obsidian', 'recent-files-obsidian'], ['calendar', 'calendar-1.5.10']]) {
    await importFolder(`${downloadRoot}/${folder}`); await row(id).getByRole('button', { name: '켜기', exact: true }).click();
    await row(id).getByText('실행 중', { exact: true }).waitFor();
  }
  checks.push('local folder import and original program lifecycle');
  let recent = await pluginPage('Recent Files'), calendar = await pluginPage('Calendar');
  await calendar.locator('#calendar-container').waitFor({ state: 'visible' });
  await calendar.screenshot({ path: `${output}/calendar.png` });
  await open('Alpha.md'); await open('Beta.md');
  await recent.locator('.recent-files-file').filter({ hasText: 'Beta' }).waitFor();
  assert.deepEqual((await recent.locator('.nav-file-title-content').allTextContents()).slice(0, 2), ['Beta', 'Alpha']);
  await disk(`${profile}/plugins/vaults/${vaultId}/recent-files-obsidian.json`, value => JSON.parse(value).recentFiles[0].path === 'Beta.md');
  checks.push('original Recent Files records Dynote file-open events and persists original data');
  await recent.getByRole('button', { name: '플러그인 설정', exact: true }).click();
  const omitted = recent.locator('.setting-item').filter({ hasText: 'Omitted pathname patterns' }).locator('textarea');
  await omitted.fill('^Alpha\\.md$'); await omitted.blur(); await open('Alpha.md');
  await recent.locator('.nav-file-title-content').filter({ hasText: /^Alpha$/ }).waitFor({ state: 'hidden' });
  assert.ok(!(await recent.locator('.nav-file-title-content').allTextContents()).includes('Alpha'));
  await recent.screenshot({ path: `${output}/recent-settings.png` });
  checks.push('original settings UI and exclusion behavior');
  await recent.locator('.recent-files-title').filter({ hasText: /^Beta$/ }).click();
  await page.getByRole('heading', { name: 'Beta', exact: true }).waitFor();
  checks.push('clicking an original Recent Files row opens the document in Dynote');
  await settings(); await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '명령 팔레트', exact: true }).click();
  await page.getByRole('textbox', { name: '명령 검색' }).fill('Recent Files: Open');
  assert.equal(await page.locator('.native-command-results button').count(), 1); await page.keyboard.press('Enter');
  checks.push('original command is available in Dynote command palette');
  await calendar.evaluate(() => window.app.plugins.getPlugin('calendar').view.calendar.$set({ displayedMonth: window.moment('2026-10-01') }));
  const existing = calendar.locator('#calendar-container .day:not(.adjacent-month)').filter({ hasText: /^\s*15\s*$/ });
  // Use the original rendered date buttons; no replacement calendar action.
  await existing.click();
  await page.getByRole('heading', { name: 'Existing date', exact: true }).waitFor();
  await calendar.locator('#calendar-container .day:not(.adjacent-month)').filter({ hasText: /^\s*28\s*$/ }).click();
  await calendar.getByText('File 2026-10-28 does not exist. Would you like to create it?', { exact: true }).waitFor();
  await calendar.getByRole('button', { name: 'Create', exact: true }).click();
  await disk(`${vault}/2026-10-28.md`, value => typeof value === 'string');
  assert.equal(await readFile(`${vault}/2026-10-15.md`, 'utf8'), '# Existing date\n');
  checks.push('original Calendar date click and original confirmation create a real note without overwriting existing note');
  await calendar.screenshot({ path: `${output}/calendar-created.png` });
  for (const plugin of [recent, calendar]) {
    await page.evaluate(() => localStorage.setItem('plugin-isolation-check', 'main-only'));
    const security = await plugin.evaluate(async () => ({ node: typeof require, mainBridge: typeof window.notes, mainStorage: localStorage.getItem('plugin-isolation-check'), wrongAction: await window.pluginBridge.request('shell', {}) }));
    assert.equal(security.node, 'undefined'); assert.equal(security.mainBridge, 'undefined'); assert.equal(security.wrongAction.ok, false);
    assert.equal(security.mainStorage, null);
  }
  checks.push('plugin windows have no Node or main app bridge; unsupported host action rejected');
  await settings(); await row('recent-files-obsidian').getByRole('button', { name: '끄기', exact: true }).click();
  await row('recent-files-obsidian').getByText('꺼짐', { exact: true }).waitFor();
  await page.getByRole('button', { name: '닫기', exact: true }).click(); await page.getByRole('button', { name: '명령 팔레트', exact: true }).click();
  await page.getByRole('textbox', { name: '명령 검색' }).fill('Recent Files: Open'); assert.equal(await page.locator('.native-command-results button').count(), 0); await page.keyboard.press('Escape');
  await settings(); await row('recent-files-obsidian').getByRole('button', { name: '켜기', exact: true }).click(); await row('recent-files-obsidian').getByText('실행 중', { exact: true }).waitFor();
  checks.push('disable unloads window and removes original commands; re-enable loads original plugin again');
  await app.close(); app = null; await start(); await settings();
  await row('recent-files-obsidian').getByText('실행 중', { exact: true }).waitFor(); await row('calendar').getByText('실행 중', { exact: true }).waitFor();
  recent = await pluginPage('Recent Files'); await recent.getByRole('button', { name: '플러그인 설정', exact: true }).click();
  assert.equal(await recent.locator('.setting-item').filter({ hasText: 'Omitted pathname patterns' }).locator('textarea').inputValue(), '^Alpha\\.md$');
  checks.push('restart restores enabled plugins and their original saved settings');
  const unsupported = `${fixture}/unsupported`; await mkdir(unsupported);
  await writeFile(`${unsupported}/manifest.json`, '{"id":"unsupported-test","name":"Unsupported test","version":"1"}');
  await writeFile(`${unsupported}/main.js`, "require('node:fs'); module.exports=class {};\n");
  await importFolder(unsupported); await row('unsupported-test').getByRole('button', { name: '켜기', exact: true }).click();
  await row('unsupported-test').getByText('지원하지 않는 플러그인 모듈: node:fs', { exact: true }).waitFor();
  checks.push('unsupported original imports fail visibly rather than being reported as supported');
  const second = `${fixture}/second-vault`; await mkdir(second); await writeFile(`${second}/Second.md`, '# Second vault\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, second);
  await page.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '보관함', exact: true }).click();
  await page.getByRole('button', { name: '폴더 선택·추가', exact: true }).click();
  await page.getByRole('navigation', { name: '설정 항목' }).getByRole('button', { name: '플러그인', exact: true }).click();
  await row('recent-files-obsidian').getByText('꺼짐', { exact: true }).waitFor();
  await row('calendar').getByText('꺼짐', { exact: true }).waitFor();
  assert.equal((await app.windows()).filter(page => page.url().endsWith('/plugin.html')).length, 0);
  await row('recent-files-obsidian').getByRole('button', { name: '켜기', exact: true }).click();
  const secondRecent = await pluginPage('Recent Files'); await secondRecent.getByRole('button', { name: '플러그인 설정', exact: true }).click();
  assert.equal(await secondRecent.locator('.setting-item').filter({ hasText: 'Omitted pathname patterns' }).locator('textarea').inputValue(), '');
  assert.ok(!(await secondRecent.locator('.nav-file-title-content').allTextContents()).includes('Beta'));
  checks.push('vault change unloads old instances and isolates enabled state, original settings and history');
  const hashes = [];
  for (const [id, folder] of [['recent-files-obsidian', 'recent-files-obsidian'], ['calendar', 'calendar-1.5.10']]) for (const file of ['manifest.json', 'main.js']) {
    const source = await readFile(`${downloadRoot}/${folder}/${file}`), installed = await readFile(`${profile}/plugins/programs/${id}/${file}`); assert.deepEqual(installed, source);
    hashes.push({ id, file, sha256: createHash('sha256').update(source).digest('hex') });
  }
  assert.deepEqual(errors, []);
  const report = { passed: true, platform: process.platform, fixture, checks, hashes, errors, limitations: ['Windows runtime not tested', 'Partial Obsidian API; exact plugin versions only'] };
  await writeFile(`${output}/runtime.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const windows = [];
  if (app) for (const candidate of await app.windows()) {
    windows.push({ url: candidate.url(), text: await candidate.locator('body').innerText().catch(() => '') });
    await candidate.screenshot({ path: `${output}/failure-${windows.length}.png` }).catch(() => {});
  }
  await writeFile(`${output}/failure.json`, JSON.stringify({ fixture, checks, error: error.stack, errors, windows }, null, 2)); throw error;
}
finally { if (app) await app.close(); }
