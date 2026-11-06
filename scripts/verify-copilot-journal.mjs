import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {localDate} from '../core/periodic-notes.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await realpath(await mkdtemp(path.join(tmpdir(),'dynote-copilot-journal-'))),profile=path.join(root,'profile'),vault=path.join(root,'vault'),team=path.join(root,'team'),source=path.join(root,'workspaceStorage');
const output=process.env.DYNOTE_UI_OUTPUT||'output/playwright/copilot-journal',mod=process.platform==='darwin'?'Meta':'Control',journal=`Journal/${localDate()}.md`;
for(const directory of [profile,path.join(vault,'Journal'),team,path.join(source,'project/chatSessions'),output])await mkdir(directory,{recursive:true});
await writeFile(path.join(profile,'settings.json'),JSON.stringify({vaultRoot:vault,vaults:[vault,team],vaultPurposes:{[vault]:'personal',[team]:'team'}}));
await writeFile(path.join(vault,journal),'# Today\n\n사용자가 직접 작성한 기록\n');
await writeFile(path.join(team,'Shared.md'),'# 팀 기록\n');
await writeFile(path.join(source,'project/workspace.json'),JSON.stringify({folder:pathToFileURL(path.join(root,'Work')).href}));
const put=async(id,title,question)=>writeFile(path.join(source,`project/chatSessions/${id}.json`),JSON.stringify({version:3,sessionId:id,customTitle:title,requests:[{requestId:'q',timestamp:Date.now(),message:{text:question},modelState:{value:1},response:[{kind:'thinking',value:'DO NOT IMPORT THINKING'},{value:'검증용 답변'}]}]}));
await put('first','검토 대화','첫 질문 원문');
const launch=()=>electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE||path.join(process.cwd(),'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:process.env.DYNOTE_EXECUTABLE?[]:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
let app=await launch(),page;const checks=[],errors=[];
const setup=async()=>{page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1280,1000));await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();};
const check=async(name,action)=>{console.error(name);await action();checks.push(name);};
const settings=()=>page.getByRole('dialog',{name:'설정',exact:true});
const closeSettings=async()=>{
 await settings().getByRole('button',{name:'프로젝트 새로고침',exact:true,disabled:false}).waitFor();
 await settings().getByRole('button',{name:'닫기',exact:true}).click();
 await settings().waitFor({state:'hidden'});
};
const captureState=()=>page.evaluate(async()=>{const {value}=await window.notes.snapshot();return (await window.notes.captureStatus({vaultId:value.id})).value;});
const pauseCaptureScan=()=>app.evaluate((_electron,directory)=>{
 const fs=process.getBuiltinModule('node:fs/promises');
 const {syncBuiltinESMExports}=process.getBuiltinModule('node:module');
 const readdir=fs.readdir;
 fs.readdir=async(target,options)=>{
  if(target===directory){
   fs.readdir=readdir;
   syncBuiltinESMExports();
   await new Promise(resolve=>{globalThis.resumeCaptureScan=()=>{delete globalThis.resumeCaptureScan;resolve();};});
  }
  return readdir(target,options);
 };
 syncBuiltinESMExports();
},path.join(source,'project/chatSessions'));
const waitForCaptureScan=()=>app.evaluate(async()=>{
 for(let attempt=0;attempt<200&&!globalThis.resumeCaptureScan;attempt++)
  await new Promise(resolve=>setTimeout(resolve,50));
 if(!globalThis.resumeCaptureScan)throw new Error('Automatic capture did not reach the test transcript folder');
});
const resumeCaptureScan=()=>app.evaluate(()=>globalThis.resumeCaptureScan?.());
try{
 await app.evaluate(({Tray})=>{
  const setMenu=Tray.prototype.setContextMenu;
  Tray.prototype.setContextMenu=function(menu){
   globalThis.captureTestTray=menu;
   return setMenu.call(this,menu);
  };
 });
 await setup();
 await check('journal offers an import button before any project is configured',async()=>assert.equal(await page.getByRole('button',{name:'가져오기',exact:true}).count(),1));
 await page.getByRole('region',{name:'팀 공유 노트 · team',exact:true}).getByRole('button',{name:'Shared',exact:true}).click();
 await page.getByRole('region',{name:'문서 Shared.md',exact:true}).waitFor();
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 await page.getByRole('button',{name:'가져오기',exact:true}).click();await settings().waitFor();
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
 const sourceButton=settings().getByRole('button',{name:'기록 폴더 선택',exact:true});
 await settings().getByRole('button',{name:'프로젝트 새로고침',exact:true,disabled:false}).waitFor();
 assert.equal(await sourceButton.isEnabled(),true,'Copilot settings should be usable from the team journal');
 await sourceButton.click();await page.waitForFunction(source=>document.querySelector('.capture-source-path')?.textContent===source,source);await settings().locator('.capture-project input').check();
 await settings().getByRole('button',{name:'오늘 대화 가져오기',exact:true}).click();
 await page.waitForFunction(async()=>{
  const {value}=await window.notes.snapshot();
  return (await window.notes.captureStatus({vaultId:value.id})).value?.records.length===1;
 });
 await closeSettings();
 let state=await captureState(),record=state.records[0];
 await check('manual import from the team journal writes only to the personal vault',async()=>{
  assert.equal(state.enabled,false);assert.equal(state.records.length,1);assert.equal(record.sessions.length,1);
  assert.deepEqual(await readdir(team),['Shared.md']);
  assert.match(await page.getByRole('button',{name:'공간 전환·관리',exact:true}).innerText(),/팀 공유 노트/);
  assert.equal(await page.locator('.capture-record-title').count(),0);
  const content=await readFile(path.join(vault,record.path),'utf8');assert.match(content,/첫 질문 원문/);assert.doesNotMatch(content,/DO NOT IMPORT/);
  assert.match(await readFile(path.join(vault,journal),'utf8'),/사용자가 직접 작성한 기록/);
  assert.match(await readFile(path.join(source,'project/chatSessions/first.json'),'utf8'),/첫 질문 원문/);
 });
 await page.getByRole('button',{name:'파일 목록',exact:true}).click();
 await page.getByRole('region',{name:'개인 노트 · vault',exact:true}).getByTitle(journal,{exact:true}).click();
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 await page.getByRole('button',{name:'저널 자동기록 설정',exact:true}).click();await settings().getByRole('checkbox',{name:'자동 기록',exact:true}).check();await settings().getByRole('button',{name:'설정 적용',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.capture-toolbar')?.textContent.includes('켜짐'));
 await closeSettings();
 await check('idle Copilot scans leave the personal journal enabled with a sticky note open',async()=>{
  const [sticky]=await Promise.all([
   app.waitForEvent('window'),
   app.evaluate(()=>globalThis.captureTestTray.getMenuItemById('sticky-new').click()),
  ]);
  await sticky.getByRole('textbox',{name:'포스트잇 메모'}).waitFor();
  const feed=page.getByRole('region',{name:'저널 피드',exact:true});
  const controls=feed.getByRole('button',{name:/^(저널 블록 추가|하위 블록 접기|하위 블록 펼치기|가져오기)$/});
  assert.equal(await controls.count(),4);
  await pauseCaptureScan();
  try{
   await waitForCaptureScan();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await controls.evaluateAll(buttons=>buttons.filter(button=>button.disabled).map(button=>button.textContent.trim())),[],
    'checking for new chats must leave all four journal buttons enabled');
   await feed.getByRole('textbox',{name:'Markdown 편집기',exact:true}).click();
   await page.keyboard.press(`${mod}+End`);
   await page.keyboard.insertText('\n\n스캔 중 저장');
   await page.keyboard.press(`${mod}+s`);
   await page.locator('.save-status.saved').waitFor();
   assert.match(await readFile(path.join(vault,journal),'utf8'),/스캔 중 저장/);
  }finally{
   await resumeCaptureScan();
  }
 });
 await page.getByRole('button',{name:'파일 목록',exact:true}).click();
 await page.getByRole('region',{name:'팀 공유 노트 · team',exact:true}).getByRole('button',{name:'Shared',exact:true}).click();
 const teamPane=page.getByRole('region',{name:'문서 Shared.md',exact:true});
 await teamPane.waitFor();
 await pauseCaptureScan();
 await put('second','보존할 두 번째 대화','두 번째 질문');
 try {
  await waitForCaptureScan();
  const teamEditor=teamPane.getByRole('textbox',{name:'Markdown 편집기',exact:true});
  assert.equal(await teamEditor.evaluate(el=>el.cmTile.root.view.state.readOnly),false,'the personal scan must not lock the team editor');
  await teamEditor.click();await page.keyboard.press(`${mod}+End`);
  await page.keyboard.insertText('Team can save');
  await page.keyboard.press(`${mod}+s`);
  await page.locator('.save-status.saved').waitFor();
  assert.equal(await readFile(path.join(team,'Shared.md'),'utf8'),'# 팀 기록\nTeam can save');
  checks.push('team editing and saving complete while the personal capture scan is in progress');
 } finally {
  await resumeCaptureScan();
 }
 await check('a new session is added to the personal journal while the team document remains focused',async()=>{
  await page.waitForFunction(async()=>{
   const {value}=await window.notes.snapshot();
   const response=await window.notes.captureStatus({vaultId:value.id});
   return response.value?.records[0]?.sessions.length===2;
  },undefined,{polling:300});
  assert.ok((await teamPane.getAttribute('class')).includes('focused'));
  assert.deepEqual(await readdir(team),['Shared.md']);
  assert.equal(await readFile(path.join(team,'Shared.md'),'utf8'),'# 팀 기록\nTeam can save');
  await page.getByRole('region',{name:'개인 노트 · vault',exact:true}).getByTitle(journal,{exact:true}).click();
  await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.capture-record-title')?.textContent.includes('2건'));
  state=await captureState();
  assert.equal(state.records.length,1);assert.equal(state.records[0].sessions.length,2);
  assert.equal((await readFile(path.join(vault,journal),'utf8')).match(/^<!-- dynote:copilot /gm).length,1);
 });
 await page.locator('.capture-record details summary').click();await page.screenshot({path:path.join(output,'journal-titles.png')});
 await page.getByRole('button',{name:'검토 대화 대화 삭제',exact:true}).click();
 await check('a title delete button removes only that conversation and reimport cannot revive it',async()=>{
  await page.waitForFunction(()=>document.querySelector('.capture-record-title')?.textContent.includes('1건'));
  await page.getByRole('button',{name:'가져오기',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.capture-toolbar button')?.disabled);
  state=await captureState();assert.equal(state.records[0].sessions.length,1);const content=await readFile(path.join(vault,record.path),'utf8');assert.match(content,/두 번째 질문/);assert.doesNotMatch(content,/첫 질문 원문/);
  assert.doesNotMatch(await readFile(path.join(profile,'copilot-journal.json'),'utf8'),/첫 질문 원문/);
 });
 const editor=page.getByRole('region',{name:'저널 피드',exact:true}).getByRole('textbox',{name:'Markdown 편집기',exact:true});
 await check('Live Preview hides capture control markers',async()=>assert.doesNotMatch(await editor.textContent(),/dynote:copilot/));await editor.click();await page.keyboard.press(`${mod}+End`);await put('third','세 번째 대화','자동 수집 중 질문');await page.keyboard.type('입력 중인 내용도 보존합니다'.repeat(20),{delay:15});await page.keyboard.press(`${mod}+s`);
 await check('automatic refresh keeps the user journal text and the editor mode',async()=>{await page.waitForFunction(()=>document.querySelector('.capture-record-title')?.textContent.includes('2건'));assert.match(await readFile(path.join(vault,journal),'utf8'),/입력 중인 내용도 보존합니다/);assert.equal(await page.locator('.journal-feed .cm-live-preview').count(),1);});
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 await page.getByRole('button',{name:`Work ${localDate()} 기록 삭제`,exact:true}).click();
 await check('group title delete removes the record and managed link together',async()=>{await page.locator('.capture-record').waitFor({state:'detached'});await assert.rejects(readFile(path.join(vault,record.path)),{code:'ENOENT'});const content=await readFile(path.join(vault,journal),'utf8');assert.match(content,/입력 중인 내용도 보존합니다/);assert.doesNotMatch(content,/dynote:copilot /);});
 await page.getByRole('button',{name:'삭제 되돌리기',exact:true}).click();await page.locator('.capture-record').waitFor();
 await check('undo restores the document and journal link without unrelated deleted chats',async()=>{const content=await readFile(path.join(vault,record.path),'utf8');assert.match(content,/두 번째 질문/);assert.doesNotMatch(content,/첫 질문 원문/);assert.match(await readFile(path.join(vault,journal),'utf8'),/dynote:copilot /);});
 await page.getByRole('button',{name:`Work ${localDate()} 기록 삭제`,exact:true}).click();await page.locator('.capture-record').waitFor({state:'detached'});
 await app.close();app=await launch();await setup();
 await page.getByRole('button',{name:'가져오기',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.capture-toolbar button')?.disabled);
 await check('deletion exclusions survive restart and explicit import',async()=>{assert.equal((await captureState()).records.length,0);await assert.rejects(readFile(path.join(vault,record.path)),{code:'ENOENT'});});
 await check('team and stale-vault IPC cannot capture private chats',async()=>{
  const result=await page.evaluate(async team=>{const before=(await window.notes.snapshot()).value;const selected=await window.notes.selectVault({root:team});return [selected,await window.notes.syncCapture({vaultId:before.id,manual:true}),await window.notes.syncCapture({vaultId:selected.value.id,manual:true})];},team);
  assert.equal(result[0].ok,true);assert.equal(result[1].ok,false);assert.equal(result[2].ok,false);assert.match(result[2].error,/개인/);
 });
 await check('renderer has no errors',async()=>assert.deepEqual(errors,[]));
 await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log(JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));throw error;}
finally{await app.close();await rm(root,{recursive:true,force:true});}
