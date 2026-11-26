import assert from 'node:assert/strict';
import {execFile, execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createReadStream, existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
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
const previousSetup = process.env.DYNOTE_PREVIOUS_WINDOWS_SETUP;
const previousVersion = process.env.DYNOTE_PREVIOUS_WINDOWS_VERSION;
assert.equal(Boolean(previousSetup), Boolean(previousVersion));
const appDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Dynote');
const installed = path.join(appDir, 'Dynote.exe');
const uninstaller = path.join(appDir, 'unins000.exe');
const shortcut = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Dynote.lnk');
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{FFECFC28-FC48-449A-8E3F-3D6E554E38E1}_is1';
const uninstallEntry = async () => (await run('reg.exe', ['query', uninstallKey]).catch(error => {
  if (error.code !== 1) throw error;
}))?.stdout;
assert.ok(!existsSync(appDir) && !existsSync(shortcut) && !await uninstallEntry(), 'Use a Windows test profile without a Dynote installation.');

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-installer-')));
const profile = path.join(root, 'Open Notes');
const vault = path.join(root, 'Vault');
const downloads = path.join(root, 'Downloads');
await Promise.all([vault, downloads, path.join(profile, 'updates')].map(dir => mkdir(dir, {recursive: true})));
const note = path.join(vault, 'Keep.md');
const original = '# Note from the ZIP installation\n\nPreserve this note.\n';
await writeFile(note, original);
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({vaultRoot: vault, vaultPurposes: {[vault]: 'personal'}}));
await writeFile(path.join(profile, 'updates', 'settings.json'), JSON.stringify({preferences: {enabled: false, autoInstall: false, includePrerelease: version.includes('-'), downloadDirectory: downloads}}));
const launch = async (executable, verify) => {
  console.log('Opening installer test app:', executable);
  const app = await electron.launch({executablePath: executable, env: {...process.env, OPEN_NOTES_DATA: profile}});
  const child = app.process();
  child.stderr.on('data', data => process.stderr.write(data));
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
    console.log('PASS app opened the preserved note and update preferences');
    await verify?.(app, page);
  } catch (error) {
    console.error('Installer app verification failed:', error);
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      let timer;
      try {
        await Promise.race([app.close(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Installer test app did not close within 15 seconds.')), 15000);
        })]);
      } catch (error) {
        child.kill();
        throw error;
      } finally { clearTimeout(timer); }
    }
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, 'exit', {signal: AbortSignal.timeout(15000)});
    }
  }
};
const runSetup = async (file, step, options = []) => {
  const log = path.join(root, step + '.log');
  console.log(`Running Windows installer check: ${step}`);
  try {
    execFileSync(file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${log}`, ...options],
      {stdio: 'ignore', timeout: 180000});
  } catch (error) {
    const details = await readFile(log, 'utf8').catch(() => '');
    console.error(details.trimEnd().split(/\r?\n/).slice(-20).join('\n'));
    throw error;
  }
  return log;
};
const install = async (file, step) => {
  // The test closes Electron first, so Setup does not need to enlist Restart Manager.
  const log = await runSetup(file, step, ['/NOCLOSEAPPLICATIONS']);
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
  await runSetup(uninstaller, 'uninstall');
  for (let i = 0; i < 60 && (existsSync(installed) || existsSync(shortcut) || await uninstallEntry()); i++) await delay(1000);
  assert.ok(!existsSync(installed) && !existsSync(shortcut) && !await uninstallEntry(), 'Uninstall should remove the app, shortcut and uninstall registration.');
};
try {
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  await run(tar, ['-xf', base + '.zip', '-C', root], {timeout: 180000});
  const portable = path.join(root, 'Dynote-win32-x64', 'Dynote.exe');
  await launch(portable);
  console.log('PASS ZIP app opened the existing note and settings');
  await install(previousSetup || setup, 'install');
  const installedAsar = path.join(appDir, 'resources', 'app.asar');
  const packageHash = await hash(path.join(path.dirname(portable), 'resources', 'app.asar'));
  if (!previousSetup) assert.equal(await hash(installedAsar), packageHash);

  const updateVersion = previousSetup ? version : '99.0.0';
  const tag = `v${updateVersion}`;
  const name = `Dynote-${updateVersion}-windows-x64-Setup.exe`;
  const digest = 'sha256:' + await hash(setup);
  const size = (await stat(setup)).size;
  const internalManifest = JSON.parse(await readFile(path.join(distribution, 'latest.json'), 'utf8'));
  assert.deepEqual(internalManifest, {version, name:path.basename(setup), size, sha256:digest.slice(7)});
  const asset = assetName => ({name: assetName, size, digest, browser_download_url: `https://github.com/mrdylee/dyNote/releases/download/${tag}/${assetName}`});
  const feed = [{tag_name: tag, assets: [asset(`Dynote-${updateVersion}-windows-x64.zip`), asset(name)]}];
  let downloaded;
  let installerJob, installingPid;
  let recoveryDraft, documentDraft;
  const stickyPath = '포스트잇/Upgrade.md';
  const stickyText = 'Keep this open Sticky Note through the Windows update.';
  await mkdir(path.join(vault, '포스트잇'), {recursive: true});
  await writeFile(path.join(vault, stickyPath), 'Before update');
  const previousRuns = new Set((await readFile(path.join(profile, 'startup.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line).run));
  await launch(installed, async (app, page) => {
    assert.equal(await app.evaluate(({app}) => app.getVersion()), previousVersion || version);
    const draftId = randomUUID();
    ({recoveryDraft, documentDraft} = await page.evaluate(async id => {
      const snapshot = await window.notes.snapshot({});
      if (!snapshot.ok) throw new Error(snapshot.error);
      const {id: vaultId, notes} = snapshot.value;
      const note = notes.find(item => item.path === 'Keep.md');
      const content = note.content + '\nPending Agent draft before upgrade.\n';
      const draft = {path: note.path, kind: 'edit', original: note.content, content, aiContent: content, revision: note.revision, userEdited: false};
      const key = `dynote.copilot.drafts.${vaultId}`;
      localStorage.setItem(key, JSON.stringify([draft]));
      const saved = await window.notes.writeDocumentDraft({id, vaultId,
        source: {path: note.path, title: 'Keep', content: note.content},
        content: '# Pending generated document\n', fileName: 'Pending document', promptId: 'default'});
      if (!saved.ok) throw new Error(saved.error);
      return {recoveryDraft: {key, draft}, documentDraft: saved.value};
    }, draftId));
    await page.reload();
    const row = page.locator('.file-row[title="Keep.md"]');
    if (!await row.isVisible()) await page.getByRole('button', {name: '파일 목록', exact: true}).click();
    await row.click();
    await page.getByLabel('AI 실시간 변경', {exact: true}).waitFor();
    console.log('PASS existing installation opened with an unconfirmed Agent draft and a saved temporary document');
    assert.equal(await readFile(note, 'utf8'), original);
    installingPid = await app.evaluate(() => process.pid);
    await app.evaluate(({shell, dialog}, {feed, name, setup}) => {
      shell.showItemInFolder = file => {globalThis.shownUpdate = file;};
      dialog.showErrorBox = (title, message) => console.error('Installer app error:', title, message);
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
    await updates.getByRole('button', {name: '지금 설치하고 다시 시작', exact: true}).waitFor();
    downloaded = await updates.getByLabel('다운로드된 업데이트 파일', {exact: true}).inputValue();
    assert.equal(path.dirname(downloaded).toLowerCase(), downloads.toLowerCase());
    assert.ok(downloaded.endsWith(name));
    assert.equal('sha256:' + await hash(downloaded), digest);
    console.log('PASS installed app downloaded and verified Setup');
    await reveal.click();
    await page.waitForFunction(() => !document.querySelector('.update-settings input[type="checkbox"]')?.disabled);
    assert.equal(await app.evaluate(() => globalThis.shownUpdate), downloaded);
    const opened = app.waitForEvent('window', {timeout: 15000});
    const result = await page.evaluate(async path => {
      const snapshot = await window.notes.snapshot({});
      return window.notes.openSticky({vaultId: snapshot.value.id, path});
    }, stickyPath);
    assert.equal(result.ok, true, result.error);
    const card = await opened;
    await card.getByRole('textbox', {name: 'Sticky Note 메모'}).fill(stickyText);
    assert.equal(await (await app.browserWindow(card)).evaluate(win => win.isVisible()), true);
    await page.bringToFront();
    let installButton = '지금 설치하고 다시 시작';
    if (!previousSetup) {
      await app.evaluate(({dialog}, file) => {
        dialog.showOpenDialog = async () => ({canceled:false, filePaths:[file]});
        globalThis.fetch = async () => { throw new Error('Offline installer test'); };
      }, downloaded);
      await updates.getByLabel('업데이트 배포처').selectOption('local');
      await updates.getByRole('button', {name:'Setup.exe 선택'}).click();
      await page.waitForFunction(file => document.querySelector('.update-settings input[readonly]')?.value === file, downloaded);
      installButton = '설치하고 다시 시작';
      console.log('Selected the local Setup with updater network requests blocked');
    }
    const exited = once(app.process(), 'exit', {signal: AbortSignal.timeout(60000)});
    console.log('Requesting installation and waiting for the app to exit');
    await updates.getByRole('button', {name: installButton, exact: true}).click();
    await exited;
    installerJob = JSON.parse(await readFile(path.join(profile, 'updates', 'settings.json'), 'utf8')).installation.directory;
  });
  console.log('PASS installed app verified Setup, saved work and exited for installation');

  // The controlled feed serves the candidate Setup to the previous installation.
  let restarted;
  for (let i = 0; i < 180 && !restarted; i++) {
    await delay(1000);
    const entries = (await readFile(path.join(profile, 'startup.log'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    restarted = entries.find(entry => !previousRuns.has(entry.run) && Number(entry.run.split(':').at(-1)) !== installingPid && entry.stage === 'main.services-ready');
  }
  assert.ok(restarted, 'Installer helper should relaunch the installed app and finish startup.');
  assert.equal(restarted.version, version, 'The automatically relaunched process must run the candidate version.');
  assert.equal((await readFile(path.join(vault, stickyPath), 'utf8')).trimEnd(), stickyText);
  console.log('PASS Windows update with open Sticky Note: %s -> %s, memo preserved', previousVersion || version, restarted.version);
  // Only this test's newly relaunched process is stopped, after verifying its executable.
  await run(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', '$fixtureProcess = Get-Process -Id ([int]$env:DYNOTE_TEST_PID); if ($fixtureProcess.Path -ne $env:DYNOTE_TEST_EXE) { throw "Unexpected executable" }; Stop-Process -InputObject $fixtureProcess'], {env: {...process.env, DYNOTE_TEST_PID: restarted.run.split(':').at(-1), DYNOTE_TEST_EXE: installed}});
  if (previousSetup) {
    assert.ok(!existsSync(installerJob), 'Startup in the target version should remove the completed installation job.');
  } else {
    const result = JSON.parse((await readFile(path.join(installerJob, 'result.json'), 'utf8')).replace(/^\uFEFF/, ''));
    assert.equal(result.installed, true, result.error);
  }
  assert.equal(await readFile(note, 'utf8'), original);
  assert.equal(await hash(installedAsar), packageHash);
  console.log('PASS in-app install ran Setup, relaunched the app, preserved notes and matched the package payload');

  await install(downloaded, 'reinstall');
  console.log('PASS reinstall completed from the downloaded Setup');
  await launch(installed, async (app, page) => {
    assert.equal(await app.evaluate(({app}) => app.getVersion()), version);
    const savedDrafts = await page.evaluate(async key => ({
      recovery: JSON.parse(localStorage.getItem(key)),
      document: (await window.notes.documentDrafts()).value,
    }), recoveryDraft.key);
    assert.deepEqual(savedDrafts.recovery, [recoveryDraft.draft]);
    assert.deepEqual(savedDrafts.document, [documentDraft]);
    await app.evaluate(({ipcMain}) => {
      ipcMain.removeHandler('notes:copilot-status');
      ipcMain.handle('notes:copilot-status', () => ({ok: true, value: {authenticated: true, models: [{id: 'auto', name: 'Auto'}]}}));
      ipcMain.removeHandler('notes:copilot-send');
      ipcMain.handle('notes:copilot-send', (event, args) => {
        globalThis.upgradeAgentRequest = args;
        event.sender.send('notes:copilot-event', {type: 'done', requestId: args.requestId, content: 'Agent works after upgrade'});
        return {ok: true};
      });
    });
    await page.getByRole('tab', {name: 'Copilot', exact: true}).click();
    await page.getByRole('button', {name: 'Copilot 연결 상태 확인', exact: true}).click();
    const composer = page.locator('.copilot-panel:visible');
    await composer.getByLabel('Copilot 모델').selectOption('auto');
    await composer.getByLabel('Copilot 작업').selectOption('agent');
    await composer.getByLabel('Copilot 질문').fill('Check whether the current draft is available.');
    await composer.getByRole('button', {name: 'Copilot 보내기', exact: true}).click();
    await composer.getByText('Agent works after upgrade', {exact: true}).waitFor();
    const request = await app.evaluate(() => globalThis.upgradeAgentRequest);
    assert.equal(request.mode, 'agent');
    assert.equal(request.context.content, recoveryDraft.draft.content);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), recoveryDraft.key), [recoveryDraft.draft]);
    assert.equal(await readFile(note, 'utf8'), original);
  });
  console.log('PASS updated app sent Agent using the same unconfirmed draft and retained both drafts and the original note');
  if (process.env.DYNOTE_OFFICE_PIPE) {
    const result = await run(process.execPath, ['scripts/verify-office-preview.mjs'], {
      env: {...process.env, DYNOTE_EXECUTABLE: installed}, timeout: 240000,
    });
    console.log(result.stdout);
  }
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
