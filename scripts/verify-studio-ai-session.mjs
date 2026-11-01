// Real Electron UI with synthetic captures and provider transport; no account inference.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { captureAuditPrompt } from "../core/planner.mjs";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await mkdtemp(`${tmpdir()}/dynote-studio-session-`), profile = `${root}/profile`, vault = `${root}/vault`;
await mkdir(profile); await mkdir(vault); await mkdir("output/playwright", { recursive: true });
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: vault }));
await writeFile(`${root}/mcp.json`, JSON.stringify({ mcpServers: { "public-fixture": { command: "not-executed-by-this-UI-test", env: { PRIVATE_FIXTURE: "DO_NOT_RENDER_SECRET" } } } }));
await mkdir(`${root}/public-skills`); await writeFile(`${root}/public-skills/SKILL.md`, "---\nname: public-skill\ndescription: Public fixture\n---\nPUBLIC_SKILL");
const app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
const report = { checks: [], errors: [] };
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(10000); page.on("pageerror", error => report.errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }, auditPrompt) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 960);
    globalThis.studio = { calls: [], hold: false, pending: null, authenticated: true };
    for (const provider of ["copilot", "codex", "claude"]) {
      const handle = (action, callback) => { ipcMain.removeHandler(`notes:${provider}-${action}`); ipcMain.handle(`notes:${provider}-${action}`, callback); };
      handle("status", () => {
        globalThis.studio.calls.push({ provider, action: "status" });
        const effort = provider === "claude" ? {} : { reasoningEfforts: ["low"], defaultReasoningEffort: "low" };
        const secondEffort = provider === "claude" ? {} : { reasoningEfforts: provider === "codex" ? ["low", "ultra"] : ["low", "high"], defaultReasoningEffort: "low" };
        return { ok: true, value: { authenticated: globalThis.studio.authenticated, login: "fixture", models: globalThis.studio.authenticated ? [{ id: "vision-1", name: "Vision 1", vision: true, ...effort }, { id: "vision-2", name: "Vision 2", vision: true, ...secondEffort }, { id: "text", name: "Text only", vision: false }] : [] } };
      });
      handle("login", () => { globalThis.studio.calls.push({ provider, action: "login" }); return { ok: true }; });
      handle("send", (event, args) => {
        globalThis.studio.calls.push({ provider, action: "send", model: args.model, image: !!args.image, ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}) });
        const item = { title: "Synthetic DV", target: "Link", sourceText: "DV", start: "2026-11-20" };
        const result = args.prompt === auditPrompt ? { groups: [{ target: "Link", labels: ["DV"], items: [item] }] } : { items: [item] };
        const done = () => event.sender.send(`notes:${provider}-event`, { type: "done", requestId: args.requestId, content: JSON.stringify(result) });
        globalThis.studio.pending = { provider, args, sender: event.sender, done };
        if (!globalThis.studio.hold) setTimeout(done, 100);
        return { ok: true, value: { requestId: args.requestId } };
      });
      handle("cancel", () => { globalThis.studio.calls.push({ provider, action: "cancel" }); return { ok: true }; });
    }
  }, captureAuditPrompt);
  await page.getByRole("region", { name: "저널 피드" }).waitFor();
  const selector = page.getByLabel("AI 제공자", { exact: true });
  await page.getByRole("button", { name: "Copilot 연결 상태 확인", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="AI 제공자"]').disabled);
  await app.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? `${root}/public-skills` : `${root}/mcp.json`] }); }, root);
  await page.getByText("MCP·스킬", { exact: true }).click();
  await page.getByRole("button", { name: "MCP 설정 연결", exact: true }).click();
  await page.locator('.ai-extensions').getByText('public-fixture', { exact: true }).waitFor();
  await page.getByRole("button", { name: "스킬 폴더 연결", exact: true }).click();
  await page.locator('.ai-extensions').getByText('public-skills', { exact: true }).waitFor();
  assert.ok(!(await page.locator('.ai-extensions').textContent()).includes('DO_NOT_RENDER_SECRET'));
  await page.reload();
  await page.getByRole("region", { name: "저널 피드" }).waitFor();
  await page.getByText("MCP·스킬", { exact: true }).click();
  await page.locator('.ai-extensions').getByText('public-fixture', { exact: true }).waitFor();
  await page.getByRole("button", { name: "mcp.json 연결 해제", exact: true }).click();
  await page.getByRole("button", { name: "public-skills 연결 해제", exact: true }).click();
  await page.getByText("MCP·스킬", { exact: true }).click();
  report.checks.push("Native MCP/skill pickers persist selected sources across reload, omit secret contents, and disconnect from the right panel");
  const image = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 500; canvas.height = 200;
    const context = canvas.getContext("2d"); context.fillStyle = "white"; context.fillRect(0, 0, 500, 200);
    context.fillStyle = "black"; context.fillText("Synthetic DV 2026-11-20", 20, 50);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  const upload = () => page.getByLabel("일정 캡처 파일", { exact: true }).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: image });
  for (const [provider, label] of [["codex", "Codex"], ["claude", "Claude"], ["copilot", "Copilot"]]) {
    await page.getByRole("button", { name: "파일 목록", exact: true }).click();
    await selector.selectOption(provider);
    if (provider !== "claude") assert.equal(await page.getByLabel(`${label} 작업`, { exact: true }).inputValue(), "agent");
    const models = page.getByLabel(`${label} 모델`, { exact: true });
    await models.selectOption("vision-2");
    const effort = provider === "codex" ? "ultra" : "high";
    const reasoning = page.getByLabel(`${label} 추론 강도`, { exact: true });
    if (provider !== "claude") {
      assert.deepEqual(await reasoning.locator('option').evaluateAll(options=>options.map(option=>option.value)), ["", "low", effort]);
      await reasoning.selectOption(effort);
    }
    const expectedEffort = provider === "claude" ? {} : { reasoningEffort: effort };
    await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
    await app.evaluate(() => { globalThis.studio.calls = []; });
    await upload();
    await page.locator('.planner-notice').filter({hasText:/개 AI 초안 자동 저장/}).waitFor();
    const calls = await app.evaluate(() => globalThis.studio.calls);
    assert.deepEqual(calls.filter(call => call.action === "send"), [1, 2].map(() => ({ provider, action: "send", model: "vision-2", image: true, ...expectedEffort })));
    assert.ok(calls.every(call => call.provider === provider && call.action !== "login"));
    assert.equal(calls.filter(call => call.action === "status").length, 0, "Capture reuses connected account state");
    assert.equal(await models.inputValue(), "vision-2");
    await page.getByRole("button", { name: "일정 추가", exact: true }).click();
    await page.getByLabel("Brainstorming 모델", { exact: true }).selectOption("vision-1");
    assert.equal(await models.inputValue(), "vision-1");
    if (provider !== "claude") {
      assert.equal(await reasoning.inputValue(), "");
    }
    report.checks.push(`${label}: capture and audit use selected account/model, no other provider or login, model changes shared`);
    await app.evaluate(() => { globalThis.studio.calls = []; globalThis.studio.hold = true; });
    await page.getByRole("button", { name: "대안 살펴보기", exact: true }).click();
    await page.getByRole("button", { name: "AI 취소", exact: true }).waitFor();
    assert.deepEqual((await app.evaluate(() => globalThis.studio.calls)).filter(call => call.action === "send"), [{ provider, action: "send", model: "vision-1", image: false }]);
    await page.getByRole("button", { name: "AI 취소", exact: true }).click();
    await page.getByRole("button", { name: "닫기 · 변경 취소", exact: true }).click();
    await app.evaluate(() => { globalThis.studio.hold = false; });
    report.checks.push(`${label}: brainstorming and cancellation use the same provider/model`);
  }
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await selector.selectOption("codex");
  await page.getByLabel("Codex 모델", { exact: true }).selectOption("text");
  assert.equal(await page.getByLabel("Codex 추론 강도", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByLabel("Codex 추론 강도", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
  await app.evaluate(() => { globalThis.studio.calls = []; });
  await upload();
  await page.getByRole("alert").filter({ hasText: "이미지 지원 모델" }).waitFor();
  assert.equal(await page.getByLabel("Codex 모델", { exact: true }).inputValue(), "text");
  assert.deepEqual(await app.evaluate(() => globalThis.studio.calls), []);
  await page.getByRole("button", { name: "캡처 닫기", exact: true }).click();
  report.checks.push("Text-only choice is retained; image requests never silently switch model or provider");
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.getByLabel("Codex 모델", { exact: true }).selectOption("vision-2");
  assert.equal(await page.getByLabel("Codex 추론 강도", { exact: true }).inputValue(), "ultra");
  await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
  await app.evaluate(() => { globalThis.studio.calls = []; globalThis.studio.hold = true; });
  await upload();
  await page.getByRole("button", { name: "분석 취소", exact: true }).waitFor();
  assert.equal(await selector.isDisabled(), true);
  assert.equal(await page.getByLabel("Codex 추론 강도", { exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "분석 취소", exact: true }).click();
  await app.evaluate(() => globalThis.studio.pending.done());
  assert.equal(await page.getByLabel("추출 제목", { exact: true }).count(), 0);
  assert.ok((await app.evaluate(() => globalThis.studio.calls)).some(call => call.provider === "codex" && call.action === "cancel"));
  await page.getByRole("button", { name: "캡처 닫기", exact: true }).click();
  report.checks.push("Active capture locks provider switch; cancellation reaches original provider and ignores late response");
  await page.reload();
  await page.getByRole("region", { name: "저널 피드" }).waitFor();
  assert.equal(await selector.inputValue(), "codex");
  await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
  await app.evaluate(() => { globalThis.studio.calls = []; globalThis.studio.hold = false; });
  await upload();
  await page.locator('.planner-notice').filter({hasText:/개 AI 초안 자동 저장/}).waitFor();
  assert.ok((await app.evaluate(() => globalThis.studio.calls)).every(call => call.provider === "codex" && call.action !== "login"));
  assert.equal(await page.getByLabel("Codex 모델", { exact: true }).inputValue(), "vision-2");
  assert.equal(await page.getByLabel("Codex 추론 강도", { exact: true }).inputValue(), "ultra");
  assert.ok((await app.evaluate(() => globalThis.studio.calls)).filter(call=>call.action==='send').every(call=>call.reasoningEffort==='ultra'));
  report.checks.push("Provider/model effort choices survive renderer restart; capture and audit inherit them, default-only models and active work disable the control");
  await app.evaluate(() => { globalThis.studio.authenticated = false; globalThis.studio.calls = []; });
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.getByRole("button", { name: "Codex 연결 상태 확인", exact: true }).click();
  await page.getByRole("button", { name: "개발 플래너", exact: true }).click();
  await upload();
  await page.getByRole("status").filter({ hasText: /Codex.*로그인/ }).first().waitFor();
  assert.ok(!(await app.evaluate(() => globalThis.studio.calls)).some(call => call.action === "send" || call.action === "login" || call.provider !== "codex"));
  report.checks.push("Expired account retains image and requests selected-provider reconnect without automatic login/fallback");
  assert.deepEqual(report.errors, []);
  await page.screenshot({ path: "output/playwright/studio-ai-session.png" });
  await writeFile("output/playwright/studio-ai-session.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await app.close(); await rm(root, { recursive: true, force: true }); }
