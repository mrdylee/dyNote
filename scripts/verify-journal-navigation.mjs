import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../core/vault.mjs';
import { localDate } from '../core/periodic-notes.mjs';

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-journal-navigation-')));
const profile = path.join(root, 'profile'), personal = path.join(root, 'Personal'), team = path.join(root, 'Team');
const personalId = new Vault(personal, profile).id;
const errors = [];
let app;
const launch = profile => electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve('node_modules/electron/dist', process.platform === 'darwin'
    ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile },
});
try {
  await Promise.all([profile, personal, team].map(directory => mkdir(directory)));
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    vaultRoot: team, vaults: [team, personal], vaultPurposes: { [team]: 'team', [personal]: 'personal' },
  }));
  await writeFile(path.join(team, 'Team.md'), '# Team document');
  app = await launch(profile);
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  const rail = page.locator('.rail-nav');
  const journal = rail.getByRole('button', { name: '저널', exact: true });
  const feed = page.getByRole('region', { name: '저널 피드', exact: true });
  const calendar = rail.getByRole('button', { name: '달력과 일지', exact: true });
  await feed.locator(`article[data-vault-id="${personalId}"]`).first().waitFor();
  const todayPath = `Journal/${localDate()}.md`;
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  await personalTree.getByTitle('Journal', { exact: true }).waitFor();
  await personalTree.getByTitle(todayPath, { exact: true }).waitFor();
  assert.equal(await readFile(path.join(personal, todayPath), 'utf8'), `# ${localDate()}\n\n- `);
  await assert.rejects(readFile(path.join(team, todayPath)), { code: 'ENOENT' });
  await journal.waitFor();
  assert.match(await journal.getAttribute('class'), /active/);
  assert.doesNotMatch(await rail.getByRole('button', { name: '파일 목록', exact: true }).getAttribute('class'), /active/);
  await rail.getByRole('button', { name: '파일 목록', exact: true }).click();
  await page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).getByTitle('Team.md', { exact: true }).click();
  await calendar.click();
  await feed.locator(`article[data-vault-id="${personalId}"]`).first().waitFor();
  assert.equal(await feed.locator(`article:not([data-vault-id="${personalId}"])`).count(), 0, 'calendar also keeps journals in personal notes');
  await journal.click();
  await feed.locator(`article[data-vault-id="${personalId}"]`).first().waitFor();
  assert.doesNotMatch(await calendar.getAttribute('class'), /active/);
  assert.match(await journal.getAttribute('class'), /active/);

  const planner = rail.getByRole('button', { name: '개발 플래너', exact: true });
  assert.equal(await planner.locator('svg.lucide-calendar-range').count(), 1);
  assert.equal(await page.getByRole('tab', { name: 'AI 채팅', exact: true }).locator('svg.lucide-message-circle').count(), 1);
  for (const query of ['저널', 'journal', 'JOURNAL']) {
    await rail.getByRole('button', { name: '파일 목록', exact: true }).click();
    await page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).getByTitle('Team.md', { exact: true }).click();
    await calendar.click();
    await rail.getByRole('button', { name: '명령 팔레트', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '명령 팔레트', exact: true });
    await dialog.getByRole('textbox', { name: '명령 검색', exact: true }).fill(query);
    await dialog.getByRole('button', { name: '저널 열기 (Open Journal)', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await feed.locator(`article[data-vault-id="${personalId}"]`).first().waitFor();
    assert.doesNotMatch(await calendar.getAttribute('class'), /active/);
  }
  await rail.getByRole('button', { name: '파일 목록', exact: true }).click();
  await page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).getByTitle('Team.md', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Live Preview', exact: true }).locator('svg.lucide-sparkles').count(), 1);
  await page.evaluate(personalId => localStorage.setItem(`dynote.journal.${personalId}`, JSON.stringify({
    daily: { folder: 'Journal' }, monthly: { folder: 'PersonalMonthly' },
  })), personalId);
  await page.reload();
  for (const [command, file] of [
    ['오늘의 일지 열기 또는 만들기', todayPath],
    ['현재 월간 노트 열기 또는 만들기', `PersonalMonthly/${localDate().slice(0, 7)}.md`],
  ]) {
    await rail.getByRole('button', { name: '파일 목록', exact: true }).click();
    await page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).getByTitle('Team.md', { exact: true }).click();
    await rail.getByRole('button', { name: '명령 팔레트', exact: true }).click();
    await page.getByRole('dialog', { name: '명령 팔레트', exact: true }).getByRole('button', { name: command, exact: true }).click();
    await page.locator(`.document-pane.focused[data-vault-id="${personalId}"][data-document-path="${file}"]`).waitFor();
    assert.ok((await readFile(path.join(personal, file), 'utf8')).startsWith('# '));
    await assert.rejects(readFile(path.join(team, file)), { code: 'ENOENT' });
    await personalTree.getByTitle(file, { exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/journal-navigation.png' });
  await app.close();
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({ vaultRoot: personal, vaults: [personal], vaultPurposes: { [personal]: 'personal' } }));
  app = await launch(profile);
  const single = await app.firstWindow();
  single.setDefaultTimeout(8000);
  single.on('pageerror', error => errors.push(error.message));
  const singleRail = single.locator('.rail-nav');
  await single.getByRole('region', { name: '저널 피드', exact: true }).waitFor();
  await singleRail.getByRole('button', { name: '달력과 일지', exact: true }).click();
  await singleRail.getByRole('button', { name: '파일 목록', exact: true }).click();
  await singleRail.getByRole('button', { name: '저널', exact: true }).click();
  await single.getByRole('region', { name: '저널 피드', exact: true }).waitFor();
  await single.locator('.navigator').getByTitle('Journal', { exact: true }).waitFor();
  await single.locator('.navigator').getByTitle(todayPath, { exact: true }).waitFor();
  assert.match(await singleRail.getByRole('button', { name: '저널', exact: true }).getAttribute('class'), /active/);
  assert.doesNotMatch(await singleRail.getByRole('button', { name: '달력과 일지', exact: true }).getAttribute('class'), /active/);
  assert.doesNotMatch(await singleRail.getByRole('button', { name: '파일 목록', exact: true }).getAttribute('class'), /active/);
  await app.close();
  for (const hasPersonal of [true, false]) {
    const fixture = path.join(root, hasPersonal ? 'unclassified-current' : 'team-only');
    const profile = path.join(fixture, 'profile'), current = path.join(fixture, 'Current'), personal = path.join(fixture, 'Personal');
    await Promise.all([profile, current, personal].map(directory => mkdir(directory, { recursive: true })));
    await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
      vaultRoot: current, vaults: hasPersonal ? [current, personal] : [current],
      vaultPurposes: hasPersonal ? { [personal]: 'personal' } : { [current]: 'team' },
    }));
    app = await launch(profile);
    const page = await app.firstWindow();
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    if (hasPersonal) {
      const id = new Vault(personal, profile).id;
      await page.locator(`.journal-feed article[data-vault-id="${id}"]`).first().waitFor();
      await page.locator('.navigator').getByTitle(todayPath, { exact: true }).waitFor();
      assert.ok((await readFile(path.join(personal, todayPath), 'utf8')).startsWith('# '));
    } else {
      await page.getByRole('heading', { name: '저널은 개인 노트에 저장됩니다', exact: true }).waitFor();
      assert.equal(await page.getByRole('region', { name: '저널 피드', exact: true }).count(), 0);
      await page.screenshot({ path: 'output/playwright/journal-personal-required.png' });
      await page.getByRole('button', { name: '개인 노트 설정', exact: true }).click();
      await page.getByRole('dialog', { name: '설정', exact: true }).getByRole('button', { name: '개인 노트 폴더 연결', exact: true }).waitFor();
    }
    await assert.rejects(readFile(path.join(current, todayPath)), { code: 'ENOENT' });
    await app.close();
    app = null;
  }
  assert.deepEqual(errors, []);
  console.log('Journal navigation: personal-only automatic/calendar/command routing, personal tree, missing-personal guidance, Korean/English commands, and distinct icons passed.');
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
