import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
  const drag = async (from, to, copy = false) => {
    await to.waitFor();
    if (copy) await page.keyboard.down("Control");
    try { await from.dragTo(to); }
    finally { if (copy) await page.keyboard.up("Control"); }
  };
  await row(personalTree, "Archive").click();
  assert.equal(await row(personalTree, "Archive").getAttribute("aria-expanded"), "false");
  await row(personalTree, "Inbox/Plan.md").click();
  const editor = page.getByRole("textbox", { name: "Markdown 편집기", exact: true });
  await editor.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("Draft before drag");
  await drag(row(personalTree, "Inbox/Plan.md"), row(personalTree, "Archive"));
  await row(personalTree, "Archive/Plan.md").waitFor();
  assert.equal(await row(personalTree, "Archive").getAttribute("aria-expanded"), "true");
  await page.getByRole("region", { name: "문서 Archive/Plan.md", exact: true }).waitFor();
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
  assert.deepEqual(errors, []);
  console.log("Native folder drops move drafts and links, copy with Ctrl, protect conflicts, and preserve the cross-vault original.");
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
