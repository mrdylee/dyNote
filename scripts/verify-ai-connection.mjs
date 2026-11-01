// Real Electron UI, controlled authentication transport; no credentials or paid inference.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(`${tmpdir()}/dynote-ai-connection-`), profile = `${root}/profile`, vault = `${root}/vault`;
await mkdir(profile); await mkdir(vault); await mkdir("output/playwright", { recursive: true });
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
const app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
const report = { checks: [], errors: [], transport: "controlled IPC authentication, no credentials or inference" };
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(8000); page.on("pageerror", error => report.errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.aiConnection = {};
    const window = BrowserWindow.getAllWindows()[0]; window.setSize(1100, 800);
    for (const provider of ["copilot", "codex", "claude"]) {
      const state = globalThis.aiConnection[provider] = { statusCalls: 0, logins: 0, canceled: 0, authenticated: false, failure: "" };
      const handle = (name, callback) => { ipcMain.removeHandler(`notes:${provider}-${name}`); ipcMain.handle(`notes:${provider}-${name}`, callback); };
      const emit = (phase, message) => window.webContents.send(`notes:${provider}-event`, { type: "auth", phase, message });
      state.emit = emit;
      handle("status", () => { state.statusCalls++; return state.failure ? { ok: false, error: state.failure } : { ok: true, value: { authenticated: state.authenticated, login: state.authenticated ? "fixture" : "", models: state.authenticated ? [{ id: "auto", name: "Auto" }] : [] } }; });
      handle("login", () => { state.logins++; emit("waiting", `${provider} 로그인 대기`); return { ok: true }; });
      handle("cancel-login", () => { state.canceled++; emit("canceled", "로그인 취소"); return { ok: true }; });
    }
  });
  await page.getByRole("region", { name: "저널 피드" }).waitFor();
  const selector = page.getByRole("combobox", { name: "AI 제공자", exact: true });
  await page.getByRole("button", { name: "Copilot 연결 상태 확인", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="AI 제공자"]').disabled);
  for (const [provider, label] of [["codex", "Codex"], ["claude", "Claude"]]) {
    await selector.selectOption(provider);
    const status = page.getByLabel(`${label} 전송 상태`, { exact: true });
    const login = status.getByRole("button", { name: `${label} 로그인`, exact: true });
    await login.waitFor();
    assert.ok(await app.evaluate((_, provider) => globalThis.aiConnection[provider].statusCalls, provider));
    assert.doesNotMatch(await status.innerText(), /ChatGPT/);
    const prompt = page.getByLabel(`${label} 질문`, { exact: true }); await prompt.fill("로그인 후 보낼 질문");
    await login.click();
    await page.getByRole("status").filter({ hasText: `${provider} 로그인 대기` }).waitFor();
    assert.equal(await selector.isDisabled(), true);
    await page.getByRole("button", { name: "로그인 취소", exact: true }).click();
    await login.waitFor();
    assert.equal(await app.evaluate((_, provider) => globalThis.aiConnection[provider].canceled, provider), 1);
    await login.click();
    await app.evaluate((_, provider) => globalThis.aiConnection[provider].emit("error", "로그인 실패 · 다시 시도해 주세요."), provider);
    await page.getByRole("status").filter({ hasText: "로그인 실패" }).waitFor();
    await login.click();
    await app.evaluate((_, provider) => { const state = globalThis.aiConnection[provider]; state.authenticated = true; state.emit("connected", "로그인 완료"); }, provider);
    await page.getByLabel(`${label} 모델`, { exact: true }).waitFor();
    await page.getByLabel(`${label} 전달 범위`, { exact: true }).selectOption("none");
    assert.equal(await page.getByRole("button", { name: `${label} 보내기`, exact: true }).isEnabled(), true);
    await app.evaluate((_, provider) => { globalThis.aiConnection[provider].failure = `${provider} CLI 연결 실패`; }, provider);
    await page.getByRole("button", { name: `${label} 연결 상태 확인`, exact: true }).click();
    await page.waitForFunction(text => document.querySelector("#copilot-send-status")?.textContent.includes(text), `${provider} CLI 연결 실패`);
    assert.equal(await page.getByRole("button", { name: `${label} 보내기`, exact: true }).isDisabled(), true);
    await login.waitFor();
    await app.evaluate((_, provider) => { globalThis.aiConnection[provider].failure = ""; }, provider);
    await status.getByRole("button", { name: "연결 다시 확인", exact: true }).click();
    await page.getByLabel(`${label} 모델`, { exact: true }).waitFor();
    assert.equal(await prompt.inputValue(), "로그인 후 보낼 질문");
    assert.equal(await page.getByRole("button", { name: `${label} 보내기`, exact: true }).isEnabled(), true);
    report.checks.push(`${label}: automatic check, visible login, pending/cancel/error/retry, auth completion, stale auth invalidation, prompt retention`);
  }
  await selector.selectOption("codex");
  await app.evaluate(() => { globalThis.aiConnection.codex.authenticated = false; });
  await page.getByRole("button", { name: "Codex 연결 상태 확인", exact: true }).click();
  await page.getByRole("button", { name: "Codex 로그인", exact: true }).waitFor();
  await page.getByRole("separator", { name: "오른쪽 패널 너비", exact: true }).press("Home");
  const block = page.getByLabel("Codex 전송 상태", { exact: true });
  assert.equal(await block.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await page.screenshot({ path: "output/playwright/ai-connection-login.png" });
  assert.deepEqual(report.errors, []);
  await writeFile("output/playwright/ai-connection.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }
