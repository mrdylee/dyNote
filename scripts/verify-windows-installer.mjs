import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createReadStream, existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';

assert.equal(process.platform, 'win32');
const {_electron: electron} = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const run = promisify(execFile);
const {version} = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const distribution = path.resolve(process.env.DYNOTE_PACKAGE_OUT || `release/v${version}`);
const base = path.join(distribution, `Dynote-${version}-windows-x64`);
const setup = base + '-Setup.exe';
const appDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Dynote');
const installed = path.join(appDir, 'Dynote.exe');
const uninstaller = path.join(appDir, 'unins000.exe');
const shortcut = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Dynote.lnk');
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{FFECFC28-FC48-449A-8E3F-3D6E554E38E1}_is1';
const uninstallEntry = async () => (await run('reg.exe', ['query', uninstallKey]).catch(error => {
  if (error.code !== 1) throw error;
}))?.stdout;
assert.ok(!existsSync(appDir) && !existsSync(shortcut) && !await uninstallEntry(), 'Use a Windows test profile without a Dynote installation.');

const root = await mkdtemp(path.join(tmpdir(), 'dynote-installer-'));
const profile = path.join(root, 'Open Notes');
const vault = path.join(root, 'Vault');
const downloads = path.join(root, 'Downloads');
await Promise.all([vault, downloads, path.join(profile, 'updates')].map(dir => mkdir(dir, {recursive: true})));
const note = path.join(vault, 'Keep.md');
const original = '# Note from the ZIP installation\n\nPreserve this note.\n';
await writeFile(note, original);
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({vaultRoot: vault, vaultPurposes: {[vault]: 'personal'}}));
await writeFile(path.join(profile, 'updates', 'settings.json'), JSON.stringify({preferences: {enabled: false, downloadDirectory: downloads}}));
const launch = async (executable, verify) => {
  const app = await electron.launch({executablePath: executable, env: {...process.env, OPEN_NOTES_DATA: profile}});
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    await page.getByRole('region', {name: '저널 피드'}).waitFor();
    const row = page.locator('.file-row[title="Keep.md"]');
    if (!await row.isVisible()) await page.getByRole('button', {name: '파일 목록', exact: true}).click();
    await row.click();
    await page.getByRole('button', {name: '읽기 보기', exact: true}).click();
    await page.getByText('Preserve this note.', {exact: true}).waitFor();
    assert.equal(await page.evaluate(async () => (await window.notes.updateState()).value.preferences.enabled), false);
    await verify?.(app, page);
  } finally {
    const child = app.process();
    await app.close();
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, 'exit', {signal: AbortSignal.timeout(15000)});
    }
  }
};
const install = async (file, step) => {
  const log = path.join(root, step + '.log');
  await run(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`], {timeout: 480000});
  assert.match(await readFile(log, 'utf8'), /Administrative install mode: No/);
  assert.ok(existsSync(installed) && existsSync(shortcut));
  assert.match(await uninstallEntry(), /DisplayName\s+REG_SZ\s+Dynote\b/);
};
const hash = async file => {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(file)) digest.update(bytes);
  return digest.digest('hex');
};
const uninstall = async () => {
  await run(uninstaller, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${path.join(root, 'uninstall.log')}`], {timeout: 120000});
  for (let i = 0; i < 60 && (existsSync(installed) || existsSync(shortcut) || await uninstallEntry()); i++) await delay(1000);
  assert.ok(!existsSync(installed) && !existsSync(shortcut) && !await uninstallEntry(), 'Uninstall should remove the app, shortcut and uninstall registration.');
};
try {
  await run('tar.exe', ['-xf', base + '.zip', '-C', root], {timeout: 180000});
  const portable = path.join(root, 'Dynote-win32-x64', 'Dynote.exe');
  await launch(portable);
  console.log('PASS ZIP app opened the existing note and settings');
  await install(setup, 'install');
  assert.equal(await hash(path.join(appDir, 'resources', 'app.asar')), await hash(path.join(path.dirname(portable), 'resources', 'app.asar')));
  console.log('PASS per-user install and matching app payload');

  const tag = 'v99.0.0';
  const name = 'Dynote-99.0.0-windows-x64-Setup.exe';
  const digest = 'sha256:' + await hash(setup);
  const size = (await stat(setup)).size;
  const asset = assetName => ({name: assetName, size, digest, browser_download_url: `https://github.com/mrdylee/dyNote/releases/download/${tag}/${assetName}`});
  const feed = [{tag_name: tag, assets: [asset('Dynote-99.0.0-windows-x64.zip'), asset(name)]}];
  let downloaded;
  await launch(installed, async (app, page) => {
    await app.evaluate(({shell}, {feed, name, setup}) => {
      shell.showItemInFolder = file => {globalThis.shownUpdate = file;};
      globalThis.fetch = async url => {
        if (String(url).startsWith('https://api.github.com/')) return Response.json(feed);
        if (!String(url).endsWith('/' + name)) throw new Error('The installed app requested the wrong update asset.');
        const {createReadStream} = process.getBuiltinModule('node:fs');
        const {Readable} = process.getBuiltinModule('node:stream');
        return new Response(Readable.toWeb(createReadStream(setup)));
      };
    }, {feed, name, setup});

    await page.getByRole('button', {name: '명령 팔레트', exact: true}).click();
    await page.getByRole('textbox', {name: '명령 검색'}).fill('Dynote 업데이트 확인');
    await page.keyboard.press('Enter');
    const updates = page.getByRole('region', {name: 'Dynote 업데이트'});
    await updates.getByRole('button', {name: '지금 업데이트 확인', exact: true}).click();
    const reveal = updates.getByRole('button', {name: '설치 파일 위치 열기', exact: true});
    await reveal.waitFor({timeout: 120000});
    await updates.getByText('Dynote를 종료한 다음 받은 Setup.exe를 실행해 업데이트하세요.', {exact: true}).waitFor();
    downloaded = await updates.getByLabel('다운로드된 업데이트 파일', {exact: true}).inputValue();
    assert.equal(path.dirname(downloaded).toLowerCase(), downloads.toLowerCase());
    assert.ok(downloaded.endsWith(name));
    assert.equal('sha256:' + await hash(downloaded), digest);
    await reveal.click();
    await page.waitForFunction(() => !document.querySelector('.update-settings input[type="checkbox"]')?.disabled);
    assert.equal(await app.evaluate(() => globalThis.shownUpdate), downloaded);
  });
  console.log('PASS installed app opened the same note and settings, downloaded Setup and verified SHA-256');

  await install(downloaded, 'reinstall');
  await launch(installed);
  await uninstall();
  assert.equal(await readFile(note, 'utf8'), original);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8')).vaultRoot, vault);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'updates', 'settings.json'), 'utf8')).preferences.enabled, false);
} catch (error) {
  console.error('Windows installer test files:', root, error);
  throw error;
} finally {
  if (existsSync(uninstaller) && await uninstallEntry()) await uninstall();
}
await rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 250});
console.log('PASS Windows per-user install, ZIP profile reuse, matching payload, verified in-app Setup download, reinstall and uninstall preserving notes and settings');
