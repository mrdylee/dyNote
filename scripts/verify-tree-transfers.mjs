import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localDate } from "../core/periodic-notes.mjs";

const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-tree-transfers-")));
const personal = path.join(root, "Personal");
const team = path.join(root, "Team");
const profile = path.join(root, "profile");
const source = "# Plan\n\n[Reference](../Reference.md)\n";
const errors = [];
let app;
try {
  for (const directory of [profile, ...["Inbox", "Archive", "Copies", "Conflict"].map(name => path.join(personal, name)), path.join(team, "Shared")])
    await mkdir(directory, { recursive: true });
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({
    vaultRoot: personal, vaults: [personal, team], vaultPurposes: { [personal]: "personal", [team]: "team" },
  }));
  await writeFile(path.join(personal, "Inbox/Plan.md"), source);
  await writeFile(path.join(personal, "Conflict/Plan.md"), "# Existing\n");
  await writeFile(path.join(personal, "Reference.md"), "[Plan](Inbox/Plan.md)\n");
  await writeFile(path.join(personal, "Deliver.md"), "# Hand-off\n");
  await writeFile(path.join(personal, "Linked.md"), "[Reference](Reference.md)\n");
  await writeFile(path.join(team, "Shared/Reference.md"), "# Another reference\n");
  await mkdir(path.join(team,"Taken"));
  await writeFile(path.join(team,"TeamIndex.md"),"[Shared](Shared/Reference.md)\n");
  await copyFile(new URL("../tests/fixtures/word-roundtrip.docx",import.meta.url),path.join(team,"Shared/Original.docx"));
  app = await electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve("node_modules/electron/dist", process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron"),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
    env: { ...process.env, OPEN_NOTES_DATA: profile },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1050, 700));
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  const personalTree = page.getByRole("region", { name: "개인 노트 · Personal", exact: true });
  const teamTree = page.getByRole("region", { name: "팀 공유 노트 · Team", exact: true });
  const row = (tree, title) => tree.getByTitle(title, { exact: true });
  const pane = file => page.getByRole("region", { name: `문서 ${file}`, exact: true });
  const center = async locator => {
    await locator.scrollIntoViewIfNeeded();
    const { x, y, width, height } = await locator.boundingBox();
    return { x: x + width / 2, y: y + height / 2 };
  };
  const drag = async (from, to, copy = false) => {
    const start = await center(from);
    await page.mouse.move(start.x, start.y);
    if (copy) await page.keyboard.down("Control");
    await page.mouse.down();
    try {
      // Start dragging from the file before scrolling can move another row under the pointer.
      await page.mouse.move(start.x + 12, start.y);
      const end = await center(to);
      await page.mouse.move(end.x, end.y, { steps: 10 });
      await to.and(page.locator("[data-drop-label]")).waitFor();
    } finally {
      await page.mouse.up();
      if (copy) await page.keyboard.up("Control");
    }
  };
  await page.getByRole("region", { name: "저널 피드", exact: true }).locator(".cm-focused").waitFor();
  await row(personalTree, `Journal/${localDate()}.md`).waitFor();
  await row(teamTree, "Shared").waitFor();
  await row(personalTree, "Archive").click();
  assert.equal(await row(personalTree, "Archive").getAttribute("aria-expanded"), "false");
  await row(personalTree, "Inbox/Plan.md").click();
  const editor = pane("Inbox/Plan.md").getByRole("textbox", { name: "Markdown 편집기", exact: true });
  await editor.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("Draft before drag");
  assert.match(await editor.evaluate(element => element.cmTile.root.view.state.doc.toString()), /Draft before drag/);
  await drag(row(personalTree, "Inbox/Plan.md"), row(personalTree, "Archive"));
  await row(personalTree, "Archive/Plan.md").waitFor();
  assert.equal(await row(personalTree, "Archive").getAttribute("aria-expanded"), "true");
  await pane("Archive/Plan.md").waitFor();
  const moved = await readFile(path.join(personal, "Archive/Plan.md"), "utf8");
  assert.match(moved, /Draft before drag/);
  assert.equal(await readFile(path.join(personal, "Reference.md"), "utf8"), "[Plan](Archive/Plan.md)\n");
  await assert.rejects(readFile(path.join(personal, "Inbox/Plan.md")), { code: "ENOENT" });
  await row(personalTree, "Inbox").waitFor();

  await drag(row(personalTree, "Archive/Plan.md"), row(personalTree, "Copies"), true);
  await row(personalTree, "Copies/Plan.md").waitFor();
  assert.equal(await readFile(path.join(personal, "Copies/Plan.md"), "utf8"), moved);
  assert.equal(await readFile(path.join(personal, "Archive/Plan.md"), "utf8"), moved);
  await drag(row(personalTree, "Archive/Plan.md"), row(personalTree, "Archive"), true);
  await row(personalTree, "Archive/Plan (복사본).md").waitFor();
  assert.equal(await readFile(path.join(personal, "Archive/Plan (복사본).md"), "utf8"), moved);
  if (process.platform === "darwin") {
    await row(personalTree, "Archive/Plan.md").click({ modifiers: ["Control"] });
    await page.getByRole("menu", { name: "문서·폴더 작업", exact: true }).waitFor();
    await page.keyboard.press("Escape");
  }

  await drag(row(personalTree, "Archive/Plan.md"), row(personalTree, "Conflict"));
  await page.getByText("대상 폴더에 같은 이름의 문서가 있습니다.", { exact: true }).waitFor();
  assert.equal(await readFile(path.join(personal, "Conflict/Plan.md"), "utf8"), "# Existing\n");
  assert.equal(await readFile(path.join(personal, "Archive/Plan.md"), "utf8"), moved);

  await drag(row(personalTree, "Copies/Plan.md"), personalTree.locator('h3[data-tree-drop-folder=""]'));
  await row(personalTree, "Plan.md").waitFor();
  assert.equal(await readFile(path.join(personal, "Plan.md"), "utf8"), moved.replace("../Reference.md", "Reference.md"));
  await assert.rejects(readFile(path.join(personal, "Copies/Plan.md")), { code: "ENOENT" });

  await drag(row(personalTree, "Deliver.md"), row(teamTree, "Shared"));
  const confirm = page.getByRole("dialog", { name: "다른 보관함에 복사", exact: true });
  await confirm.waitFor();
  await assert.rejects(readFile(path.join(team, "Shared/Deliver.md")), { code: "ENOENT" });
  await confirm.getByRole("button", { name: "복사", exact: true }).click();
  await row(teamTree, "Shared/Deliver.md").waitFor();
  assert.equal(await readFile(path.join(team, "Shared/Deliver.md"), "utf8"), "# Hand-off\n");
  assert.equal(await readFile(path.join(personal, "Deliver.md"), "utf8"), "# Hand-off\n");
  await drag(row(personalTree, "Linked.md"), row(teamTree, "Shared"));
  await confirm.getByRole("button", { name: "복사", exact: true }).click();
  await page.getByText(/링크 “Reference\.md”의 대상이 복사 후 달라집니다/).waitFor();
  await assert.rejects(readFile(path.join(team, "Shared/Linked.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(personal, "Linked.md"), "utf8"), "[Reference](Reference.md)\n");
  const menu=page.getByRole("menu",{name:"문서·폴더 작업",exact:true});
  const renameDialog=page.getByRole("dialog",{name:"이름 바꾸기",exact:true});
  const renameEntry=async (tree,from,name)=>{
    await row(tree,from).click({button:"right"});
    await menu.getByRole("menuitem",{name:"이름 바꾸기",exact:true}).click();
    await renameDialog.getByLabel("새 이름",{exact:true}).fill(name);
    await renameDialog.getByRole("button",{name:"이름 바꾸기",exact:true}).click();
  };
  await row(personalTree,"Archive/Plan.md").click();
  await renameEntry(personalTree,"Archive/Plan.md","내 계획.md");
  await row(personalTree,"Archive/내 계획.md").waitFor();
  await pane("Archive/내 계획.md").waitFor();
  assert.match(await readFile(path.join(personal,"Reference.md"),"utf8"),/Archive\/%EB%82%B4%20%EA%B3%84%ED%9A%8D.md/);
  await row(teamTree,"Shared/Reference.md").click();
  await renameEntry(teamTree,"Shared","Taken");
  await renameDialog.getByRole("alert").filter({hasText:"같은 이름"}).waitFor();
  await renameDialog.getByLabel("새 이름",{exact:true}).fill("공유 문서");
  await renameDialog.getByRole("button",{name:"이름 바꾸기",exact:true}).click();
  await row(teamTree,"공유 문서/Reference.md").waitFor();
  await pane("공유 문서/Reference.md").waitFor();
  assert.match(await readFile(path.join(team,"TeamIndex.md"),"utf8"),/%EA%B3%B5%EC%9C%A0%20%EB%AC%B8%EC%84%9C\/Reference.md/);
  await renameEntry(teamTree,"공유 문서/Reference.md","Reference revised.md");
  await row(teamTree,"공유 문서/Reference revised.md").waitFor();
  await pane("공유 문서/Reference revised.md").waitFor();
  await renameEntry(teamTree,"공유 문서/Original.docx","팀 문서.docx");
  await row(teamTree,"공유 문서/팀 문서.docx").waitFor();
  assert.deepEqual(await readFile(path.join(team,"공유 문서/팀 문서.docx")),await readFile(new URL("../tests/fixtures/word-roundtrip.docx",import.meta.url)));
  await row(personalTree,"Journal").click({button:"right"});
  assert.equal(await menu.getByRole("menuitem",{name:"이름 바꾸기",exact:true}).isDisabled(),true);
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("Native folder drops move drafts and links, copy with Ctrl, protect conflicts, preserve originals, block cross-vault link changes, and rename personal and team entries with links intact.");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
