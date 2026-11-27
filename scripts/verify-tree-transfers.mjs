import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  await writeFile(path.join(personal, "Shell.md"), "# Shell move");
  await writeFile(path.join(personal, "Shell index.md"), "[link](Shell.md)");
  await writeFile(path.join(personal, "Cut.pdf"), "original");
  await writeFile(path.join(personal, "Manual.txt"), "ordinary file");
  await writeFile(path.join(personal, "Deliver.md"), "# Hand-off\n");
  await writeFile(path.join(personal, "Linked.md"), "[Reference](Reference.md)\n");
  await writeFile(path.join(team, "Shared/Reference.md"), "# Another reference\n");
  await writeFile(path.join(team, "Shared/Keyboard.md"), "# Keyboard\n");
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
      await page.mouse.move(end.x + 1, end.y);
      await to.and(page.locator("[data-drop-label]")).waitFor();
    } finally {
      await page.mouse.up();
      if (copy) await page.keyboard.up("Control");
    }
    if (!copy) await page.getByRole("dialog", { name: "이동할까요?", exact: true }).getByRole("button", { name: "이동", exact: true }).click();
  };
  await page.getByRole("region", { name: "저널 피드", exact: true }).locator(".cm-focused").waitFor();
  await row(personalTree, `Journal/${localDate()}.md`).waitFor();
  await row(teamTree, "Shared").waitFor();
  const trashDialog = page.getByRole("dialog", { name: "휴지통으로 이동", exact: true });
  const folderDialog = page.getByRole("dialog", { name: "폴더 추가", exact: true });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const keyboardFile = row(teamTree, "Shared/Keyboard.md");
  const keyCopy = row(personalTree, "Copies/Keyboard.md");
  const moveDialog = page.getByRole("dialog", { name: "이동할까요?", exact: true });
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    globalThis.previousTreeClipboard = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item =>
      new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  });
  const setExplorerClipboard = (file, operation) => {
    execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", `
        Add-Type -AssemblyName System.Windows.Forms
        $data = New-Object Windows.Forms.DataObject
        $paths = New-Object Collections.Specialized.StringCollection
        [void]$paths.Add($env:DYNOTE_CLIPBOARD_FIXTURE)
        $data.SetFileDropList($paths)
        $effect = [IO.MemoryStream]::new([BitConverter]::GetBytes([int]${operation === "move" ? 2 : 1}))
        $data.SetData('Preferred DropEffect', $effect)
        [Windows.Forms.Clipboard]::SetDataObject($data, $true)
      `], { env: { ...process.env, DYNOTE_CLIPBOARD_FIXTURE: file } });
  };
  const external = path.join(root, "외부 문서.txt");
  await writeFile(external, "File from Explorer");
  for (const operation of process.platform === "win32" ? ["copy", "move"] : process.platform === "darwin" ? ["copy"] : []) {
    if (process.platform === "win32") setExplorerClipboard(external, operation);
    else {
      await app.evaluate(async ({ clipboard, ClipboardItem }, url) => {
        await clipboard.write([new ClipboardItem({ 'electron application/osclipboard;format="public.file-url"': new Blob([url]) })]);
      }, pathToFileURL(external).href);
    }
    const folder = operation === "copy" ? "Copies" : "Archive";
    await row(personalTree, folder).press(modifier + "+v");
    await row(personalTree, folder + "/" + path.basename(external).normalize(process.platform === "darwin" ? "NFD" : "NFC")).waitFor();
    assert.equal(await readFile(path.join(personal, folder, "외부 문서.txt"), "utf8"), "File from Explorer");
    if (operation === "copy") assert.equal(await readFile(external, "utf8"), "File from Explorer");
    else await assert.rejects(readFile(external), { code: "ENOENT" });
  }
  // Feed a real filesystem File through the same sidebar transfer used by Explorer paste.
  await row(personalTree, "Shell.md").click();
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.id = "shell-move-fixture";
    document.body.append(input);
  });
  const input = page.locator("#shell-move-fixture");
  const moveShellFile = async (file, target) => {
    if (process.platform === "win32") {
      setExplorerClipboard(file, "move");
      await target.press(modifier + "+v");
      return;
    }
    await input.setInputFiles(file);
    await target.evaluate(el => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(document.querySelector("#shell-move-fixture").files[0]);
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
  };
  await moveShellFile(path.join(personal, "Shell.md"), row(personalTree, "Copies"));
  await pane("Copies/Shell.md").waitFor();
  assert.equal(await readFile(path.join(personal, "Shell index.md"), "utf8"), "[link](Copies/Shell.md)");
  await moveShellFile(path.join(personal, "Copies/Shell.md"), row(teamTree, "Taken"));
  await page.getByRole("alert").filter({ hasText: "참조하는 링크" }).waitFor();
  assert.equal(await readFile(path.join(personal, "Copies/Shell.md"), "utf8"), "# Shell move");
  await assert.rejects(readFile(path.join(team, "Taken/Shell.md")), { code: "ENOENT" });
  await input.evaluate(el => el.remove());

  await row(personalTree, "Cut.pdf").press(modifier + "+x");
  await row(personalTree, "Copies").press(modifier + "+v");
  await moveDialog.waitFor();
  await rename(path.join(personal, "Cut.pdf"), path.join(personal, "Old.pdf"));
  await writeFile(path.join(personal, "Cut.pdf"), "replacement");
  await moveDialog.getByRole("button", { name: "이동", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "변경" }).waitFor();
  assert.equal(await readFile(path.join(personal, "Cut.pdf"), "utf8"), "replacement");
  await assert.rejects(readFile(path.join(personal, "Copies/Cut.pdf")), { code: "ENOENT" });

  await row(teamTree, "Shared/Original.docx").press(modifier + "+c");
  await row(personalTree, "Copies").press(modifier + "+v");
  await row(personalTree, "Copies/Original.docx").press(modifier + "+x");
  await row(personalTree, "Archive").press(modifier + "+v");
  await moveDialog.getByRole("button", { name: "이동", exact: true }).click();
  await row(personalTree, "Archive/Original.docx").waitFor();
  assert.deepEqual(await readFile(path.join(personal, "Archive/Original.docx")), await readFile(path.join(team, "Shared/Original.docx")));
  await row(personalTree, "Archive/Original.docx").press(modifier + "+x");
  await row(teamTree, "Taken").press(modifier + "+v");
  await moveDialog.getByRole("button", { name: "이동", exact: true }).click();
  await row(teamTree, "Taken/Original.docx").waitFor();
  await assert.rejects(readFile(path.join(personal, "Archive/Original.docx")), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(team, "Taken/Original.docx")), await readFile(path.join(team, "Shared/Original.docx")));
  await keyboardFile.click();
  await page.keyboard.press(modifier + "+c");
  await row(personalTree, "Copies").press(modifier + "+v");
  await keyCopy.waitFor();
  await keyCopy.press(modifier + "+v");
  await row(personalTree, "Copies/Keyboard (복사본).md").waitFor();
  await keyCopy.press(modifier + "+x");
  const rootHeading = personalTree.locator("h3");
  await rootHeading.press(modifier + "+v");
  await moveDialog.getByRole("button", { name: "취소" }).click();
  assert.equal(await readFile(path.join(personal, "Copies/Keyboard.md"), "utf8"), "# Keyboard\n");
  await rootHeading.press(modifier + "+v");
  await moveDialog.getByRole("button", { name: "이동", exact: true }).click();
  await row(personalTree, "Keyboard.md").waitFor();
  await assert.rejects(readFile(path.join(personal, "Copies/Keyboard.md")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(personal, "Keyboard.md"), "utf8"), "# Keyboard\n");
  await row(teamTree, "Shared").press(modifier + "+v");
  assert.equal(await moveDialog.count(), 0);
  await keyboardFile.click();
  const keyboardEditor = pane("Shared/Keyboard.md").getByRole("textbox", { name: "Markdown 편집기", exact: true });
  await keyboardFile.press(modifier + "+c");
  await keyboardEditor.press(modifier + "+a");
  await keyboardEditor.press(modifier + "+x");
  assert.equal(await keyboardEditor.evaluate(el => el.cmTile.root.view.state.doc.toString()), "");
  await keyboardEditor.press(modifier + "+v");
  assert.equal(await keyboardEditor.evaluate(el => el.cmTile.root.view.state.doc.toString()), "# Keyboard\n");
  await keyboardEditor.press(modifier + "+a");
  await keyboardEditor.press(modifier + "+c");
  await row(personalTree, "Archive").press(modifier + "+v");
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), "# Keyboard\n");
  assert.equal(await row(personalTree, "Archive/Keyboard.md").count(), 0);
  await keyboardEditor.press("Home");
  await keyboardEditor.press("Delete");
  assert.equal(await trashDialog.count(), 0);
  await keyboardEditor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await keyboardFile.click();
  await page.keyboard.press("Delete");
  await trashDialog.getByText(/Shared\/Keyboard\.md/).waitFor();
  await page.keyboard.press("Escape");
  await trashDialog.waitFor({ state: "detached" });
  assert.equal(await keyboardFile.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Delete");
  await trashDialog.getByRole("button", { name: "취소" }).click();
  assert.equal(await keyboardFile.evaluate(el => el === document.activeElement), true);
  assert.equal(await readFile(path.join(team, "Shared/Keyboard.md"), "utf8"), "# Keyboard\n");
  const shared = row(teamTree, "Shared");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await shared.getAttribute("aria-expanded"), "false");
  await page.keyboard.down(modifier);
  await page.keyboard.down("Shift");
  await page.keyboard.down("n");
  const folderInput = folderDialog.getByLabel("폴더 이름");
  await folderInput.waitFor();
  await page.keyboard.down("n");
  await page.keyboard.up("n");
  await page.keyboard.up("Shift");
  await page.keyboard.up(modifier);
  assert.equal(await folderInput.isVisible(), true);
  await folderInput.fill("XKeys");
  await folderInput.press("Home");
  await folderInput.press("Delete");
  assert.equal(await folderInput.inputValue(), "Keys");
  await folderInput.press("Enter");
  const createdFolder = row(teamTree, "Shared/Keys");
  await createdFolder.waitFor();
  assert.equal(await createdFolder.evaluate(el => el === document.activeElement), true);
  assert.equal(await shared.getAttribute("aria-expanded"), "true");
  await keyboardFile.press("ArrowLeft");
  assert.equal(await shared.evaluate(el => el === document.activeElement), true);
  await shared.press("ArrowLeft");
  assert.equal(await shared.getAttribute("aria-expanded"), "false");
  await shared.press("ArrowRight");
  await shared.press("ArrowRight");
  assert.equal(await createdFolder.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await keyboardFile.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("ArrowUp");
  assert.equal(await createdFolder.evaluate(el => el === document.activeElement), true);
  const teamRows = teamTree.locator(".file-tree button:enabled");
  await page.keyboard.press("End");
  assert.equal(await teamRows.last().evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Home");
  assert.equal(await teamRows.first().evaluate(el => el === document.activeElement), true);
  await row(personalTree, "Journal").press("Delete");
  assert.equal(await trashDialog.count(), 0);
  await keyboardFile.press(process.platform === "darwin" ? "Meta+Backspace" : "Delete");
  await trashDialog.getByRole("button", { name: "휴지통으로 이동" }).click();
  await keyboardFile.waitFor({ state: "detached" });
  await assert.rejects(readFile(path.join(team, "Shared/Keyboard.md")), { code: "ENOENT" });
  console.log("File tree keyboard navigation, scoped new folder, protected folders, editable input and confirmed trash passed.");
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

  await drag(row(personalTree, "Deliver.md"), row(teamTree, "Shared"), true);
  await row(teamTree, "Shared/Deliver.md").waitFor();
  assert.equal(await readFile(path.join(team, "Shared/Deliver.md"), "utf8"), "# Hand-off\n");
  assert.equal(await readFile(path.join(personal, "Deliver.md"), "utf8"), "# Hand-off\n");
  await drag(row(personalTree, "Linked.md"), row(teamTree, "Shared"), true);
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
  const renameWithF2=async (tree,from,name)=>{
    await row(tree,from).click();
    await page.keyboard.press("F2");
    await renameDialog.getByLabel("새 이름",{exact:true}).fill(name);
    await renameDialog.getByRole("button",{name:"이름 바꾸기",exact:true}).click();
  };
  await renameWithF2(personalTree,"Archive/Plan.md","내 계획.md");
  await row(personalTree,"Archive/내 계획.md").waitFor();
  await pane("Archive/내 계획.md").waitFor();
  assert.match(await readFile(path.join(personal,"Reference.md"),"utf8"),/Archive\/%EB%82%B4%20%EA%B3%84%ED%9A%8D.md/);
  await row(teamTree,"Shared/Reference.md").click();
  await renameWithF2(teamTree,"Shared","Taken");
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
  await row(personalTree,"Journal").press("F2");
  await page.getByText("앱에서 사용하는 기본 폴더입니다.",{exact:true}).waitFor();
  assert.equal(await renameDialog.count(),0);
  await renameWithF2(personalTree, "Manual.txt", "Renamed.txt");
  const undo = page.locator(".undo-toast").getByRole("button", { name: "되돌리기", exact: true });
  for (const [tree, directory, name] of [[personalTree, personal, "Renamed.txt"], [teamTree, team, "Taken/Original.docx"]]) {
    const file = row(tree, name);
    await file.waitFor();
    const bytes = await readFile(path.join(directory, name));
    await file.press("Delete");
    await trashDialog.getByRole("button", { name: "취소" }).click();
    assert.deepEqual(await readFile(path.join(directory, name)), bytes);
    await file.press("Delete");
    await trashDialog.getByRole("button", { name: "휴지통으로 이동" }).click();
    await file.waitFor({ state: "detached" });
    await assert.rejects(readFile(path.join(directory, name)), { code: "ENOENT" });
    await undo.click();
    await file.waitFor();
    assert.deepEqual(await readFile(path.join(directory, name)), bytes);
  }
  await row(personalTree, "Deliver.md").press("Enter");
  const shortcutEditor = pane("Deliver.md").getByRole("textbox", { name: "Markdown 편집기", exact: true });
  await shortcutEditor.press(modifier + "+f");
  await page.locator(".cm-search").waitFor();
  await page.keyboard.press("Escape");
  await shortcutEditor.press(modifier + "+End");
  await page.keyboard.insertText("Saved by shortcut");
  await shortcutEditor.press(modifier + "+s");
  await page.waitForFunction(async id => (await window.notes.snapshot({ vaultId: id, workspace: true })).value.notes
    .some(file => file.path === "Deliver.md" && file.content.includes("Saved by shortcut")), await personalTree.getAttribute("data-tree-drop-vault"));
  for (const [key, title] of [["k", "문서로 이동"], ["p", "명령 팔레트"], ["n", "새로운 생각 기록하기"]]) {
    await shortcutEditor.press(modifier + "+" + key);
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
  }
  const settingsKey = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById("dynote-settings");
    item.click();
    return item.accelerator;
  });
  assert.equal(settingsKey, "CmdOrCtrl+,");
  const settings = page.getByRole("dialog", { name: "설정", exact: true });
  await settings.getByRole("button", { name: "단축키", exact: true }).click();
  await settings.getByText("복사 · 잘라내기 · 붙여넣기", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("Native folder drops move drafts and links, copy with Ctrl, protect conflicts, preserve originals, block cross-vault link changes, and rename personal and team entries by F2 and context menu with links intact.");
} finally {
  await app?.evaluate(async ({ clipboard }) => {
    if (globalThis.previousTreeClipboard?.length) await clipboard.write(globalThis.previousTreeClipboard);
    else if (globalThis.previousTreeClipboard) clipboard.clear();
  }).catch(() => {});
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
