import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pauseDirectoryOperation } from "./pause-directory-operation.mjs";

const { _electron } = await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || "playwright");
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "dynote-switch-")));
const profile = path.join(temp, "profile"), registry = path.join(profile, "settings.json");
const roots = ["Personal", "Slow", "Last"].map(name => path.join(temp, name));
const [personal, slow, last] = roots;
const ids = roots.map(root => createHash("sha256").update(root).digest("hex").slice(0, 16));
const legacy = path.join(temp, "Legacy");
const plugin = "selection-test";
const data = id => path.join(profile, "plugins", "vaults", id, plugin + ".json");
const original = root => path.basename(root) + " original";
let app;
try {
  for (const [i,root] of roots.entries()) {
    await mkdir(root); await writeFile(path.join(root, "Shared.md"), original(root));
    await mkdir(path.dirname(data(ids[i])), {recursive:true});
    await writeFile(path.join(path.dirname(data(ids[i])), "enabled.json"), JSON.stringify([plugin]));
  }
  const program = path.join(profile, "plugins", "programs", plugin);
  await mkdir(program, {recursive:true});
  await writeFile(path.join(program, "manifest.json"), JSON.stringify({id:plugin, name:"Selection Test",version:"1"}));
  await writeFile(path.join(program, "main.js"), `module.exports = class extends require("obsidian").Plugin {
    async onload() { await this.saveData({phase:"loaded"}); }
    async onunload() { await this.saveData({phase:"unloaded"}); }
  }`);
  await mkdir(legacy);
  await writeFile(path.join(legacy, "Shared.md"), original(legacy));
  await writeFile(registry, JSON.stringify({vaultRoot:personal,vaults:[...roots, legacy],vaultPurposes:{[personal]:"personal",[slow]:"team",[last]:"team"}}));
  app = await _electron.launch({executablePath:createRequire(import.meta.url)("electron"),args:["."],env:{...process.env,OPEN_NOTES_DATA:profile}});
  const page = (await app.windows()).find(w=>w.url().endsWith("/index.html")) || await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.bringToFront();
  const settings = page.getByRole("dialog",{name:"설정",exact:true});
  const teamSettings = async () => {
    await page.getByRole("button",{name:"공간 전환·관리",exact:true}).click();
    const team = settings.getByRole("button",{name:"팀 노트",exact:true});
    if (await team.getAttribute("aria-expanded") !== "true") await team.click();
    await settings.getByText("Git 저장소 없음",{exact:true}).last().waitFor();
  };
  const select = root => settings.locator(".vault-settings-list li").filter({has:page.getByText(root,{exact:true})})
    .getByRole("button",{name:"열기",exact:true}).click();
  const close = () => settings.getByRole("button",{name:"닫기",exact:true}).click();
  const editor = page.getByRole("textbox",{name:"Markdown 편집기"});
  const edit = async content => { await editor.click(); await page.keyboard.insertText(content); };
  const save = async () => { await page.keyboard.press(process.platform === "darwin" ? "Meta+s" : "Control+s"); await page.locator(".save-status.saved").waitFor(); };
  const switching = page.getByRole("status").filter({hasText:"보관함 전환 중"});
  const current = async () => JSON.parse(await readFile(registry,"utf8")).vaultRoot;
  await page.getByRole("region",{name:"개인 노트 · Personal",exact:true}).getByTitle("Shared.md",{exact:true}).click();
  await page.getByRole("button",{name:"편집 보기",exact:true}).click();

  // Replace only external CLI I/O. The real controller handles streaming, cancellation and IPC.
  await app.evaluate(({app}) => {
    const require = process.getBuiltinModule("node:module").createRequire(app.getAppPath()+"/package.json");
    const {ClaudeController} = require("./electron/claude-controller.mjs");
    ClaudeController.prototype.status = async () => ({authenticated:true});
    ClaudeController.prototype.client = async () => ({});
    ClaudeController.prototype.process = (_cli, _args, {started,onLine}) => new Promise(resolve => {
      globalThis.fixtureDelta = text => onLine({type:"stream_event",event:{delta:{type:"text_delta",text}}});
      started(() => resolve({code:0}));
      globalThis.fixtureDelta("started");
    });
  });
  await page.evaluate(async vaultId => {
    window.switchAiEvents = [];
    window.notes.onClaudeEvent(event => window.switchAiEvents.push(event));
    const result = await window.notes.claudeSend({workspace:true, vaultId, requestId:"switch-test",model:"sonnet",mode:"chat",history:[],prompt:"fixture",context:{kind:"none"}});
    if (!result.ok) throw Error(result.error);
  },ids[0]);
  await page.waitForFunction(()=>window.switchAiEvents.some(event=>event.type==="delta" && event.content==="started"));
  assert.deepEqual(JSON.parse(await readFile(data(ids[0]),"utf8")), {phase:"loaded"});

  // A conflicting disk edit must preserve both the external bytes and the unsaved editor draft.
  await writeFile(path.join(personal,"Shared.md"), "external change");
  await edit("retained draft ");
  await teamSettings(); await select(slow);
  await page.getByText(/외부에서 문서가 변경/).first().waitFor();
  assert.equal(await current(), personal);
  assert.equal(await readFile(path.join(personal,"Shared.md"),"utf8"),"external change");
  await close(); assert.match(await editor.innerText(), /retained draft/);
  await writeFile(path.join(personal,"Shared.md"), original(personal)); await save();

  // Fail the registry's atomic rename too, after the note flush has succeeded.
  await app.evaluate((_electron, file) => {
    const fs = process.getBuiltinModule("node:fs/promises"), rename = fs.rename;
    const sync = process.getBuiltinModule("node:module").syncBuiltinESMExports;
    fs.rename = async (from,to) => {
      if (to !== file) return rename(from,to);
      fs.rename = rename; sync(); throw Error("selection settings fixture failure");
    };
    sync();
  },registry);
  await teamSettings(); await select(last);
  await page.getByText(/selection settings fixture failure/).first().waitFor();
  assert.equal(await current(),personal);
  assert.deepEqual(JSON.parse(await readFile(data(ids[0]),"utf8")), {phase:"loaded"});
  assert.ok(!(await readdir(profile)).some(name=>name.startsWith("settings.json.") && name.endsWith(".tmp")));
  await app.evaluate(()=>globalThis.fixtureDelta(" still working"));
  await page.waitForFunction(()=>window.switchAiEvents.some(event=>event.type==="delta" && event.content==="started still working"));

  const pending = await pauseDirectoryOperation(app,"readdir",slow);
  try {
    await select(slow); await pending.wait(); await close();
    await edit("while loading "); await save();
    assert.match(await readFile(path.join(personal,"Shared.md"),"utf8"),/while loading/);
    assert.equal(await readFile(path.join(slow,"Shared.md"),"utf8"),original(slow));
    await teamSettings(); await select(last);
    await page.waitForFunction(async root => (await window.notes.vaults()).value.current === root,last);
  } finally { await pending.resume(); }
  await switching.waitFor({state:"hidden"});
  await page.waitForFunction(()=>window.switchAiEvents.some(e=>e.requestId==="switch-test" && e.type==="canceled"));
  assert.equal(await current(),last);
  assert.deepEqual(JSON.parse(await readFile(data(ids[0]),"utf8")), {phase:"unloaded"});
  await assert.rejects(readFile(data(ids[1])),{code:"ENOENT"});
  assert.deepEqual(JSON.parse(await readFile(data(ids[2]),"utf8")), {phase:"loaded"});

  // Close settings before a successful return switch. New work must keep its pane and vault.
  await close();
  await page.getByRole("region",{name:"팀 공유 노트 · Last",exact:true}).getByTitle("Shared.md",{exact:true}).click();
  await page.getByRole("button",{name:"편집 보기",exact:true}).click();
  await teamSettings();
  const returning = await pauseDirectoryOperation(app,"readdir",slow);
  try {
    await select(slow); await returning.wait(); await close();
    await edit("in last "); await save();
  } finally {await returning.resume();}
  await switching.waitFor({state:"hidden"}); assert.equal(await current(),slow);
  assert.match(await editor.innerText(),/in last/); await edit("still in last "); await save();
  assert.match(await readFile(path.join(last,"Shared.md"),"utf8"),/still in last/);
  assert.equal(await readFile(path.join(slow,"Shared.md"),"utf8"),original(slow));
  // Keep editing the target document even while its plug-in is starting after selection.
  await teamSettings();
  const startingPlugin = await pauseDirectoryOperation(app, "readFile", path.join(path.dirname(data(ids[2])), "enabled.json"));
  try {
    await select(last); await startingPlugin.wait(); await close();
    await edit("during plugin startup "); await save();
    assert.match(await readFile(path.join(last,"Shared.md"),"utf8"), /during plugin startup/);
  } finally { await startingPlugin.resume(); }
  await switching.waitFor({state:"hidden"});
  assert.match(await editor.innerText(), /during plugin startup/);
  assert.equal(await current(), last);

  // A legacy vault becomes unreachable at handover. Drain its last edit before switching.
  await teamSettings(); await select(legacy);
  await switching.waitFor({state:"hidden"});
  assert.equal(await current(), legacy);
  await close();
  await page.getByRole("button", {name:"전체 검색",exact:true}).click();
  await page.getByRole("textbox", {name:"전체 문서 검색",exact:true}).fill("Legacy original");
  await page.locator(".search-result").filter({hasText:"보관함 · Legacy"}).click();
  await page.getByRole("button", {name:"편집 보기",exact:true}).click();
  assert.match(await editor.innerText(), /Legacy original/);
  const fresh = path.join(temp, "Fresh");
  await mkdir(fresh);
  await writeFile(path.join(fresh, "Shared.md"), original(fresh));
  await app.evaluate(({dialog}, root) => {
    dialog.showOpenDialog = async () => ({canceled:false, filePaths:[root]});
  }, fresh);
  await teamSettings();
  const linking = await pauseDirectoryOperation(app, "readdir", fresh);
  try {
    await settings.getByRole("button", {name:"팀 공유 폴더 연결",exact:true}).click();
    await linking.wait(); await close();
    await edit("last legacy draft ");
  } finally { await linking.resume(); }
  await switching.waitFor({state:"hidden"});
  assert.equal(await current(), fresh);
  assert.match(await readFile(path.join(legacy,"Shared.md"),"utf8"), /last legacy draft/);
  assert.equal(await readFile(path.join(fresh,"Shared.md"),"utf8"), original(fresh));
  console.log("PASS concurrent selection, scoped edit/save, draft and registry failures, late completion, AI cancellation and per-vault plugin lifecycle");
} finally {
  if(app) { await app.evaluate(({app})=>app.exit(0)).catch(()=>{}); await app.close().catch(()=>{}); }
  await rm(temp,{recursive:true,force:true});
}
