const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const profile = await mkdtemp(`${tmpdir()}/dynote-codex-ui-`);
const vaultRoot = `${profile}/vault`;
await mkdir(vaultRoot);
const original = "# 제목\r\n\r\nselected 원문\r\nlast line";
await writeFile(`${vaultRoot}/Home.md`, original);
await writeFile(`${vaultRoot}/Private.md`, "NEVER_SEND_OTHER_NOTE");
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
await mkdir("output/playwright", { recursive: true });
const report = { checks: [], errors: [], liveModelResponseVerified: false, liveAccountLoginVerified: false };
const app = await electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  report.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, platform: process.platform, electron: process.versions.electron }));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1050, 700); });
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).waitFor();
  await page.getByLabel("AI 서비스").selectOption("codex");
  const status = await page.evaluate(() => window.notes.codexStatus());
  assert.equal(status.ok, true, status.error);
  assert.equal(status.value.authenticated, false);
  await page.getByRole("button", { name: "ChatGPT로 연결", exact: true }).waitFor();
  await page.screenshot({ path: "output/playwright/codex-connect.png" });
  report.checks.push("Electron app discovers native Codex CLI and shows isolated ChatGPT login");

  await app.evaluate(({ ipcMain }) => {
    globalThis.aiRequests = [];
    globalThis.aiAnswer = "Codex 검증 응답";
    globalThis.aiDelay = 60;
    globalThis.aiTimers = new Map();
    for (const provider of ["copilot", "codex"]) {
      ipcMain.removeHandler(`notes:${provider}-status`);
      ipcMain.handle(`notes:${provider}-status`, () => ({ ok: true, value: { authenticated: true, login: `${provider}@fixture.test`, models: [{ id: `${provider}-model`, name: `${provider} test model` }], error: "" } }));
      ipcMain.removeHandler(`notes:${provider}-send`);
      ipcMain.handle(`notes:${provider}-send`, (event, args) => {
        globalThis.aiRequests.push({ provider, ...args });
        const timer = setTimeout(() => {
          event.sender.send(`notes:${provider}-event`, { requestId: args.requestId, type: "done", content: globalThis.aiAnswer });
          globalThis.aiTimers.delete(args.requestId);
        }, globalThis.aiDelay);
        globalThis.aiTimers.set(args.requestId, timer);
        return { ok: true };
      });
      ipcMain.removeHandler(`notes:${provider}-cancel`);
      ipcMain.handle(`notes:${provider}-cancel`, (event, args) => {
        clearTimeout(globalThis.aiTimers.get(args?.requestId));
        event.sender.send(`notes:${provider}-event`, { requestId: args?.requestId, type: "canceled" });
        return { ok: true };
      });
    }
  });
  await page.getByRole("button", { name: "Codex 연결 상태 확인" }).click();
  await page.getByLabel("Codex 모델").selectOption("codex-model");
  await page.locator('.file-row[title="Home.md"]').click();
  await page.getByLabel("Codex 질문").fill("PRIVATE_CODEX_QUESTION");
  await page.getByRole("button", { name: "Codex 보내기" }).click();
  await page.getByText("Codex 검증 응답", { exact: true }).waitFor();
  const first = await app.evaluate(() => globalThis.aiRequests.at(-1));
  assert.equal(first.provider, "codex"); assert.equal(first.context.content, original);
  assert.ok(!JSON.stringify(first).includes("NEVER_SEND_OTHER_NOTE"));

  await page.getByLabel("AI 서비스").selectOption("copilot");
  await page.getByLabel("Copilot 모델").selectOption("copilot-model");
  assert.ok(!(await page.getByRole("log").innerText()).includes("PRIVATE_CODEX_QUESTION"));
  await page.getByLabel("Copilot 전달 범위").selectOption("none");
  await page.getByLabel("Copilot 질문").fill("다른 서비스 질문");
  await app.evaluate(() => { globalThis.aiAnswer = "Copilot 검증 응답"; });
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByText("Copilot 검증 응답", { exact: true }).waitFor();
  const second = await app.evaluate(() => globalThis.aiRequests.at(-1));
  assert.equal(second.provider, "copilot"); assert.deepEqual(second.history, []);
  assert.deepEqual(second.context, { kind: "none" });
  assert.ok(!JSON.stringify(second).includes("PRIVATE_CODEX_QUESTION"));
  report.checks.push("Provider switch clears conversation and context; Copilot receives no Codex dialogue");

  await page.getByLabel("AI 서비스").selectOption("codex");
  await page.getByLabel("Codex 모델").waitFor();
  assert.equal(await page.getByLabel("Codex 모델").inputValue(), "codex-model");
  await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click(); await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown"); await editor.press("ArrowDown"); await editor.press("Home"); await editor.press("Shift+End");
  await page.getByLabel("Codex 전달 범위").selectOption("selection");
  await page.getByLabel("Codex 작업").selectOption("edit");
  await page.getByLabel("Codex 질문").fill("다듬어 줘");
  await app.evaluate(() => { globalThis.aiAnswer = "새 문장\n둘째 줄"; });
  await page.getByRole("button", { name: "Codex 보내기" }).click();
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).click();
  const selected = await app.evaluate(() => globalThis.aiRequests.at(-1));
  assert.equal(selected.context.content, "selected 원문");
  assert.deepEqual(selected.history, []);
  await page.getByRole("button", { name: "문서에 적용", exact: true }).click();
  await page.getByRole("dialog", { name: "Codex 수정안 확인" }).waitFor({ state: "hidden" });
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), "# 제목\r\n\r\n새 문장\r\n둘째 줄\r\nlast line");
  await editor.click(); await editor.press("ControlOrMeta+z");
  await page.waitForFunction(() => document.querySelector(".save-status").classList.contains("saved"));
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), original);
  report.checks.push("Codex uses its saved model, sends selection only, reviews edits and preserves CRLF/undo");

  await page.getByLabel("Codex 작업").selectOption("chat");
  await page.getByLabel("Codex 전달 범위").selectOption("none");
  await page.getByLabel("Codex 질문").fill("중지할 질문");
  await app.evaluate(() => { globalThis.aiDelay = 10000; });
  await page.getByRole("button", { name: "Codex 보내기" }).click();
  assert.equal(await page.getByLabel("AI 서비스").isDisabled(), true);
  await page.getByRole("button", { name: "Codex 응답 중지" }).click();
  await page.getByRole("button", { name: "Codex 보내기" }).waitFor();
  assert.equal(await page.getByLabel("Codex 질문").inputValue(), "중지할 질문");
  report.checks.push("Pending request prevents provider switch; stop retains the question");
  await page.getByLabel("AI 서비스").selectOption("copilot");
  await page.getByLabel("Copilot 모델").waitFor();
  assert.equal(await page.getByLabel("Copilot 모델").inputValue(), "copilot-model");
  await page.getByLabel("AI 서비스").selectOption("codex");
  await page.getByLabel("Codex 모델").waitFor();
  await page.screenshot({ path: "output/playwright/codex-panel.png" });
  const fits = await page.locator(".copilot-composer").evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight);
  assert.equal(fits, true);
  assert.deepEqual(report.errors, []);
  await writeFile("docs/verification/codex-runtime.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
