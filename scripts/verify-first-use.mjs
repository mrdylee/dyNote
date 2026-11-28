import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-first-use-")));
const folder = path.join(root, "개인 메모");
let app, page;
async function launch() {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)("electron"), args: ["."],
    env: { ...process.env, OPEN_NOTES_DATA: path.join(root, "profile") } });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
}
const button = name => page.getByRole("button", { name, exact: true });
const pick = folder => app.evaluate(({dialog}, folder) => {
  dialog.showOpenDialog = async () => ({canceled: !folder, filePaths: folder ? [folder] : []});
}, folder);
try {
  await mkdir(folder);
  await launch();
  await button("다른 PC의 노트 가져오기").waitFor();
  if (process.env.DYNOTE_GUIDE_SCREENSHOT) await page.screenshot({path:process.env.DYNOTE_GUIDE_SCREENSHOT});
  await button("다른 PC의 노트 가져오기").click();
  await page.getByRole("form", {name:"개인 노트 가져오기"}).waitFor();
  await button("닫기").click();
  await button("팀 노트 연결하기").click();
  await page.getByRole("form", {name:"팀 저장소 연결"}).waitFor();
  await button("닫기").click();
  await button("예제로 둘러보기").click();
  await page.getByText("시작하기", {exact:true}).first().waitFor();
  await button("저널").click();
  await pick(null);
  await button("이 PC에서 노트 쓰기").click();
  await button("이 PC에서 노트 쓰기").waitFor();
  await pick(folder);
  await button("이 PC에서 노트 쓰기").click();
  await page.getByText("오늘의 저널에 한 줄을 적어 보세요.").waitFor();
  const entry = page.locator(".journal-entry").first();
  const editor = entry.locator('.cm-content[contenteditable="true"]');
  await editor.click();
  await page.keyboard.insertText("첫 안내 검증");
  await page.getByText("이 PC에 저장했어요.").waitFor();
  const journalPath = await entry.getAttribute("data-document-path");
  assert.match(await readFile(path.join(folder,journalPath),"utf8"), /첫 안내 검증/);
  await button("동기화 설정 열기").click();
  await page.getByLabel("사용 목적").selectOption("daily");
  await page.getByRole("heading",{name:"자동 백업"}).waitFor();
  await button("닫기").click();
  await button("전체 검색").click();
  await page.getByRole("note", {name:"검색 사용 안내"}).waitFor();
  await button("검색 안내 닫기").click();
  await button("저널").click();
  await app.close();
  await launch();
  await page.locator(".journal-feed").waitFor();
  assert.equal(await button("이 PC에서 노트 쓰기").count(), 0);
  assert.equal(await page.getByText("이 PC에 저장했어요.").count(), 0);
  await button("전체 검색").click();
  assert.equal(await page.getByRole("note", {name:"검색 사용 안내"}).count(), 0);
  await button("설정").click();
  await button("시작 화면").click();
  await button("처음 사용 안내").click();
  await button("오늘의 저널 열기").waitFor();
  console.log("Verified first-use routes, cancellation, first journal save, Git purpose, restart and replay.");
} finally {
  await app?.close();
  await rm(root, {recursive:true,force:true});
}
