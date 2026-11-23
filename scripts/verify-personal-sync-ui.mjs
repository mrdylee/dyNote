import { mkdtemp, mkdir, writeFile, realpath, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const executablePath=process.env.DYNOTE_EXECUTABLE || createRequire(import.meta.url)("electron");
const temp=await realpath(await mkdtemp(path.join(tmpdir(),"dynote-ui-sync-")));
const bare=path.join(temp,"shared.git"), apps=[],remote="https://dynote.invalid/test.git";
execFileSync("git",["init","--bare","--initial-branch=main",bare],{stdio:"ignore"});
const cfg=path.join(temp,"gitconfig");
execFileSync("git",["config","--file",cfg,"url."+bare.replaceAll("\\","/")+".insteadOf",remote]);
const cmd=process.platform==="darwin"?"Meta":"Control";
async function launch(name, seed) {
  const root=path.join(temp,name),profile=path.join(temp,name+"-profile");
  await mkdir(root);await mkdir(profile);
  if(seed)await writeFile(path.join(root,"회의록.md"),"회의 1시\n");
  await writeFile(path.join(profile,"settings.json"),JSON.stringify({vaultRoot:root,vaults:[root],vaultPurposes:{[root]:"personal"}}));
  const app=await electron.launch({executablePath,args:process.env.DYNOTE_PACKAGED==="1"?[]:["."],env:{...process.env,OPEN_NOTES_DATA:profile,GIT_CONFIG_GLOBAL:cfg,GIT_CONFIG_NOSYSTEM:"1"},timeout:30000});
  apps.push(app); const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>typeof window.notes?.connectGit==="function");
  const invoke=async (method,args={})=>page.evaluate(async({method,args})=>{
    const {value:scope}=await window.notes.snapshot({});
    const result=await window.notes[method]({vaultId:scope.id,workspace:true,...args});
    if(!result.ok)throw new Error(result.error);return result.value;
  },{method,args});
  const status=await invoke("connectGit",{config:{remote,branch:"main",mode:"personal-sync",deviceName:name,authorName:"Synthetic Writer",authorEmail:"test@example.invalid",zipPaths:[]}});
  assert.equal(status.phase,"synced");
  return {page,root,invoke,sync:()=>invoke("syncGit")};
}
async function editor(pc) {
  await pc.page.keyboard.press(cmd+"+k");
  await pc.page.getByRole("textbox",{name:"빠른 문서 검색"}).fill("path:회의록.md");
  await pc.page.keyboard.press("Enter");
  await pc.page.locator(".breadcrumbs").filter({hasText:"회의록"}).waitFor();
  await pc.page.getByRole("button",{name:"편집 보기",exact:true}).click();
  return pc.page.getByRole("textbox",{name:"Markdown 편집기"});
}
try {
  const a=await launch("Cloud",true),b=await launch("Local",false);
  await a.sync(); const view=await editor(b);
  await a.invoke("saveNote",{path:"회의록.md",content:"회의 2시\n",revision:(await a.invoke("snapshot")).notes.find(n=>n.path==="회의록.md").revision});
  await a.sync();
  await b.page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await b.page.waitForFunction(()=>document.querySelector(".cm-content")?.textContent.includes("회의 2시"));
  await view.click();await view.press(cmd+"+End");await b.page.keyboard.insertText("Local에서 이어 씀");
  await b.page.evaluate(()=>window.dispatchEvent(new Event("blur")));
  await b.page.waitForFunction(async()=>{const {value:v}=await window.notes.snapshot({});return v.notes.some(n=>n.content.includes("Local에서 이어 씀"));});
  await b.sync();await a.sync();
  assert.match(await readFile(path.join(a.root,"회의록.md"),"utf8"),/Local에서 이어 씀/);
  await a.sync();await b.sync();
  await Promise.all([writeFile(path.join(a.root,"회의록.md"),"회의 3시\n"),writeFile(path.join(b.root,"회의록.md"),"회의 4시\n")]);
  await a.sync();await b.sync();await a.sync();
  await b.page.getByRole("button",{name:/버전 확인 · 2개/}).click();
  const dialog=b.page.getByRole("dialog",{name:"버전 확인"});
  await dialog.getByRole("radio",{name:/회의 3시.*Cloud/}).first().check();
  await dialog.getByRole("button",{name:"선택한 버전으로 적용"}).click();
  await dialog.waitFor({state:"hidden"});await a.sync();
  assert.equal(await readFile(path.join(a.root,"회의록.md"),"utf8"),"회의 3시\n");
  console.log("PASS two Electron profiles: focus receive into open editor, blur send, competing versions and selection");
} finally {
  for(const app of apps.reverse()) await app.close().catch(()=>app.process().kill());
  await rm(temp,{recursive:true,force:true,maxRetries:3});
}
