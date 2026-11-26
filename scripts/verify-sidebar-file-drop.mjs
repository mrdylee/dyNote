import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import electronPath from "electron";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-sidebar-test-")));
const vault = path.join(root, "vault"), profile = path.join(root, "profile");
const team = path.join(root, "Team");
const html = '<!doctype html><html lang="ko"><head><style>h1 { color: rgb(12, 34, 56) }</style></head><body><h1>시험 결과</h1><table><tr><td>완료</td></tr></table></body></html>';
let app;
try {
  await mkdir(path.join(vault, "Reports"), { recursive: true }); await mkdir(profile);
  await mkdir(path.join(team, "Shared"), { recursive: true });
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({ vaultRoot: vault, vaults: [vault, team],
    vaultPurposes: { [vault]: "personal", [team]: "team" } }));
  await writeFile(path.join(vault, "Control.md"), "# Control");
  await writeFile(path.join(root, "Report.HTM"), html);
  await writeFile(path.join(root, "Sample.txt"), "original text\n");
  app = await electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || electronPath,
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...process.env, OPEN_NOTES_DATA: profile } });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000);
  await page.getByRole("button", { name: "파일 목록", exact: true }).click();
  await page.locator(".file-tree").getByRole("button", { name: "Control", exact: true }).click();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.id = "sidebar-file-input"; input.type = "file"; input.multiple = true; document.body.append(input);
  });
  async function drop(target, names, ctrlKey = true) {
    await page.locator("#sidebar-file-input").setInputFiles(names.map(name => path.join(root, name)));
    await target.evaluate((element, ctrlKey) => {
      const dataTransfer = new DataTransfer();
      for (const file of document.querySelector("#sidebar-file-input").files) dataTransfer.items.add(file);
      for (const name of ["dragover", "drop"]) element.dispatchEvent(new DragEvent(name, { dataTransfer, ctrlKey, bubbles: true, cancelable: true }));
    }, ctrlKey);
  }
  async function verifyHtml(container) {
    const preview = container.frameLocator('iframe[title="HTML 미리보기"]');
    const title = preview.getByRole("heading", { name: "시험 결과" });
    await title.waitFor();
    assert.equal(await title.evaluate(el => getComputedStyle(el).color), "rgb(12, 34, 56)");
    await preview.getByRole("cell", { name: "완료" }).waitFor();
    assert.equal(await container.locator("iframe").getAttribute("sandbox"), "");
  }
  const tree = page.locator(".file-tree");
  const reports = tree.locator('.folder-row[data-tree-drop-folder="Reports"]');
  await drop(reports, ["Report.HTM", "Sample.txt"]);
  await tree.locator('[title="Reports/Report.HTM"]').waitFor();
  assert.equal(await readFile(path.join(vault, "Reports/Report.HTM"), "utf8"), html);
  await tree.locator('[title="Reports/Sample.txt"]').click();
  await page.locator(".attachment-view").getByText("original text", { exact: true }).waitFor();
  await tree.locator('[title="Reports/Report.HTM"]').click();
  await verifyHtml(page.locator(".attachment-view"));
  await drop(reports, ["Report.HTM"]);
  await tree.locator('[title="Reports/Report (복사본).HTM"]').waitFor();
  await drop(page.locator(".navigator"), ["Sample.txt"]);
  await tree.locator('[title="Sample.txt"]').waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await drop(tree.locator('.folder-row[data-tree-drop-folder="Shared"]'), ["Sample.txt"]);
  await tree.locator('[title="Shared/Sample.txt"]').waitFor();
  assert.equal(await readFile(path.join(team, "Shared/Sample.txt"), "utf8"), "original text\n");
  await assert.rejects(readFile(path.join(vault, "Shared/Sample.txt")), { code: "ENOENT" });
  await drop(page.locator(".attachment-heading"), ["Report.HTM"]);
  await verifyHtml(page.getByRole("region", { name: "Report.HTM", exact: true }));
  assert.deepEqual((await readdir(path.join(vault, "Reports"))).sort(), ["Report (복사본).HTM", "Report.HTM", "Sample.txt"]);
  assert.equal(await readFile(path.join(root, "Report.HTM"), "utf8"), html);
  assert.equal(await readFile(path.join(vault, "Sample.txt"), "utf8"), await readFile(path.join(root, "Sample.txt"), "utf8"));
  const previewTab = page.getByRole("button", { name: "Report.HTM 임시 미리보기", exact: true });
  await previewTab.waitFor();
  assert.equal(await previewTab.evaluate(button => button.draggable), true);
  await previewTab.dragTo(page.getByRole("button", { name: "파일 열기", exact: true }));
  await previewTab.dragTo(reports);
  await tree.locator('[title="Reports/Report (복사본 2).HTM"]').waitFor();
  assert.equal(await readFile(path.join(vault, "Reports/Report (복사본 2).HTM"), "utf8"), html);
  await tree.locator('[title="Control.md"]').click();
  await previewTab.dragTo(tree.locator('.folder-row[data-tree-drop-folder="Shared"]'));
  await tree.locator('[title="Shared/Report.HTM"]').waitFor();
  assert.equal(await readFile(path.join(team, "Shared/Report.HTM"), "utf8"), html);
  for (const space of [vault, team])
    await assert.rejects(readFile(path.join(space, "Report.HTM")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "Report.HTM"), "utf8"), html);
  await previewTab.click();
  const drag = await page.evaluateHandle(() => new DataTransfer());
  await previewTab.dispatchEvent("dragstart", { dataTransfer: drag });
  const updatedHtml = html.replace("시험 결과", "수정한 결과");
  await writeFile(path.join(root, "Report.HTM"), updatedHtml);
  await page.getByRole("button", { name: "미리보기 새로고침", exact: true }).click();
  await page.getByRole("region", { name: "Report.HTM", exact: true }).frameLocator("iframe").getByRole("heading", { name: "수정한 결과" }).waitFor();
  await reports.dispatchEvent("drop", { dataTransfer: drag });
  await previewTab.dispatchEvent("dragend", { dataTransfer: drag });
  await drag.dispose();
  await page.getByText(/미리보기가 변경되었습니다/).waitFor();
  await assert.rejects(readFile(path.join(vault, "Reports/Report (복사본 3).HTM")), { code: "ENOENT" });
  await previewTab.dragTo(reports);
  await tree.locator('[title="Reports/Report (복사본 3).HTM"]').waitFor();
  assert.equal(await readFile(path.join(vault, "Reports/Report (복사본 3).HTM"), "utf8"), updatedHtml);
  await page.getByText(/미리보기가 변경되었습니다/).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Report.HTM 탭 닫기", exact: true }).click();
  await writeFile(path.join(root, "Move.txt"), "move me");
  await drop(reports, ["Move.txt"], false);
  await tree.locator('[title="Reports/Move.txt"]').waitFor();
  assert.equal(await readFile(path.join(vault, "Reports/Move.txt"), "utf8"), "move me");
  await assert.rejects(readFile(path.join(root, "Move.txt")), { code: "ENOENT" });
  console.log("PASS default move and Ctrl copy, folder and sidebar-root copies, multiple files, duplicate names, original bytes, HTML styling and external preview");
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
