import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-new-document-')));
const profile = path.join(root, 'profile'), team = path.join(root, 'Team'), personal = path.join(root, 'Personal');
let app;
try {
  await Promise.all([profile, personal, path.join(team, 'Projects'), path.join(team, 'Projects-old')].map(dir => mkdir(dir, { recursive: true })));
  await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
    vaultRoot: personal, vaults: [personal, team], vaultPurposes: { [personal]: 'personal', [team]: 'team' },
  }));
  await writeFile(path.join(personal, 'Start.md'), '# Start\n');
  await writeFile(path.join(team, 'Projects', 'Original.md'), '# Original\n');
  app = await electron.launch({ args: ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile },
    executablePath: path.resolve('node_modules/electron/dist', process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron' : process.platform === 'win32' ? 'electron.exe' : 'electron') });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  const teamTree = page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true });
  const dialog = page.getByRole('dialog', { name: '새로운 생각 기록하기' });
  const name = dialog.getByRole('textbox', { name: '문서 이름' });
  const submit = dialog.getByRole('button', { name: '문서 만들기' });
  const fromMenu = async locator => {
    await locator.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '새 문서', exact: true }).click();
  };
  const create = async (tree, dir, filename, folder = '') => {
    await name.fill(filename);
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });
    const relative = path.posix.join(folder, filename + '.md');
    await tree.getByTitle(relative, { exact: true }).and(tree.locator('.file-row.selected')).waitFor();
    await page.locator('.tabs .tab.active').filter({ hasText: path.posix.basename(filename) }).waitFor();
    await page.locator('.cm-content[contenteditable="true"]').first().waitFor();
    await access(path.join(dir, relative));
  };
  await personalTree.getByTitle('Start.md', { exact: true }).click();
  for (const [selector, filename] of [['.navigator', '왼쪽에서'], ['.tabbar', '상단에서']]) {
    const button = page.locator(selector).getByRole('button', { name: '새 문서', exact: true });
    assert.equal((await button.innerText()).trim(), '새 문서');
    await button.click();
    await create(personalTree, personal, filename);
  }
  await fromMenu(teamTree.getByTitle('Projects', { exact: true }));
  await dialog.getByText('팀 공유 노트 · Team / Projects', { exact: true }).waitFor();
  await name.fill('Original');
  await submit.click();
  await dialog.getByRole('alert').waitFor();
  assert.equal(await readFile(path.join(team, 'Projects', 'Original.md'), 'utf8'), '# Original\n');
  await create(teamTree, team, '폴더에서', 'Projects');
  await fromMenu(teamTree.getByTitle('Projects/Original.md', { exact: true }));
  await create(teamTree, team, '파일에서', 'Projects');
  await personalTree.getByTitle('Start.md', { exact: true }).click();
  await fromMenu(page.locator('.tab-label').filter({ hasText: '폴더에서' }));
  await create(teamTree, team, '탭에서', 'Projects');
  await fromMenu(personalTree.getByRole('heading'));
  await create(personalTree, personal, '루트에서');
  await fromMenu(teamTree.getByTitle('Projects', { exact: true }));
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
  await create(personalTree, personal, '단축키에서');
  const filter = page.getByRole('combobox', { name: '문서 공간 범위' });
  const sidebar = page.locator('.navigator');
  await filter.selectOption({ label: '팀 공유 노트 · Team' });
  await sidebar.getByRole('button', { name: '새 문서', exact: true }).click();
  await create(teamTree, team, '팀 필터');
  await assert.rejects(access(path.join(personal, '팀 필터.md')), { code: 'ENOENT' });
  await filter.selectOption('personal');
  await sidebar.getByRole('button', { name: /새 문서 만들기/ }).click();
  await create(personalTree, personal, '개인 필터');
  await assert.rejects(access(path.join(team, '개인 필터.md')), { code: 'ENOENT' });

  await filter.selectOption('all');
  const projects = teamTree.getByTitle('Projects', { exact: true });
  const sibling = teamTree.getByTitle('Projects-old', { exact: true });
  await sibling.click();
  await projects.click();
  assert.equal(await projects.getAttribute('aria-expanded'), 'false');
  await fromMenu(projects);
  await name.fill('Nested/Deep/새 노트');
  for (const shortcut of ['Meta+n', 'Control+n']) {
    await page.keyboard.press(shortcut);
    assert.equal(await name.inputValue(), 'Nested/Deep/새 노트');
    await dialog.getByText('팀 공유 노트 · Team / Projects', { exact: true }).waitFor();
  }
  await create(teamTree, team, 'Nested/Deep/새 노트', 'Projects');
  for (const folder of ['Projects', 'Projects/Nested', 'Projects/Nested/Deep']) {
    assert.equal(await teamTree.getByTitle(folder, { exact: true }).getAttribute('aria-expanded'), 'true');
  }

  assert.equal(await sibling.getAttribute('aria-expanded'), 'false');
  await filter.selectOption('personal');
  await filter.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+n' : 'Control+n');
  await dialog.getByText('개인 노트 · Personal', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.tabbar').getByRole('button', { name: '새 문서', exact: true }).click();
  await dialog.getByText('팀 공유 노트 · Team', { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  for (const [button, filename, view] of [['+ Canvas', '설계.canvas', '.canvas-editor'], ['+ Bases', '목록.base', '.bases-view']]) {
    await filter.selectOption('all');
    await teamTree.getByTitle('Projects/Original.md', { exact: true }).click();
    await filter.selectOption('personal');
    await sidebar.getByRole('button', { name: button, exact: true }).click();
    await dialog.getByText('개인 노트 · Personal', { exact: true }).waitFor();
    const extension = path.extname(filename);
    const title = path.basename(filename, extension);
    assert.equal(await name.inputValue(), button.replace('+', '새'));
    await name.fill(title);
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });
    const row = personalTree.getByTitle(filename, { exact: true });
    assert.equal((await row.innerText()).trim(), title);
    await page.locator('.tab.active .tab-label').getByText(title, { exact: true }).waitFor();
    await page.locator('.breadcrumbs').getByText(title, { exact: true }).waitFor();
    await page.locator(view).waitFor();
    await access(path.join(personal, filename));
    await assert.rejects(access(path.join(team, filename)), { code: 'ENOENT' });
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '이름 바꾸기', exact: true }).click();
    const rename = page.getByRole('dialog', { name: '이름 바꾸기' });
    const newName = rename.getByRole('textbox', { name: '새 이름' });
    assert.equal(await newName.inputValue(), title);
    const renamed = title + '.v2';
    await newName.fill(renamed);
    await rename.getByRole('button', { name: '이름 바꾸기' }).click();
    await personalTree.getByRole('button', { name: renamed, exact: true }).waitFor();
    await access(path.join(personal, renamed + extension));
  }
  await page.reload();
  await filter.selectOption('all');
  await teamTree.getByTitle('Projects/Nested/Deep/새 노트.md', { exact: true }).click();
  await page.locator('.cm-content').filter({ hasText: '새 노트' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Verified document creation from sidebar, toolbar, tree and tabs, both vault filters, repeated shortcuts, nested folders, Canvas, Bases and reload.');
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
