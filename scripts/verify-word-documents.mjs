import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";

const playwright = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const electron = playwright._electron ?? playwright.default._electron;
const root = await realpath(await mkdtemp(join(tmpdir(), "dynote-word-runtime-")));
const profile = join(root, "profile");
const vault = join(root, "vault");
const filename = "SWRS 검토 # % &.docx";
const file = join(vault, "내려받기", filename);
const original = new URL("../tests/fixtures/word-roundtrip.docx", import.meta.url);
const updated = new URL("../tests/fixtures/word-roundtrip-updated.docx", import.meta.url);
let app;
let page;
const errors = [];
try {
  await mkdir(profile);
  await mkdir(join(vault, "내려받기"), { recursive: true });
  await writeFile(join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(join(vault, "노트.md"), "# Markdown control\n\n원래 노트 검색");
  await copyFile(original, file);
  app = await electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
    env: { ...process.env, OPEN_NOTES_DATA: profile },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await app.evaluate(({ shell }) => {
    shell.openPath = async path => { globalThis.openedWordPath = path; return ""; };
  });

  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.getByRole("button", { name: filename, exact: true }).click();
  const preview = page.getByRole("article", { name: "Word 미리보기" });
  await preview.getByRole("heading", { name: "SWRS 검토 문서" }).waitFor();
  await preview.getByRole("table").getByText("SWRS-240 절연감시 요구사항").waitFor();
  const image = preview.getByRole("img", { name: "검토용 이미지" });
  await image.waitFor();
  assert.equal(await image.evaluate(element => element.complete && element.naturalWidth === 1), true);
  assert.equal(await preview.locator("a[href]").count(), 0);
  await page.getByRole("button", { name: "기본 앱에서 열기", exact: true }).click();
  await page.waitForFunction(async () => !!(await window.notes.snapshot()).value?.id);
  assert.equal(await app.evaluate(() => globalThis.openedWordPath), file);
  assert.deepEqual(await readFile(file), await readFile(original));

  await page.getByRole("button", { name: /모든 문서 검색/ }).click();
  const search = page.getByRole("textbox", { name: "전체 문서 검색" });
  await search.fill("절연감시");
  const result = page.locator(".search-result").filter({ hasText: filename });
  await result.click();
  await preview.getByText("SWRS-240 절연감시 요구사항").waitFor();

  await copyFile(updated, file + ".tmp");
  await rename(file + ".tmp", file);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("focus"));
  await preview.getByText("SWRS-240 과전류차단 요구사항").waitFor();
  assert.equal(await result.count(), 0);
  await search.fill("과전류차단");
  await result.waitFor();
  await search.fill("원래 노트 검색");
  await page.locator(".search-result").filter({ hasText: "Markdown control" }).waitFor();
  await page.getByRole("button", { name: /문서로 이동/ }).click();
  const quickSearch = page.getByRole("textbox", { name: "빠른 문서 검색" });
  await quickSearch.fill("과전류차단");
  await quickSearch.press("Enter");
  await quickSearch.waitFor({ state: "hidden" });
  await preview.getByText("SWRS-240 과전류차단 요구사항").waitFor();
  assert.deepEqual(await readFile(file), await readFile(updated));
  await page.getByRole("button", { name: "문서로 돌아가기", exact: true }).click();
  await copyFile(original, file + ".tmp");
  await rename(file + ".tmp", file);
  await app.evaluate(({ app, BrowserWindow }) => {
    if (process.platform === "darwin") app.emit("did-become-active");
    else BrowserWindow.getAllWindows()[0].emit("focus");
  });
  await search.fill("절연감시");
  await result.waitFor();
  await search.fill("과전류차단");
  await page.waitForFunction(() => document.querySelectorAll(".search-result").length === 0);
  await search.fill("절연감시");
  await result.click();
  await preview.getByText("SWRS-240 절연감시 요구사항").waitFor();
  assert.deepEqual(await readFile(file), await readFile(original));
  assert.deepEqual(errors, []);
  console.log("Word list, preview, search, original path handoff, and refresh after an external save passed.");
} catch (error) {
  if (page) {
    console.error(errors);
    console.error((await page.locator("body").innerText({ timeout: 1000 }).catch(() => "")).slice(0, 2400));
    console.error(await page.evaluate(async () => {
      const response = await window.notes?.snapshot();
      return response?.ok ? { vault: response.value.name, words: response.value.wordDocuments?.map(file => file.path) } : response;
    }).catch(() => null));
  }
  throw error;
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close();
  }
  await rm(root, { recursive: true, force: true });
}
