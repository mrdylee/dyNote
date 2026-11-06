import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  app = await electron.launch({
    executablePath: process.env.DYNOTE_EXECUTABLE || path.resolve("node_modules/electron/dist", process.platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron" : process.platform === "win32" ? "electron.exe" : "electron"),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."],
    env: { ...process.env, OPEN_NOTES_DATA: profile },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  const personalTree = page.getByRole("region", { name: "개인 노트 · Personal", exact: true });
  const teamTree = page.getByRole("region", { name: "팀 공유 노트 · Team", exact: true });
  const row = (tree, title) => tree.getByTitle(title, { exact: true });
  const pane = file => page.getByRole("region", { name: `문서 ${file}`, exact: true });
  const drag = async (from, to, copy = false) => {
    await to.waitFor();
    if (copy) await page.keyboard.down("Control");
    try { await from.dragTo(to, { steps: 10 }); }
    finally { if (copy) await page.keyboard.up("Control"); }
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

  await drag(row(personalTree, "Copies/Plan.md"), personalTree.getByRole("heading", { name: "개인 노트 · Personal", exact: true }));
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
  assert.deepEqual(errors, []);
  console.log("Native folder drops move drafts and links, copy with Ctrl, protect conflicts, preserve originals, and block cross-vault link changes.");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
