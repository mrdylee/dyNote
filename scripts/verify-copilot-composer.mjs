const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
const profile = await mkdtemp(`${tmpdir()}/dynote-composer-`);
await mkdir(`${profile}/vault`);
await writeFile(`${profile}/vault/Home.md`, "# Original\nDo not change");
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot: `${profile}/vault` }));
const report = { checks: [], errors: [], transport: "deterministic IPC; no account or live model", windowsNative: false };
const app = await electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile, HOME: profile, GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "" },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).waitFor();
  await app.evaluate(({ ipcMain, BrowserWindow, app }) => {
    globalThis.composerRequests = [];
    ipcMain.removeHandler("notes:copilot-status");
    ipcMain.handle("notes:copilot-status", () => ({ ok: true, value: { authenticated: true, login: "fixture", models: [{ id: "auto", name: "Auto" }, { id: "long", name: "Long model display name for narrow panel" }] } }));
    ipcMain.removeHandler("notes:copilot-send");
    ipcMain.handle("notes:copilot-send", (event, args) => {
      globalThis.composerRequests.push(args);
      globalThis.composerEmit = (type, content) => event.sender.send("notes:copilot-event", { requestId: args.requestId, type, content });
      return { ok: true, value: { requestId: args.requestId } };
    });
    BrowserWindow.getAllWindows()[0].setSize(1050, 700);
  });
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).click();
  await page.getByRole("button", { name: "Copilot 연결 상태 확인" }).click();
  await page.getByLabel("Copilot 모델").selectOption("auto");
  const input = page.getByLabel("Copilot 질문");
  await input.fill("첫 줄");
  await input.press("End"); await input.press("Shift+Enter");
  await input.pressSequentially("second");
  assert.equal(await input.inputValue(), "첫 줄\nsecond");
  assert.equal(await app.evaluate(() => globalThis.composerRequests.length), 0);
  for (const props of [{ isComposing: true }, { keyCode: 229 }]) {
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", ...props });
    assert.equal(await app.evaluate(() => globalThis.composerRequests.length), 0);
  }
  await input.press("Shift+Enter");
  await input.press("Enter");
  await page.waitForFunction(() => !!document.querySelector('[aria-label="Copilot 응답 중지"]'), null, { timeout: 3000 });
  await input.press("Enter");
  assert.equal(await app.evaluate(() => globalThis.composerRequests.length), 1);
  assert.equal((await app.evaluate(() => globalThis.composerRequests[0])).prompt, "첫 줄\nsecond");
  report.checks.push("Enter sends exactly once; Shift+Enter adds newline; composing Enter and keyCode229 do not send; repeated Enter while running does not send");
  const diagram = '```mermaid\nflowchart LR\n A[시작] --> B[검토]\n click A "https://invalid.example/track"\n```';
  await app.evaluate((_, content) => globalThis.composerEmit("delta", content), diagram);
  await page.locator(".markdown-answer code.language-mermaid").waitFor();
  assert.equal(await page.locator(".markdown-answer svg").count(), 0);
  const answer = diagram + '\n\n| 항목 | 결과 |\n|---|---|\n|시험|통과|\n\n```mermaid\nnot a valid diagram\n```\n\n![remote](https://invalid.example/track)\n<script>alert(1)</script>';
  await app.evaluate((_, content) => globalThis.composerEmit("done", content), answer);
  await page.locator(".markdown-answer .mermaid-diagram svg").waitFor();
  await page.locator('.markdown-answer pre[title="다이어그램 문법을 확인해 주세요."]').waitFor();
  assert.equal(await page.locator(".markdown-answer table tbody tr").count(), 1);
  assert.equal(await page.locator(".markdown-answer script, .markdown-answer img, .markdown-answer foreignObject, .markdown-answer image, .markdown-answer [href], .markdown-answer [onclick]").count(), 0);
  assert.equal(await input.inputValue(), "");
  await input.press("Enter");
  assert.equal(await app.evaluate(() => globalThis.composerRequests.length), 1);
  report.checks.push("Completed Mermaid renders as sanitized SVG; streaming stays code; invalid diagram remains readable code; Markdown tables render; empty Enter does not send");
  const geometry = await page.evaluate(() => {
    const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height }; };
    return { input: box('[aria-label="Copilot 질문"]'), mode: box('[aria-label="Copilot 작업"]'), model: box('[aria-label="Copilot 모델"]'), send: box('[aria-label="Copilot 보내기"]'), panel: box('.copilot-panel'), log: box('.copilot-transcript'), height: innerHeight };
  });
  assert.ok(geometry.mode.y >= geometry.input.bottom);
  assert.ok(geometry.model.y >= geometry.input.bottom);
  assert.ok(geometry.send.bottom <= geometry.height);
  assert.ok(geometry.model.right <= geometry.panel.right);
  assert.ok(geometry.log.height >= 100);
  report.geometry = geometry;
  report.checks.push("At 1050x700 mode/model selectors sit below textarea; send button and transcript remain visible");
  assert.equal(await readFile(`${profile}/vault/Home.md`, "utf8"), "# Original\nDo not change");
  assert.deepEqual(report.errors, []);
  await mkdir("output/playwright", { recursive: true });
  await page.locator(".copilot-transcript").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: "output/playwright/copilot-composer.png" });
} finally {
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => w.destroy()), 30); }).catch(() => {});
  await app.close();
  await writeFile("docs/verification/copilot-composer-runtime.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
