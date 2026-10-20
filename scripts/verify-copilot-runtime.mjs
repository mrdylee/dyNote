const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const profile = await mkdtemp(`${tmpdir()}/dynote-copilot-ui-`);
const vaultRoot = `${profile}/vault`;
await mkdir(vaultRoot);
const original = "# 제목\r\n\r\nselected 원문\r\nlast line";
await writeFile(`${vaultRoot}/Home.md`, original);
await writeFile(`${vaultRoot}/Other.md`, "# 비공개\n다른 문서의 내용");
await writeFile(`${profile}/settings.json`, JSON.stringify({ vaultRoot }));
await mkdir("output/playwright", { recursive: true });
const report = { checks: [], errors: [], liveModelResponseVerified: false, liveAccountLoginVerified: false };
const app = await electron.launch({
  executablePath: process.env.DYNOTE_EXECUTABLE || `${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
  env: { ...process.env, OPEN_NOTES_DATA: profile, HOME: profile, GH_TOKEN: "", GITHUB_TOKEN: "", COPILOT_GITHUB_TOKEN: "" },
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  report.runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, platform: process.platform, arch: process.arch, electron: process.versions.electron }));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1050, 700); });
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copilot 보내기" }).isDisabled(), true);
  const first = await page.evaluate(() => window.notes.copilotStatus());
  assert.equal(first.ok, true, first.error);
  assert.equal(typeof first.value.authenticated, "boolean");
  report.sdkRuntimeStarted = true;
  report.authenticated = first.value.authenticated;
  report.checks.push("Real SDK starts from this Electron app and reports authentication state");
  await page.getByRole("tab", { name: "문서 정보", exact: true }).click();
  assert.equal(await page.getByRole("region", { name: "Copilot 채팅" }).isVisible(), false);
  await page.getByRole("tab", { name: "AI 채팅", exact: true }).click();
  await page.screenshot({ path: "output/playwright/copilot-connect.png" });

  // Only the transport is replaced. Rendering, selection, IPC, save queue,
  // disk revision checks and Electron packaging remain the real application.
  await app.evaluate(({ ipcMain }) => {
    globalThis.copilotRequests = [];
    globalThis.copilotAnswer = "답변입니다";
    globalThis.copilotDelay = 80;
    globalThis.copilotTimers = new Map();
    ipcMain.removeHandler("notes:copilot-status");
    ipcMain.handle("notes:copilot-status", () => ({ ok: true, value: { authenticated: true, login: "runtime-fixture", models: [{ id: "fixture-model", name: "Fixture model" }], error: "" } }));
    ipcMain.removeHandler("notes:copilot-send");
    ipcMain.handle("notes:copilot-send", (event, args) => {
      globalThis.copilotRequests.push(args);
      const send = (type, content) => event.sender.send("notes:copilot-event", { type, requestId: args.requestId, content });
      send("delta", "응답 작성 중…");
      const timer = setTimeout(() => { send("done", globalThis.copilotAnswer); globalThis.copilotTimers.delete(args.requestId); }, globalThis.copilotDelay);
      globalThis.copilotTimers.set(args.requestId, timer);
      return { ok: true, value: { requestId: args.requestId } };
    });
    ipcMain.removeHandler("notes:copilot-cancel");
    ipcMain.handle("notes:copilot-cancel", (event, args) => {
      clearTimeout(globalThis.copilotTimers.get(args?.requestId));
      event.sender.send("notes:copilot-event", { type: "canceled", requestId: args?.requestId });
      return { ok: true };
    });
  });
  await page.getByRole("button", { name: "Copilot 연결 상태 확인" }).click();
  await page.getByLabel("Copilot 모델").selectOption("fixture-model");
  await page.locator('.file-row[title="Home.md"]').click();
  await page.getByLabel("Copilot 질문").fill("요약해 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByText("답변입니다", { exact: true }).waitFor();
  const sent = await app.evaluate(() => globalThis.copilotRequests.at(-1));
  assert.equal(sent.context.content, original);
  assert.ok(!JSON.stringify(sent).includes("다른 문서의 내용"));
  report.checks.push("Current-note context, live streaming and model selection work through IPC");

  await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await editor.press("ControlOrMeta+Home");
  await editor.press("ArrowDown");
  await editor.press("ArrowDown");
  await editor.press("Home");
  await editor.press("Shift+End");
  await page.getByLabel("Copilot 전달 범위").selectOption("selection");
  await page.getByLabel("Copilot 작업").selectOption("edit");
  await app.evaluate(() => { globalThis.copilotAnswer = "새 내용\n두 줄"; });
  await page.getByLabel("Copilot 질문").fill("선택한 문장을 다듬어 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).waitFor();
  const selected = await app.evaluate(() => globalThis.copilotRequests.at(-1));
  assert.equal(selected.context.content, "selected 원문");
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).click();
  await page.getByRole("dialog", { name: "Copilot 수정안 확인" }).waitFor();
  await page.screenshot({ path: "output/playwright/copilot-review.png" });
  await page.getByRole("button", { name: "문서에 적용", exact: true }).click();
  await page.getByRole("dialog", { name: "Copilot 수정안 확인" }).waitFor({ state: "hidden" });
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), "# 제목\r\n\r\n새 내용\r\n두 줄\r\nlast line");
  await editor.click(); await editor.press("ControlOrMeta+z");
  await page.waitForFunction(() => document.querySelector(".save-status").classList.contains("saved"));
  assert.equal(await readFile(`${vaultRoot}/Home.md`, "utf8"), original);
  report.checks.push("Selected text alone is sent; reviewed apply preserves CRLF; editor undo restores original bytes");

  await page.getByRole("button", { name: "읽기 보기", exact: true }).click();
  await page.getByRole("button", { name: "편집 보기", exact: true }).click();
  const countBefore = await app.evaluate(() => globalThis.copilotRequests.length);
  await page.getByLabel("Copilot 질문").fill("선택했던 내용을 다듬어 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.locator(".copilot-error").filter({ hasText: "다시 선택" }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.copilotRequests.length), countBefore);
  report.checks.push("Remounting the editor clears stale selections before any context can be sent");
  await page.getByLabel("Copilot 전달 범위").selectOption("document");
  await page.getByLabel("Copilot 질문").fill("문서를 바꿔 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).waitFor();
  await editor.click(); await editor.press("ControlOrMeta+End"); await editor.pressSequentially("typing");
  assert.equal(await page.getByRole("button", { name: "변경 내용 확인", exact: true }).isDisabled(), true);
  report.checks.push("A response cannot overwrite text typed after the request");
  await page.getByRole("button", { name: "Copilot 새 대화" }).click();
  await page.getByLabel("Copilot 작업").selectOption("chat");
  await page.getByLabel("Copilot 전달 범위").selectOption("none");
  await app.evaluate(() => { globalThis.copilotDelay = 10000; });
  await page.getByLabel("Copilot 질문").fill("중지할 요청");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByRole("button", { name: "Copilot 응답 중지" }).click();
  await page.getByText("응답을 중지했습니다. 질문을 수정해 다시 보낼 수 있습니다.").waitFor();
  assert.equal(await page.getByLabel("Copilot 질문").inputValue(), "중지할 요청");
  const none = await app.evaluate(() => globalThis.copilotRequests.at(-1));
  assert.deepEqual(none.context, { kind: "none" });
  await page.locator('.file-row[title="Other.md"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".copilot-message").length === 0);
  assert.equal(await page.locator(".copilot-message").count(), 0);
  const geometry = await page.locator(".copilot-panel").evaluate((el) => {
    const button = el.querySelector('[aria-label="Copilot 보내기"]').getBoundingClientRect();
    return { right: button.right, bottom: button.bottom, width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth };
  });
  assert.ok(geometry.right <= geometry.width && geometry.bottom <= geometry.height);
  assert.ok(geometry.bodyWidth <= geometry.width);
  const toolbar = await page.locator(".toolbar-actions .text-action").evaluateAll((buttons) => buttons.map((b) => ({ height: b.getBoundingClientRect().height, text: b.textContent })));
  assert.ok(toolbar.every((b) => b.height < 40), "toolbar labels must not wrap into vertical text beside the wider panel");
  await page.screenshot({ path: "output/playwright/copilot-panel.png" });
  report.checks.push("Stop retains the draft; no-context requests exclude notes; note switching clears chat; composer fits 1050x700");

  await app.evaluate(() => { globalThis.copilotDelay = 80; globalThis.copilotAnswer = "# 수정 제안\n검토한 내용"; });
  await page.getByLabel("Copilot 전달 범위").selectOption("document");
  await page.getByLabel("Copilot 작업").selectOption("edit");
  await page.getByLabel("Copilot 질문").fill("문장을 바꿔 줘");
  await page.getByRole("button", { name: "Copilot 보내기" }).click();
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).waitFor();
  const external = "# 외부 프로그램이 저장한 변경\n보존해야 하는 내용";
  await writeFile(`${vaultRoot}/Other.md`, external);
  await page.getByRole("button", { name: "변경 내용 확인", exact: true }).click();
  await page.getByRole("button", { name: "문서에 적용", exact: true }).click();
  await page.locator(".copilot-error").filter({ hasText: "외부에서 문서가 변경" }).waitFor();
  assert.equal(await readFile(`${vaultRoot}/Other.md`, "utf8"), external);
  report.checks.push("Applying an AI proposal respects the existing disk revision check and preserves external edits");
  assert.deepEqual(report.errors, []);
} finally {
  // The final conflict check intentionally leaves a dirty draft in this
  // disposable profile. Exit this test process without discarding a real vault.
  await app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows().forEach((window) => window.destroy()), 30);
  }).catch(() => {});
  await app.close();
  await writeFile("docs/verification/copilot-runtime.json", JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
