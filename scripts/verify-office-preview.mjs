import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import electronPath from "electron";
import { utils, write } from "xlsx";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-office-preview-")));
const vault = path.join(root, "vault"), profile = path.join(root, "profile");
const externalPath = path.join(root, "외부 시트.xlsx");
const sheetPath = path.join(vault, "시험 현황.xlsx"), deckPath = path.join(vault, "시험 보고서.pptx");
function workbook(status) {
  const book = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["온도 조건별 충전 시험"], ["시험 항목", "목표 온도", "측정 횟수", "결과"],
    ["저온 충전", "−10 °C", 120, status], ["상온 충전", "25 °C", 1234, "완료"], ["고온 충전", "45 °C", 150, "진행 중"],
  ]);
  sheet["!merges"] = [utils.decode_range("A1:D1")];
  sheet.C4.z = "#,##0";
  utils.book_append_sheet(book, sheet, "시험 현황");
  utils.book_append_sheet(book, utils.aoa_to_sheet([["담당자", "검토 일자"], ["시험팀", "11월 22일"], ["검토 상태", status]]), "검토 기록");
  return write(book, { bookType: "xlsx", type: "buffer" });
}
const native = Boolean(process.env.DYNOTE_OFFICE_PIPE);
let app;
async function confirmOpened(file, operation) {
  if (!native) {
    assert.equal(await app.evaluate(() => globalThis.editedOfficePath), file);
    return;
  }
  const python = path.join(process.env.ProgramFiles, "LibreOffice", "program", "python.exe");
  const script = fileURLToPath(new URL("./verify-office-save.py", import.meta.url));
  const result = await promisify(execFile)(python, ["-X", "utf8", script, file, operation], { timeout: 60000 });
  console.log(result.stdout.trim());
}
async function focusNotebook() {
  if (native) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
  } else {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit("focus"));
  }
}
try {
  await mkdir(vault); await mkdir(profile);
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault }));
  await writeFile(path.join(vault, "노트.md"), "[[시험 현황.xlsx]]");
  await writeFile(sheetPath, workbook("검토 중"));
  await writeFile(externalPath, workbook("외부 확인"));
  await copyFile(new URL("../tests/fixtures/office-preview.pptx", import.meta.url), deckPath);
  const original = await readFile(deckPath);
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath, args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow();
  page.setDefaultTimeout(12000);
  await app.evaluate(({ dialog, shell }, { source, mockHandoff }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    if (mockHandoff) shell.openPath = async file => { globalThis.editedOfficePath = file; return ""; };
  }, { source: externalPath, mockHandoff: !native });
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  const tree = page.locator(".file-tree");
  await tree.getByRole("button", { name: "노트", exact: true }).click();
  await page.getByRole("button", { name: "읽기 보기", exact: true }).click();
  await page.locator('.markdown-preview a[data-attachment="시험 현황.xlsx"]').first().click();
  const workbookView = page.getByLabel("Excel 미리보기", { exact: true });
  await workbookView.getByRole("cell", { name: "1,234" }).waitFor();
  assert.equal(await workbookView.getByRole("cell", { name: "온도 조건별 충전 시험" }).getAttribute("colspan"), "4");
  await mkdir("output/playwright", { recursive: true });
  await workbookView.screenshot({ path: "output/playwright/office-workbook.png" });
  await workbookView.getByRole("button", { name: "검토 기록" }).click();
  await workbookView.getByRole("cell", { name: "시험팀" }).waitFor();
  await workbookView.getByRole("button", { name: "앱에서 수정" }).click();
  await confirmOpened(sheetPath, "edit");
  if (!native) {
    await writeFile(sheetPath + ".tmp", workbook("승인 완료")); await rename(sheetPath + ".tmp", sheetPath);
  }
  await focusNotebook();
  await workbookView.getByRole("cell", { name: "승인 완료" }).waitFor();
  assert.equal(await workbookView.getByRole("button", { name: "검토 기록" }).getAttribute("aria-pressed"), "true");
  await workbookView.getByRole("button", { name: "시험 현황" }).click();
  await workbookView.getByRole("cell", { name: "승인 완료" }).waitFor();
  await tree.getByRole("button", { name: "시험 보고서.pptx", exact: true }).click();
  const slides = page.getByLabel("PowerPoint 미리보기", { exact: true });
  const frame = slides.frameLocator("iframe");
  await frame.getByText("시험 계획", { exact: true }).first().waitFor();
  await frame.getByRole("button", { name: "다음 슬라이드" }).click();
  await frame.getByText("시험 결과", { exact: true }).first().waitFor();
  await slides.getByRole("button", { name: "앱에서 수정" }).click();
  const oldFrame = page.frames().find(f => f.url() === "notes://slides/slides.html");
  const detached = page.waitForEvent("framedetached", { predicate: f => f === oldFrame, timeout: 90000 });
  await confirmOpened(deckPath, "edit");
  if (!native) {
    await writeFile(deckPath + ".tmp", original); await rename(deckPath + ".tmp", deckPath);
  }
  await focusNotebook();
  await detached;
  await frame.getByText(native ? "Windows 저장 확인" : "시험 결과", { exact: true }).first().waitFor();
  await slides.screenshot({ path: "output/playwright/office-slides.png" });
  assert.equal(await frame.getByRole("button", { name: "다음 슬라이드" }).isDisabled(), true);
  if (native) assert.notDeepEqual(await readFile(deckPath), original);
  else assert.deepEqual(await readFile(deckPath), original);
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "외부 시트.xlsx", exact: true });
  await dialog.getByRole("cell", { name: "외부 확인" }).waitFor();
  await dialog.getByRole("button", { name: "앱에서 수정" }).click();
  await confirmOpened(externalPath, "inspect");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  const externalDeck = path.join(root, "외부 발표.pptx");
  await copyFile(deckPath, externalDeck);
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "office-drop"; input.type = "file"; document.body.append(input);
  });
  await page.locator("#office-drop").setInputFiles(externalDeck);
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(document.querySelector("#office-drop").files[0]);
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
  });
  const dropped = page.getByRole("dialog", { name: "외부 발표.pptx", exact: true });
  await dropped.frameLocator("iframe").getByText("시험 계획", { exact: true }).first().waitFor();
  await dropped.getByRole("button", { name: "앱에서 수정" }).click();
  await confirmOpened(externalDeck, "inspect");
  console.log("Office vault, external picker, worksheet tabs, slides, edit handoff and focus refresh passed.");
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
