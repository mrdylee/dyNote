import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const root = await realpath(await mkdtemp(path.join(tmpdir(), 'dynote-together-')));
const profile = path.join(root, 'profile');
const personal = path.join(root, 'Personal');
const team = path.join(root, 'Team');
const same = '회의록.md';
const original = '# 회의록\n\n공통 시작\n';
const pdf = await readFile('tests/fixtures/link-target.pdf');
const checks = [];
const errors = [];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

for (const directory of [profile, personal, team]) await mkdir(directory);
await writeFile(path.join(profile, 'settings.json'), JSON.stringify({
  vaultRoot: personal,
  vaults: [personal, team],
  vaultPurposes: { [personal]: 'personal', [team]: 'team' },
}));
for (const directory of [personal, team]) {
  await writeFile(path.join(directory, same), original);
  await writeFile(path.join(directory, 'manual.pdf'), pdf);
}
await writeFile(path.join(team, '계획.md'), '# 계획\n');
await writeFile(path.join(team, '넷째.md'), '# 넷째\n');
await writeFile(path.join(personal, '참고.md'), '# 참고\n개인 참고 본문\n');
await writeFile(path.join(team, '참고.md'), '# 참고\n팀 참고 본문\n');

const launch = () => electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve("node_modules/electron/dist", process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron"),
  args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'],
  env: { ...process.env, OPEN_NOTES_DATA: profile },
});
let app;
try {
  app = await launch();
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '개인·팀 함께 보기', exact: true }).click();
  const personalTree = page.getByRole('region', { name: '개인 노트 · Personal', exact: true });
  const teamTree = page.getByRole('region', { name: '팀 공유 노트 · Team', exact: true });
  await personalTree.waitFor();
  await teamTree.waitFor();
  await personalTree.getByRole('button', { name: '회의록', exact: true }).click();
  const panes = page.locator('.document-pane');
  const personalPane = panes.filter({ hasText: '개인 노트 · Personal' });
  const teamPane = panes.filter({ hasText: '팀 공유 노트 · Team' }).filter({ has: page.locator('.pane-heading').getByText(same, { exact: true }) });
  const dragToSide = async (source, target, side = 'right') => {
    const box = await target.boundingBox();
    assert.ok(box, 'drop target is visible');
    await source.dragTo(target, { targetPosition: { x: side === 'right' ? box.width - 12 : 12, y: 28 } });
  };
  await dragToSide(teamTree.getByRole('button', { name: '회의록', exact: true }), personalPane);
  await teamPane.waitFor();
  assert.equal(await panes.count(), 2);
  await dragToSide(teamTree.getByRole('button', { name: '계획', exact: true }), teamPane);
  await panes.nth(2).waitFor();
  assert.equal(await panes.count(), 3);
  await dragToSide(teamTree.getByRole('button', { name: '넷째', exact: true }), panes.last());
  assert.equal(await panes.count(), 3);
  checks.push('real mouse drag opens two and three panes across vaults, with a limit of three');

  const editor = pane => pane.getByRole('textbox', { name: 'Markdown 편집기' });
  const replace = async (pane, value) => {
    await editor(pane).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.insertText(value);
  };
  let personalText = '# 회의록\n\n개인 기록만\n';
  let teamText = '# 회의록\n\n팀 기록만\n\n[[참고]]\n';
  await replace(personalPane, personalText);
  await replace(teamPane, teamText);
  await page.keyboard.press(`${modifier}+s`);
  await page.locator('.save-status.saved').waitFor();
  assert.equal(await readFile(path.join(personal, same), 'utf8'), personalText);
  assert.equal(await readFile(path.join(team, same), 'utf8'), teamText);
  const registry = JSON.parse(await readFile(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(registry.vaultRoot, personal, 'document focus does not change the selected root');
  checks.push('same path and same initial revision save to distinct vaults after focus changes');

  const filter = page.getByRole('combobox', { name: '문서 공간 범위', exact: true });
  await filter.selectOption({ label: '개인 노트' });
  await teamTree.waitFor({ state: 'hidden' });
  assert.equal(await panes.count(), 3);
  await page.getByRole('button', { name: '전체 검색', exact: true }).click();
  await page.getByRole('textbox', { name: '전체 문서 검색', exact: true }).fill('팀 기록만');
  assert.equal(await page.locator('.search-result').count(), 0);
  await filter.selectOption({ label: '전체 공간' });
  await page.getByRole('textbox', { name: '전체 문서 검색', exact: true }).fill('path:회의록.md');
  assert.equal(await page.locator('.search-result').count(), 2);
  await page.getByRole('textbox', { name: '전체 문서 검색', exact: true }).fill('팀 기록만');
  const result = page.locator('.search-result').filter({ hasText: '팀 공유 노트 · Team' });
  await result.click();
  assert.equal(await teamPane.locator('.cm-content').innerText().then(text => text.includes('팀 기록만')), true);
  assert.equal(await panes.count(), 3);
  checks.push('space filters preserve open panes and search resolves the result in its own vault');

  const personalId = await personalPane.getAttribute('data-vault-id');
  const teamId = await teamPane.getAttribute('data-vault-id');
  const refused = await page.evaluate(async ({ teamId, same }) => {
    const args = { vaultId: teamId, path: same, content: 'INVALID', revision: '' };
    return [
      await window.notes.createNote({ vaultId: teamId, path: 'stale.md', content: 'INVALID' }),
      await window.notes.saveNote({ ...args, vaultId: '0000000000000000', workspace: true }),
      await window.notes.readAttachment({ vaultId: teamId, workspace: true, path: '../Personal/회의록.md' }),
    ];
  }, { teamId, same });
  assert.ok(refused.every(result => result.ok === false));
  checks.push('scoped access rejects unknown vault IDs, legacy stale-vault writes and path traversal');

  await page.getByRole('button', { name: '읽기 보기', exact: true }).click();
  assert.equal(await personalPane.locator('.cm-live-preview').count(), 1);
  await teamPane.getByRole('link', { name: '참고', exact: true }).click();
  const linked = page.getByRole('region', { name: '문서 참고.md', exact: true });
  await linked.waitFor();
  assert.equal(await linked.getAttribute('data-vault-id'), teamId);
  assert.match(await linked.innerText(), /팀 참고 본문/);
  await page.locator('.tab-label').filter({ hasText: '팀 공유 노트 · Team' }).filter({ hasText: '회의록' }).click();
  await page.getByRole('button', { name: 'Live Preview', exact: true }).click();
  checks.push('links inside the team pane resolve the team file with the same relative path');

  await editor(teamPane).click();
  await editor(teamPane).evaluate(async element => {
    const canvas = document.createElement('canvas');
    canvas.width = 24; canvas.height = 16;
    const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      if (this.name === 'scope-fixture.png') {
        await new Promise(resolve => { window.finishScopePaste = resolve; });
        File.prototype.arrayBuffer = original;
      }
      return original.call(this);
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([image], 'scope-fixture.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await page.waitForFunction(() => typeof window.finishScopePaste === 'function');
  await editor(personalPane).click();
  await page.evaluate(() => window.finishScopePaste());
  const embedded = teamPane.locator('img.cm-live-image');
  await embedded.waitFor();
  await page.waitForFunction(id => [...document.querySelectorAll('img.cm-live-image')].some(img => img.src.includes(`notes://vault/${id}/`) && img.naturalWidth === 24), teamId);
  await page.keyboard.press(`${modifier}+s`);
  await page.locator('.save-status.saved').waitFor();
  teamText = await readFile(path.join(team, same), 'utf8');
  const imagePath = teamText.match(/!\[\[([^\]]+\.png)\]\]/)?.[1];
  assert.ok(imagePath);
  assert.ok((await readFile(path.join(team, imagePath))).length > 0);
  await assert.rejects(readFile(path.join(personal, imagePath)), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(personal, same), 'utf8'), personalText);
  checks.push('an image paste finishes in its originating vault after focus moves and renders from that vault');

  const separator = page.getByRole('separator', { name: '문서 영역 너비' }).first();
  const boundary = await separator.boundingBox();
  const width = (await personalPane.boundingBox()).width;
  await page.mouse.move(boundary.x + boundary.width / 2, boundary.y + 100);
  await page.mouse.down();
  await page.mouse.move(boundary.x + boundary.width / 2 + 38, boundary.y + 100, { steps: 5 });
  await page.mouse.up();
  assert.ok((await personalPane.boundingBox()).width > width + 20);
  checks.push('dragging the separator resizes the pane with the matching vault and path');

  await page.getByRole('button', { name: '개인·팀 함께 보기', exact: true }).click();
  await page.getByRole('tab', { name: '문서 정보', exact: true }).click();
  await mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/vault-together.png' });
  await page.getByRole('tab', { name: 'AI 채팅', exact: true }).click();

  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('notes:copilot-status');
    ipcMain.handle('notes:copilot-status', () => ({ ok: true, value: { authenticated: true, login: 'fixture', models: [{ id: 'together-fixture', name: 'Fixture' }] } }));
    ipcMain.removeHandler('notes:copilot-send');
    ipcMain.handle('notes:copilot-send', (event, args) => {
      globalThis.togetherAiRequest = args;
      globalThis.finishTogetherAi = () => event.sender.send('notes:copilot-event', {
        type: 'done', requestId: args.requestId, content: args.context.content.replace('개인 기록만', '개인 수정안'),
      });
      return { ok: true, value: { requestId: args.requestId } };
    });
  });
  const chat = page.getByRole('region', { name: 'Copilot 채팅', exact: true });
  await chat.getByRole('button', { name: 'Copilot 연결 상태 확인', exact: true }).click();
  await chat.getByLabel('Copilot 모델', { exact: true }).selectOption('together-fixture');
  await chat.getByLabel('Copilot 작업', { exact: true }).selectOption('edit');
  await chat.getByLabel('Copilot 질문', { exact: true }).fill('이 문장을 검토해 줘');
  await chat.getByRole('button', { name: 'Copilot 보내기', exact: true }).click();
  const request = await app.evaluate(() => globalThis.togetherAiRequest);
  assert.equal(request.vaultId, personalId);
  assert.equal(request.context.content, personalText);
  assert.doesNotMatch(JSON.stringify(request), /팀 기록만/);
  await editor(teamPane).click();
  await app.evaluate(() => globalThis.finishTogetherAi());
  assert.equal(await chat.getByRole('button', { name: '변경 내용 확인', exact: true }).count(), 0);
  assert.equal(await readFile(path.join(personal, same), 'utf8'), personalText);
  await editor(personalPane).click();
  await chat.getByRole('button', { name: '변경 내용 확인', exact: true }).click();
  await chat.getByRole('button', { name: '문서에 적용', exact: true }).click();
  await chat.getByRole('dialog', { name: 'Copilot 수정안 확인', exact: true }).waitFor({ state: 'hidden' });
  personalText = personalText.replace('개인 기록만', '개인 수정안');
  assert.equal(await readFile(path.join(personal, same), 'utf8'), personalText);
  assert.equal(await readFile(path.join(team, same), 'utf8'), teamText);
  checks.push('a deterministic AI reply remains in the requesting vault after focus moves');

  const concurrentTeamEdit = teamText + '\n팀 초안\n';
  const concurrentPersonalEdit = personalText + '\n개인 추가 기록\n';
  const externalTeamText = teamText + '\n외부에서 편집함\n';
  await writeFile(path.join(team, same), externalTeamText);
  try {
    await replace(teamPane, concurrentTeamEdit);
    await replace(personalPane, concurrentPersonalEdit);
    await page.keyboard.press(`${modifier}+s`);
    await page.locator('.save-status.error').waitFor();
    assert.equal(await readFile(path.join(team, same), 'utf8'), externalTeamText);
    assert.equal(await readFile(path.join(personal, same), 'utf8'), concurrentPersonalEdit);
  } finally {
    await writeFile(path.join(team, same), teamText);
    await page.getByRole('button', { name: '저장 재시도', exact: true }).click();
    await page.locator('.save-status.saved').waitFor();
  }
  personalText = concurrentPersonalEdit;
  teamText = concurrentTeamEdit;
  assert.equal(await readFile(path.join(team, same), 'utf8'), teamText);
  checks.push('a revision conflict in the team vault does not prevent personal saves or erase the team draft');

  await panes.last().getByRole('button', { name: /영역 닫기/ }).click();
  assert.equal(await panes.count(), 2);
  await teamPane.getByRole('button', { name: `${same} 영역 닫기`, exact: true }).click();
  assert.equal(await panes.count(), 1);
  checks.push('closing panes returns to two and one pane');

  await app.close();
  app = await launch();
  const restarted = await app.firstWindow();
  await restarted.getByRole('button', { name: '개인·팀 함께 보기', exact: true }).click();
  await restarted.getByRole('region', { name: '개인 노트 · Personal', exact: true }).waitFor();
  await restarted.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).waitFor();
  assert.equal(await readFile(path.join(personal, same), 'utf8'), personalText);
  assert.equal(await readFile(path.join(team, same), 'utf8'), teamText);
  await restarted.getByRole('region', { name: '팀 공유 노트 · Team', exact: true }).getByRole('button', { name: '회의록', exact: true }).click();
  await restarted.locator('.attachments-list').getByRole('button', { name: 'manual.pdf', exact: true }).click();
  await restarted.locator('.attachment-view').waitFor();
  await restarted.getByRole('button', { name: '공간 전환·관리', exact: true }).click();
  const settings = restarted.getByRole('dialog', { name: '설정', exact: true });
  const registeredTeam = settings.getByRole('listitem').filter({ hasText: team });
  await registeredTeam.getByRole('button', { name: '목록에서 제거', exact: true }).click();
  await registeredTeam.waitFor({ state: 'hidden' });
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal(await restarted.locator('.attachment-view').count(), 0, 'disconnect closes the team preview even with an identical personal PDF');
  const revoked = await restarted.evaluate(vaultId => window.notes.snapshot({ vaultId, workspace: true }), teamId);
  assert.equal(revoked.ok, false);
  assert.deepEqual(await readFile(path.join(personal, 'manual.pdf')), pdf);
  assert.deepEqual(await readFile(path.join(team, 'manual.pdf')), pdf);
  assert.deepEqual(errors, []);
  checks.push('both roots survive restart; disconnect closes the team PDF and revokes access without changing either copy');
  await writeFile('output/playwright/vault-together.json', JSON.stringify({ checks, errors }, null, 2) + '\n');
  console.log({ checks, errors });
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
