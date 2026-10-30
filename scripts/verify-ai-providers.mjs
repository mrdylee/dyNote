// Real Electron UI with deterministic provider events; no account or paid inference.
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(`${tmpdir()}/dynote-providers-`), profile = `${root}/profile`, vault = `${root}/vault`;
await mkdir(profile); await mkdir(vault); await mkdir("output/playwright", { recursive: true });
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
await writeFile(`${vault}/Home.md`, "# Home\n원본\n");
const app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
const report = { checks: [], errors: [], inference: "deterministic IPC fixture; no live account or paid model request" };
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on("pageerror", e => report.errors.push(e.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.providerRequests = []; globalThis.providerPending = null;
    BrowserWindow.getAllWindows()[0].setSize(1280, 900);
    for (const provider of ["copilot", "codex", "claude"]) {
      const replace = (action, callback) => { const channel = `notes:${provider}-${action}`; ipcMain.removeHandler(channel); ipcMain.handle(channel, callback); };
      replace("status", () => ({ ok: true, value: { authenticated: true, login: "fixture", models: [{ id: `${provider}-model`, name: `${provider} model` }] } }));
      replace("send", (event, args) => {
        globalThis.providerRequests.push({ provider, ...args }); globalThis.providerPending = { provider, args, sender: event.sender };
        event.sender.send(`notes:${provider}-event`, { type: "delta", requestId: args.requestId, content: "준비 중" });
        return { ok: true, value: { requestId: args.requestId } };
      });
      replace("cancel", event => { const pending = globalThis.providerPending; if (pending) event.sender.send(`notes:${provider}-event`, { type: "canceled", requestId: pending.args.requestId }); return { ok: true }; });
    }
    globalThis.finishProvider = content => { const { provider, args, sender } = globalThis.providerPending; sender.send(`notes:${provider}-event`, { type: "done", requestId: args.requestId, content }); };
  });
  await page.getByRole("region", { name: "저널 피드" }).waitFor();
  await page.keyboard.press("Meta+k"); await page.getByRole("textbox", { name: "빠른 문서 검색" }).fill("path:Home.md"); await page.keyboard.press("Enter");
  const selector = page.getByRole("combobox", { name: "AI 제공자", exact: true });
  await page.getByRole("button", { name: "Copilot 연결 상태 확인", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="AI 제공자"]').disabled);
  for (const [provider, label] of [["codex", "Codex"], ["claude", "Claude"]]) {
    await selector.selectOption(provider);
    await page.getByLabel(`${label} 모델`, { exact: true }).selectOption(`${provider}-model`);
    assert.deepEqual(await page.getByLabel(`${label} 작업`, { exact: true }).locator("option").evaluateAll(options => options.map(x => x.value)), ["chat", "edit"]);
    assert.equal(await page.locator(".copilot-message").count(), 0);
    await page.getByLabel(`${label} 질문`, { exact: true }).fill("요약"); await page.getByRole("button", { name: `${label} 보내기`, exact: true }).click();
    assert.equal(await selector.isDisabled(), true);
    await page.getByRole("button", { name: `${label} 응답 중지`, exact: true }).click();
    await page.getByRole("button", { name: `${label} 보내기`, exact: true }).waitFor();
    await page.getByLabel(`${label} 작업`, { exact: true }).selectOption("edit");
    await page.getByLabel(`${label} 질문`, { exact: true }).fill("문장을 다듬어 줘"); await page.getByRole("button", { name: `${label} 보내기`, exact: true }).click();
    await app.evaluate((_, text) => globalThis.finishProvider(text), `# Home\n${label} 수정안\n`);
    await page.getByRole("button", { name: "변경 내용 확인", exact: true }).waitFor();
    assert.equal(await selector.isDisabled(), true, "Unreviewed proposal blocks provider switch");
    assert.ok(!(await readFile(`${vault}/Home.md`, "utf8")).includes(`${label} 수정안`));
    await page.getByRole("button", { name: "변경 내용 확인", exact: true }).click();
    await page.getByRole("button", { name: "문서에 적용", exact: true }).click();
    await page.getByRole("dialog", { name: `${label} 수정안 확인`, exact: true }).waitFor({ state: "hidden" });
    assert.match(await readFile(`${vault}/Home.md`, "utf8"), new RegExp(`${label} 수정안`));
    report.checks.push(`${label}: isolated conversation, Ask/Edit, cancel, switch guard, explicit reviewed save`);
  }
  await selector.selectOption("codex");
  assert.equal(await page.getByLabel("Codex 모델", { exact: true }).inputValue(), "codex-model");
  assert.equal(await page.locator(".copilot-message").count(), 0);
  await selector.selectOption("copilot");
  assert.ok((await page.getByLabel("Copilot 작업", { exact: true }).locator("option").evaluateAll(options => options.map(x => x.value))).includes("agent"));
  report.checks.push("Per-provider model persistence and clean histories; Copilot Agent preserved");
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: "output/playwright/ai-providers.png" });
  await writeFile("output/playwright/ai-providers.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }
