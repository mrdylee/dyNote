import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { captureAuditPrompt } from '../core/planner.mjs';
import { prepareRequest } from '../core/copilot.mjs';
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.DYNOTE_PLANNER_OUTPUT || 'output/playwright/planner-capture';
await mkdir(output, { recursive: true });
const fixture = await mkdtemp(`${tmpdir()}/dynote-capture-`), vault = `${fixture}/vault`, profile = `${fixture}/profile`;
await mkdir(vault); await mkdir(profile);
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
const app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ['.'], env: { ...process.env, OPEN_NOTES_DATA: profile } });
const checks = [], errors = [];
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, ipcMain }, auditPrompt) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 960);
    globalThis.captureStatus = { authenticated: false, models: [], error: '' };
    globalThis.captureRequests = [];
    ipcMain.removeHandler('notes:copilot-status');
    ipcMain.handle('notes:copilot-status', () => new Promise(resolve => setTimeout(() => resolve({ ok: true, value: globalThis.captureStatus }), 500)));
    ipcMain.removeHandler('notes:copilot-send');
    ipcMain.handle('notes:copilot-send', (event, args) => {
      globalThis.captureRequests.push(args);
      const items=[{title:'큰 캡처 일정',sourceText:'큰 캡처 일정',start:'2026-11-20',end:'2026-11-21'}];
      const result=args.prompt===auditPrompt?{groups:[{target:'대상 미지정',labels:['큰 캡처 일정'],items}]}:{items};
      setTimeout(() => event.sender.send('notes:copilot-event', { type: 'done', requestId: args.requestId, content: JSON.stringify(result) }), 100);
      return { ok: true, value: { requestId: args.requestId } };
    });
  }, captureAuditPrompt);
  await page.getByRole('button', { name: '개발 플래너', exact: true }).click();
  const upload = page.getByLabel('일정 캡처 파일', { exact: true });
  const small = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 400;
    const x = canvas.getContext('2d'); x.fillStyle = 'white'; x.fillRect(0, 0, 900, 400);
    x.fillStyle = 'black'; x.font = '32px Arial'; x.fillText('Schedule 2026-11-20', 40, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await app.evaluate(async ({ clipboard, ClipboardItem }, base64) => {
    globalThis.capturePreviousClipboard = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(base64, 'base64')], { type: 'image/png' }) })]);
  }, small.toString('base64'));
  await page.getByRole('button', { name: '개발 플래너', exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await page.getByRole('status').filter({ hasText: 'GitHub 연결 후' }).waitFor();
  checks.push('small screenshot pastes immediately after sidebar navigation without focusing planner body');
  await page.getByRole('button', { name: '캡처 닫기', exact: true }).click();
  await page.getByRole('button', { name: '일정 추가', exact: true }).click();
  const title = page.getByLabel('제목', { exact: true });
  await title.fill('입력 중');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  assert.equal(await title.inputValue(), '입력 중');
  assert.equal(await page.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: '닫기 · 변경 취소', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  assert.equal(await page.getByLabel('캡처 검토', { exact: true }).count(), 0);
  await page.getByRole('dialog').getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '파일 목록', exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await page.getByRole('button', { name: '개발 플래너', exact: true }).click();
  assert.equal(await page.getByLabel('캡처 검토', { exact: true }).count(), 0);
  checks.push('image paste leaves text fields and settings unchanged and stops listening after planner closes');
  await upload.setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: small });
  await page.getByRole('status').filter({ hasText: 'GitHub 연결 후' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '일정 인식하기', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.planner-source img').evaluate(el => el.naturalWidth), 900);
  checks.push('unconnected Copilot explicitly explains next step and preserves preview');
  await app.evaluate(() => { globalThis.captureStatus = { authenticated: true, models: [{ id: 'text', name: 'Text only', vision: false }], error: '' }; });
  await upload.setInputFiles({ name: 'text-only.png', mimeType: 'image/png', buffer: small });
  await page.getByRole('alert').filter({ hasText: '이미지 지원 모델' }).waitFor();
  assert.equal((await app.evaluate(() => globalThis.captureRequests)).length, 0);
  checks.push('text-only model explains why recognition cannot start');
  await app.evaluate(() => { globalThis.captureStatus = { authenticated: true, models: [{ id: 'vision', name: 'Fixture vision', vision: true }], error: '' }; });
  await upload.setInputFiles({ name: 'small-vision.png', mimeType: 'image/png', buffer: small });
  await page.getByLabel('추출 제목', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '대상 미지정 원본 대조 확인', exact: true }).check();
  let sent = (await app.evaluate(() => globalThis.captureRequests)).at(-1);
  assert.equal(sent.image.data, small.toString('base64'));
  prepareRequest(sent);
  checks.push('small image remains byte-identical through AI transport');
  const large = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1400;
    const x = canvas.getContext('2d'), pixels = x.createImageData(canvas.width, canvas.height);
    let seed = 42;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + channel] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    x.putImageData(pixels, 0, 0); x.fillStyle = 'white'; x.fillRect(100, 100, 2200, 250);
    x.fillStyle = 'black'; x.font = '48px Arial'; x.fillText('DV Schedule 2026-11-20 to 2026-11-21', 140, 230);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  assert.ok(large.length > 6 * 1024 * 1024 && large.length < 25 * 1024 * 1024);
  await upload.setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: large });
  await page.getByRole('status').filter({ hasText: 'Copilot 연결을 확인' }).waitFor();
  await page.getByLabel('추출 제목', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '대상 미지정 원본 대조 확인', exact: true }).check();
  const requests = await app.evaluate(() => globalThis.captureRequests);
  assert.equal(requests.length, 4);
  sent = requests.at(-1); prepareRequest(sent);
  assert.ok(sent.image.data.length <= 8 * 1024 * 1024);
  const dimensions = await page.evaluate(async image => {
    const bytes = Uint8Array.from(atob(image.data), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: image.mimeType }));
    const result = [bitmap.width, bitmap.height]; bitmap.close(); return result;
  }, sent.image);
  assert.deepEqual(dimensions, [2400, 1400]);
  const sourceUrl = await page.locator('.planner-source img').getAttribute('src');
  const sourcePath = decodeURIComponent(new URL(sourceUrl).pathname.split('/').slice(2).join('/'));
  assert.deepEqual(await readFile(`${vault}/${sourcePath}`), large);
  await page.screenshot({ path: `${output}/large-review.png` });
  checks.push('over-6MB capture preserves exact original and sends bounded full-resolution image');
  await page.getByRole('button', { name: '선택한 1개 등록', exact: true }).click();
  await page.locator('.planner-card').filter({ hasText: '큰 캡처 일정' }).waitFor();
  checks.push('large capture produces review and registered schedule');
  await upload.setInputFiles({ name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) });
  await page.getByRole('alert').filter({ hasText: '25MB' }).waitFor();
  await upload.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
  await page.getByRole('alert').filter({ hasText: /이미지|파일/ }).waitFor();
  assert.equal((await app.evaluate(() => globalThis.captureRequests)).length, 4);
  checks.push('oversize and invalid captures show errors without sending AI requests');
  assert.deepEqual(errors, []);
  await writeFile(`${output}/runtime.json`, JSON.stringify({ checks, errors, originalBytes: large.length, transmittedBytes: Buffer.from(sent.image.data, 'base64').length, dimensions }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await app.evaluate(async ({ clipboard }) => {
    if (globalThis.capturePreviousClipboard) await clipboard.write(globalThis.capturePreviousClipboard);
  }).catch(() => {});
  await app.close();
}
