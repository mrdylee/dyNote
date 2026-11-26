import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
const { _electron: electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-work-during-fetch-")));
const personal = path.join(temp, "personal"), team = path.join(temp, "team"), profile = path.join(temp, "profile");
const waiting = Promise.withResolvers();
const server = createServer((_req, response) => waiting.resolve(response));
let app;
try {
  for (const root of [personal, team, profile]) await mkdir(root);
  for (const name of ["Keep", "Remove", "Rename", "CopySource"]) await writeFile(path.join(personal, name + ".md"), name);
  await writeFile(path.join(team, "Team.md"), "Team");
  await writeFile(path.join(profile, "settings.json"), JSON.stringify({vaultRoot:personal, vaults:[personal,team], vaultPurposes:{[personal]:"personal",[team]:"team"}}));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  execFileSync("git", ["init", "-q", "--initial-branch=main", personal]);
  execFileSync("git", ["-C", personal, "remote", "add", "origin", "http://127.0.0.1:" + server.address().port + "/repo.git"]);
  execFileSync("git", ["-C", personal, "config", "user.name", "Fixture"]);
  execFileSync("git", ["-C", personal, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", personal, "add", "--", "Keep.md"]);
  app = await electron.launch({executablePath:createRequire(import.meta.url)("electron"), args:["."], env:{...process.env,OPEN_NOTES_DATA:profile}});
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const file = name => page.locator('.file-row[title="' + name + '.md"]');
  await file("Keep").click();
  await page.getByRole("button", {name:"편집 보기",exact:true}).click();
  await page.getByRole("button", {name:"명령 팔레트",exact:true}).click();
  await page.getByRole("textbox", {name:"명령 검색"}).fill("Git 변경 관리");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", {name:"Git 커밋 메시지"}).fill("background commit");
  await page.evaluate(async () => {
    const {value:spaces} = await window.notes.workspaceSnapshots();
    const vaultId = spaces.find(space => space.purpose === "personal").snapshot.id;
    window.backgroundFetch = window.notes.gitWorkspaceAction({vaultId,workspace:true,action:{kind:"fetch",remote:"origin"}});
  });
  let timeout;
  const response = await Promise.race([waiting.promise, new Promise((_,reject) => {
    timeout = setTimeout(() => reject(Error("Fetch did not reach the local test remote")), 10000);
  })]).finally(() => clearTimeout(timeout));
  await page.getByRole("button", {name:"스테이징한 변경 커밋",exact:true}).click();
  await page.getByText("Git 작업 중…", {exact:true}).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.evaluate(() => {
    window.blockedTabs = false;
    const observer = new MutationObserver(records => {
      if (records.some(record => record.attributeName === "disabled" && record.target.matches(".tab-label"))) window.blockedTabs = true;
    });
    observer.observe(document.body, {attributes:true, subtree:true, attributeFilter:["disabled"]});
  });
  const copied = await page.evaluate(async () => {
    const {value:spaces} = await window.notes.workspaceSnapshots();
    const source = spaces.find(space => space.purpose === "personal").snapshot;
    const target = spaces.find(space => space.purpose === "team").snapshot;
    const revision = source.notes.find(note => note.path === "CopySource.md").revision;
    return window.notes.copyFile({workspace:true, vaultId:target.id, sourceVaultId:source.id, from:"CopySource.md", folder:"", revision});
  });
  assert.equal(copied.ok, true, copied.error);
  assert.equal(await readFile(path.join(team, "CopySource.md"), "utf8"), "CopySource");
  await file("Rename").click({button:"right"});
  await page.getByRole("menuitem", {name:/이름 바꾸기/}).click();
  const dialog = page.getByRole("dialog", {name:"이름 바꾸기"});
  await dialog.locator("input").fill("Renamed.md");
  await dialog.locator("button[type=submit], button.primary-button").last().click();
  await dialog.waitFor({state:"hidden"});
  await page.getByRole("status").filter({hasText:"이름 변경 중…"}).waitFor();
  await file("Remove").click({button:"right"});
  await page.getByRole("menuitem", {name:/휴지통으로 이동/}).click();
  await page.getByRole("dialog").getByRole("button", {name:"휴지통으로 이동",exact:true}).click();
  await file("Remove").waitFor({state:"detached"});
  assert.equal(await page.evaluate(() => window.blockedTabs), false);
  assert.match(await page.locator(".tab.active").innerText(), /Keep/);
  for (const [root,name] of [[personal,"Keep"], [team,"Team"]]) {
    await file(name).click();
    await page.getByRole("button", {name:"편집 보기",exact:true}).click();
    const editor = page.getByRole("textbox", {name:"Markdown 편집기"});
    await editor.click();
    await page.keyboard.insertText("editing during fetch ");
    const deadline = Date.now() + 8000;
    while (!(await readFile(path.join(root, name + ".md"), "utf8")).includes("editing during fetch") && Date.now() < deadline) await delay(50);
    assert.match(await readFile(path.join(root,name + ".md"), "utf8"), /editing during fetch/);
  }
  await file("Rename").click();
  assert.match(await page.locator(".tab.active").innerText(), /Rename/);
  response.writeHead(404); response.end();
  await page.evaluate(() => window.backgroundFetch);
  await file("Renamed").waitFor();
  assert.equal(execFileSync("git", ["-C", personal, "log", "-1", "--format=%s"], {encoding:"utf8"}).trim(), "background commit");
  assert.equal(execFileSync("git", ["-C", personal, "show", "HEAD:Keep.md"], {encoding:"utf8"}), "Keep");
  assert.match(await page.locator(".tab.active").innerText(), /Renamed/);
  await page.getByRole("button", {name:"되돌리기",exact:true}).click();
  await file("Remove").waitFor();
  assert.equal(await readFile(path.join(personal, "Remove.md"), "utf8"), "Remove");
  console.log("PASS dismiss pending commit, copy between vaults, delete, edit both vaults during fetch, keep staged bytes, retain a tab opened during rename, undo delete");
} catch (error) {
  console.error(error);
  app?.process().kill();
  throw error;
} finally {
  server.closeAllConnections(); server.close();
  if (app && !app.process().killed) await app.close();
  await rm(temp, {recursive:true,force:true});
}
