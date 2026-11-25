import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { openVaultSection } from "./vault-settings-navigation.mjs";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const root = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-vault-entry-")));
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
const remote = "https://notes.example.invalid/personal.git", bare = path.join(root, "personal.git");
let app, page, checkedCloudSettings = false;
async function launch(name) {
  const profile = path.join(root,name); await mkdir(profile);
  app = await _electron.launch({ executablePath: process.env.DYNOTE_EXECUTABLE || createRequire(import.meta.url)("electron"),
    args: process.env.DYNOTE_EXECUTABLE ? [] : ["."], env: { ...env, OPEN_NOTES_DATA: profile } });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1050,700));
  await page.getByRole("button",{name:"공간 전환·관리",exact:true}).click();
  if (!checkedCloudSettings) {
    const settings = page.getByRole("dialog", {name:"설정", exact:true});
    await settings.getByRole("button", {name:"Copilot 중계 Git", exact:true}).click();
    await settings.getByText(/현재 Direct Copilot을 사용합니다/).waitFor();
    await settings.getByRole("button", {name:"노트 백업 설정 열기", exact:true}).click();
    await settings.getByRole("navigation", {name:"백업 작업"}).waitFor();
    await settings.getByRole("button", {name:"보관함", exact:true}).click();
    checkedCloudSettings = true;
  }
  await page.getByRole("button",{name:"개인 노트",exact:true}).waitFor();
  const entries=page.locator(".vault-entry-list button");
  assert.equal(await entries.count(),2);
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
  await page.waitForFunction(() => [...document.querySelectorAll(".vault-entry-list button")].every(button => {
    const rect=button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2));
  }));
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await openVaultSection(page,"개인 노트");
}
const pick = folder => app.evaluate(({dialog}, folder) => {
  dialog.showOpenDialog = async () => ({canceled:!folder,filePaths:folder?[folder]:[]});
},folder);
const button = name => page.getByRole("button",{name,exact:true});
async function openFolder(folder) {
  await pick(folder); await button("개인 노트 폴더 연결").click();
  const row=page.locator(".vault-settings-list li").filter({has:page.getByText(folder,{exact:true})});
  await row.getByText("사용 중",{exact:true}).waitFor();
  return row;
}
async function setup(folder, device) {
  const row=await openFolder(folder);
  await row.getByRole("button",{name:"동기화 설정",exact:true}).click();
  await page.getByRole("button",{name:"GitHub 로그인",exact:true}).waitFor();
  await page.getByLabel("Git 사용 방식").selectOption("personal-sync");
  await page.getByLabel("이 기기 이름").fill(device);
  await page.getByLabel("Git 저장소 주소",{exact:true}).fill(remote);
}
try {
  git(root,"init","--bare","--initial-branch=main",bare);
  git(root,"config","--global",`url.${bare.replaceAll("\\","/")}.insteadOf`,remote);
  git(root,"config","--global","user.name","Dynote QA");git(root,"config","--global","user.email","qa@example.invalid");
  const cloud=path.join(root,"기존 메모"), local=path.join(root,"받을 폴더"), other=path.join(root,"다른 메모");
  for(const p of [cloud,local,other]) await mkdir(p);
  await writeFile(path.join(cloud,"회의.md"),"오후 세 시\n"); await writeFile(path.join(other,"초안.md"),"로컬 초안\n");
  await launch("cloud-profile"); await setup(cloud,"Cloud PC");
  await assert.rejects(access(path.join(cloud,".git")),{code:"ENOENT"});
  await button("이 설정으로 동기화").click();
  await page.getByText("동기화됨",{exact:true}).first().waitFor();
  assert.equal(git(bare,"show","main:회의.md"),"오후 세 시");
  assert.equal(git(cloud,"config","remote.origin.url"),remote);
  await app.close(); app=null;
  await launch("local-profile");
  await setup(other,"Local PC"); await button("이 설정으로 동기화").click();
  await page.getByRole("alert").filter({hasText:"공통 Git 이력"}).waitFor();
  await assert.rejects(access(path.join(other,".git")),{code:"ENOENT"});
  assert.equal(await readFile(path.join(other,"초안.md"),"utf8"),"로컬 초안\n");
  await app.close();app=null;
  await launch("fresh-profile");
  await button("기존 Git 저장소에서 가져오기").click();
  const form=page.getByRole("form",{name:"개인 노트 가져오기"});
  await form.getByLabel("저장소 주소").fill(remote); await form.getByLabel("이 기기 이름").fill("새 PC");
  await pick(other);await button("빈 폴더 선택하고 가져오기").click();
  await page.getByRole("alert").filter({hasText:"빈 폴더"}).waitFor();
  await pick(local);await button("빈 폴더 선택하고 가져오기").click();
  await page.getByRole("dialog",{name:"설정",exact:true}).waitFor({state:"hidden"});
  assert.equal(await readFile(path.join(local,"회의.md"),"utf8"),"오후 세 시\n");
  assert.equal(git(local,"config","remote.origin.url"),remote);
  const reg=JSON.parse(await readFile(path.join(root,"fresh-profile","settings.json"),"utf8"));
  assert.deepEqual(Object.entries(reg.vaultPurposes).filter(([,v])=>v==="personal"),[[local,"personal"]]);
  const checkout=path.join(root,"기존 Git");git(root,"clone",remote,checkout);git(checkout,"switch","-c","notes");
  await button("공간 전환·관리").click();await openVaultSection(page,"개인 노트");
  const row=await openFolder(checkout);await row.getByRole("button",{name:"동기화 설정",exact:true}).click();
  await page.waitForFunction(url=>document.querySelector('[aria-label="Git 저장소 주소"]').value===url,remote);
  assert.equal(await page.getByLabel("Git 브랜치",{exact:true}).inputValue(),"notes");
  console.log("Verified folder-only setup, first upload, unrelated local data protection, fresh-PC import and existing Git defaults.");
} finally { await app?.close(); await rm(root,{recursive:true,force:true}); }
