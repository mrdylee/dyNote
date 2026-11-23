import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronPath from "electron";

const playwright = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const electron = playwright._electron ?? playwright.default._electron;
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-external-word-runtime-")));
const profile = path.join(root, "profile"), vault = path.join(root, "vault"), cache = path.join(root, "cache");
const source = path.join(root, "SWRS 외부 # % &.docx");
let app, page;
const errors = [];
try {
  for (const directory of [profile, vault, cache]) await mkdir(directory);
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(path.join(vault, "Control.md"), "# Existing document\n\nKeep this vault unchanged.");
  await copyFile(new URL("../tests/fixtures/word-roundtrip.docx", import.meta.url), source);
  const before = await readFile(source);
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "파일 목록", exact: true }).waitFor();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "설정", exact: true });
  await settings.getByRole("button", { name: "글꼴", exact: true }).click();
  await settings.getByLabel("본문 글자 크기", { exact: true }).fill("32");
  await settings.getByRole("button", { name: "닫기", exact: true }).click();
  const initialVault = await page.evaluate(async () => (await window.notes.snapshot()).value.id);
  await app.evaluate(({ app, dialog, shell }, { source, cache }) => {
    app.setPath("temp", cache);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    shell.openPath = async file => { globalThis.openedExternalWordPath = file; return ""; };
  }, { source, cache });
  const hasMenu = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById("dynote-open-file");
    if (!item || item.accelerator !== "CmdOrCtrl+O") return false;
    item.click(); return true;
  });
  assert.equal(hasMenu, true, "The File Open menu must exist");
  const dialog = page.getByRole("region", { name: path.basename(source), exact: true });
  await dialog.getByRole("heading", { name: "SWRS 검토 문서" }).waitFor();
  const article = dialog.getByRole("article", { name: "Word 미리보기" });
  for (const selector of [":scope > p", "td p"]) {
    assert.equal(await article.locator(selector).first().evaluate(node => getComputedStyle(node).fontSize), "32px");
  }
  const titleSize = await article.getByRole("heading", { level: 1 }).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(titleSize > 32, `The document title is ${titleSize}px with 32px body text`);
  await page.locator(".tab.active").getByText("임시 미리보기").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/external-word-open.png" });
  assert.deepEqual(await readFile(source), before);
  await dialog.getByRole("button", { name: "앱에서 수정", exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.openedExternalWordPath), source);
  await page.getByRole("button", { name: path.basename(source) + " 탭 닫기", exact: true }).click();
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await dialog.getByRole("heading", { name: "SWRS 검토 문서" }).waitFor();
  await page.getByRole("button", { name: path.basename(source) + " 탭 닫기", exact: true }).click();
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await page.getByRole("button", { name: "파일 열기", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("region", { name: path.basename(source) }).count(), 0);

  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator(".file-tree").getByRole("button", { name: "Control", exact: true }).click();
  await page.locator(".cm-content").waitFor();
  await page.evaluate(() => { const input = document.createElement("input"); input.id = "external-word-test-file"; input.type = "file"; document.body.append(input); });
  await page.locator("#external-word-test-file").setInputFiles(source);
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(document.querySelector("#external-word-test-file").files[0]);
    dataTransfer.items.add(new File(["control"], "control.md"));
    document.querySelector(".cm-content").dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  });
  await page.getByRole("alert").getByText("파일은 한 번에 하나씩 놓아 주세요.").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  const internalPassed = await page.evaluate(() => {
    let passed = false;
    window.addEventListener("drop", () => { passed = true; }, { once: true });
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("application/x-dynote-document", "Control.md");
    window.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
    return passed;
  });
  assert.equal(internalPassed, true, "Internal document drags must reach existing handlers");
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(document.querySelector("#external-word-test-file").files[0]);
    document.querySelector(".cm-content").dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  });
  await dialog.getByRole("heading", { name: "SWRS 검토 문서" }).waitFor();
  const fake = await page.evaluate(async () => {
    try { return await window.notes.openDroppedFile(new File(["fake"], "fake.docx")); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  assert.equal(fake.ok, false, "A JS-created File cannot authorize disk access");
  await copyFile(new URL("../tests/fixtures/word-roundtrip-updated.docx", import.meta.url), source + ".tmp");
  await rename(source + ".tmp", source);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("focus"));
  await dialog.getByText("SWRS-240 과전류차단 요구사항").waitFor();
  await dialog.getByRole("button", { name: "미리보기 새로고침", exact: true }).click();
  await dialog.getByText("SWRS-240 과전류차단 요구사항").waitFor();
  assert.deepEqual(await readFile(source), await readFile(new URL("../tests/fixtures/word-roundtrip-updated.docx", import.meta.url)));
  assert.equal(await page.evaluate(async () => (await window.notes.snapshot()).value.id), initialVault);
  assert.equal((await readdir(vault)).some(file => /\.docx$/i.test(file)), false);
  assert.deepEqual(errors, []);
  async function delayNextReply(channel) {
    await app.evaluate(({ ipcMain }, channel) => {
      const handler = ipcMain._invokeHandlers.get(channel);
      let started, resume;
      const waiting = new Promise(resolve => { resume = resolve; });
      globalThis.delayedPreview = { started: new Promise(resolve => { started = resolve; }), resume };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (...args) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
        const result = await handler(...args);
        started();
        await waiting;
        return result;
      });
    }, channel);
  }
  // Hold an unchanged read across an atomic save and a second refresh.
  await delayNextReply("notes:read-external-file");
  await dialog.getByRole("button", { name: "미리보기 새로고침" }).click();
  await app.evaluate(() => globalThis.delayedPreview.started);
  await writeFile(source + ".tmp", before);
  await rename(source + ".tmp", source);
  await dialog.getByRole("button", { name: "미리보기 새로고침" }).click();
  await dialog.getByText(/절연감시/).first().waitFor();
  await app.evaluate(() => globalThis.delayedPreview.resume());

  // Closing the tab takes precedence over a late reply reopening the same source.
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  await delayNextReply("notes:choose-external-file");
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await app.evaluate(() => globalThis.delayedPreview.started);
  const previewId = (await page.locator(".tab.active").getAttribute("data-tab-key")).slice("external:".length);
  assert.ok((await readdir(cache)).length);
  await page.getByRole("button", { name: path.basename(source) + " 탭 닫기", exact: true }).click();
  await app.evaluate(() => globalThis.delayedPreview.resume());
  await page.waitForFunction(() => !document.querySelector('button[aria-label="파일 열기"]').disabled);
  assert.equal(await page.getByRole("button", { name: path.basename(source) + " 탭 닫기", exact: true }).count(), 0);
  assert.equal(await page.evaluate(async id => (await window.notes.readExternalFile({ id })).ok, previewId), false);
  assert.deepEqual(await readdir(cache), []);
  await app.close(); app = null;
  assert.deepEqual(await readdir(cache), [], "Normal quit must remove temporary Word copies");
  console.log("External Word menu, button, editor drop, multi-file rejection, internal drag pass-through, source handoff, refresh and temporary cleanup passed.");
} finally {
  if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {}); }
  await rm(root, { recursive: true, force: true });
}
