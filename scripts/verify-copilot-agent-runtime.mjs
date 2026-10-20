const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const profile = await mkdtemp(`${tmpdir()}/dynote-agent-ui-`);
const vaultRoot = `${profile}/vault`;
await mkdir(vaultRoot);
const original = "# 제목\r\n\r\n원문\r\n끝";
await writeFile(`${vaultRoot}/Home.md`, original);
await writeFile(`${vaultRoot}/Ref.md`, "# 참고\n배터리 시험");
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
const report = { checks: [], errors: [], modelTransport: "deterministic fixture; real note tools, renderer and vault", liveModelVerified: false };
const launch = () => electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile, HOME: profile, GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "" },
});
let app = await launch();
try {
  let page = await app.firstWindow();
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).waitFor();
  await page.evaluate(() => localStorage.setItem("dynote.ai.provider", "codex"));
  await app.evaluate(({ session }) => session.defaultSession.flushStorageData());
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  assert.equal(await page.evaluate(() => localStorage.getItem("dynote.ai.provider")), "codex");
  assert.deepEqual(await page.evaluate(() => Object.keys(window.notes).filter((name) => /codex/i.test(name))), []);
  assert.equal(await page.getByLabel("AI 서비스").count(), 0);
  report.checks.push("Legacy Codex preference opens Copilot; Codex renderer API and service selector are removed");
  report.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, platform: process.platform, electron: process.versions.electron }));
  await app.evaluate(async ({ ipcMain, app }) => {
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
    const { noteTools } = require(`${app.getAppPath()}/core/copilot-agent.mjs`);
    globalThis.agentRequests = [];
    globalThis.agentScenario = "edit-create";
    ipcMain.removeHandler("notes:copilot-status");
    ipcMain.handle("notes:copilot-status", () => ({ ok: true, value: { authenticated: true, login: "agent-fixture", models: [{ id: "fixture", name: "Fixture" }] } }));
    ipcMain.removeHandler("notes:copilot-send");
    ipcMain.handle("notes:copilot-send", (event, args) => {
      globalThis.agentRequests.push(args);
      const emit = (type, data) => event.sender.send("notes:copilot-event", { requestId: args.requestId, type, ...data });
      const tools = noteTools({ args, canceled: () => false, emit });
      const call = (name, input) => tools.find((tool) => tool.name === `dynote_${name}`).handler(input);
      setTimeout(async () => {
        await call("read_note", { path: args.context.path });
        if (args.references.length) await call("read_note", { path: args.references[0].path });
        await call("edit_note", { path: args.context.path, operation: "append", content: "\n추가한 체크리스트\n- [ ] 확인" });
        if (globalThis.agentScenario === "edit-create") await call("create_note", { path: "Agent Summary.md", content: "# 요약\n새 문서 내용" });
        emit("done", { content: "**수정안을 준비했습니다.**\n\n- 검토 후 적용해 주세요.\n\n![remote](https://invalid.example/track)\n<script>alert(1)</script>" });
      }, 50);
      return { ok: true, value: { requestId: args.requestId } };
    });
  });
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).click();
  await page.getByRole("button", { name: "Copilot 연결 상태 확인" }).click();
  await page.getByLabel("Copilot 모델").selectOption("fixture");
  await page.locator('.file-row[title="Home.md"]').click();
  assert.equal(await page.getByLabel("Copilot 작업").inputValue(), "agent");
  await page.getByRole("button", { name: /참고 문서 0\/5/ }).click();
  await page.getByLabel("참고 문서 검색").fill("Ref");
  await page.locator(".copilot-attachment-picker").getByRole("button", { name: "Ref.md", exact: true }).click();
  await page.getByLabel("Copilot 질문").fill("추가하고 새 요약 문서도 만들어 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".copilot-pending-list button").length === 2);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Copilot 실시간 변경"] button')?.disabled);
  const request = await app.evaluate(() => globalThis.agentRequests.at(-1));
  assert.equal(request.references[0].content, "# 참고\n배터리 시험");
  assert.equal(request.vaultAccess, false);
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), original);
  assert.equal(await page.locator(".markdown-answer strong").count(), 1);
  assert.equal(await page.locator(".markdown-answer img, .markdown-answer script").count(), 0);
  report.checks.push("Agent default; searchable reference attachments; tool progress; safe Markdown; live drafts do not modify disk");
  await page.locator('.file-row[title="Ref.md"]').click();
  assert.equal(await page.locator(".copilot-pending-list button").count(), 2);
  await page.locator(".copilot-pending-list").getByRole("button", { name: "Home.md", exact: true }).click();
  await page.getByRole("button", { name: "변경 유지", exact: true }).click();
  await page.getByLabel("Copilot 실시간 변경").waitFor({ state: "hidden" });
  const appended = original + "\r\n추가한 체크리스트\r\n- [ ] 확인";
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), appended);
  report.checks.push("Agent conversation survives note switching; pending target opens in center editor; Keep preserves CRLF");
  await page.locator(".copilot-pending-list").getByRole("button", { name: "Agent Summary.md", exact: true }).click();
  await page.getByRole("button", { name: "변경 유지", exact: true }).click();
  await page.getByLabel("Copilot 실시간 변경").waitFor({ state: "hidden" });
  assert.equal(await readFile(`${vaultRoot}/Agent Summary.md`, "utf8"), "# 요약\n새 문서 내용");
  await page.locator('.file-row[title="Agent Summary.md"]').waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /새 문서 내용/);
  report.checks.push("Two pending documents resolve independently; kept new note is created atomically in the center editor");
  assert.deepEqual(report.errors, []);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/copilot-agent.png" });
} finally {
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => w.destroy()), 30); }).catch(() => {});
  await app.close();
  await writeFile("docs/verification/copilot-agent-runtime.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
