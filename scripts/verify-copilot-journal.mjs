import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localDate} from '../core/periodic-notes.mjs';
import {captureLink,renderCapture} from '../core/copilot-journal.mjs';
import {captureLinkRanges} from '../core/copilot-journal-links.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await realpath(await mkdtemp(path.join(tmpdir(),'dynote-copilot-journal-'))),profile=path.join(root,'profile'),vault=path.join(root,'vault'),team=path.join(root,'team'),source=path.join(root,'workspaceStorage');
const output=process.env.DYNOTE_UI_OUTPUT||'output/playwright/copilot-journal',mod=process.platform==='darwin'?'Meta':'Control',journal=`Journal/${localDate()}.md`;
for(const directory of [profile,path.join(vault,'Journal'),team,path.join(source,'project/chatSessions'),output])await mkdir(directory,{recursive:true});
await writeFile(path.join(profile,'settings.json'),JSON.stringify({vaultRoot:vault,vaults:[vault,team],vaultPurposes:{[vault]:'personal',[team]:'team'}}));
await writeFile(path.join(vault,journal),'# Today\n\n사용자가 직접 작성한 기록\n');
await writeFile(path.join(team,'Shared.md'),'# 팀 기록\n');
await writeFile(path.join(source,'project/workspace.json'),JSON.stringify({folder:'vscode-remote://wsl%2BUbuntu/home/dev/WSL%20Work'}));
const put=async(id,title,...questions)=>writeFile(path.join(source,`project/chatSessions/${id}.json`),JSON.stringify({version:3,sessionId:id,customTitle:title,requests:questions.map((text,index)=>({requestId:`q${index}`,timestamp:Date.now(),message:{text},modelState:{value:1},response:[{kind:'thinking',value:'DO NOT IMPORT THINKING'},{value:'검증용 답변'}]}))}));
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
const sessionOptions=()=>settings().getByRole('group',{name:'가져올 세션',exact:true});
const loadSessions=async()=>{
 await settings().getByRole('button',{name:'세션 불러오기',exact:true}).click();
 await settings().getByRole('button',{name:'세션 불러오기',exact:true,disabled:false}).waitFor();
};
const importSession=async title=>{
 await loadSessions();
 await sessionOptions().getByRole('checkbox',{name:new RegExp(`^${title}`)}).check();
 await settings().getByRole('button',{name:'선택한 세션 가져오기',exact:true}).click();
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
const captureScanStarted=(attempts=200)=>app.evaluate(async(_electron,attempts)=>{
 for(let attempt=0;attempt<attempts&&!globalThis.resumeCaptureScan;attempt++)
  await new Promise(resolve=>setTimeout(resolve,50));
 return Boolean(globalThis.resumeCaptureScan);
},attempts);
const waitForCaptureScan=async()=>assert.ok(await captureScanStarted(),'Automatic capture did not reach the test transcript folder');
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
 const morning=new Date();morning.setHours(8,0,0,0);
 await page.clock.install({time:morning});
 await page.reload();
 await page.getByRole('button',{name:'가져오기',exact:true}).waitFor();
 await check('journal offers an import button before any project is configured',async()=>assert.equal(await page.getByRole('button',{name:'가져오기',exact:true}).count(),1));
 await page.getByRole('region',{name:'팀 공유 노트 · team',exact:true}).getByRole('button',{name:'Shared',exact:true}).click();
 await page.getByRole('region',{name:'문서 Shared.md',exact:true}).waitFor();
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 await page.getByRole('button',{name:'가져오기',exact:true}).click();await settings().waitFor();
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
 const sourceButton=settings().getByRole('button',{name:'기록 폴더 선택',exact:true,disabled:false});
 await sourceButton.waitFor();
 await sourceButton.click();await page.waitForFunction(source=>document.querySelector('.capture-source-path')?.textContent===source,source);
 await settings().getByText('WSL (Ubuntu) · /home/dev/WSL Work',{exact:true}).waitFor();
 await check('WSL source selection rejects a regular Windows or Mac folder',async()=>{
  await settings().getByRole('button',{name:'WSL 기록 폴더 선택',exact:true}).click();
  await settings().getByRole('alert').getByText('WSL 배포판의 session-state 폴더를 선택해 주세요.',{exact:true}).waitFor();
 });
 await settings().locator('.capture-project input').check();
 await check('manual import offers sessions instead of a date range and reports an empty source',async()=>{
  assert.equal(await settings().getByRole('group',{name:'가져올 기간',exact:true}).count(),0);
  await loadSessions();
  await settings().getByRole('status').filter({hasText:'가져올 수 있는 완료된 대화 세션이 없습니다.'}).waitFor();
  assert.equal(await settings().getByRole('button',{name:'선택한 세션 가져오기',exact:true}).isDisabled(),true);
  assert.equal((await captureState()).records.length,0);
 });
 await put('first','검토 대화','첫 질문 원문');
 await importSession('검토 대화');
 await page.waitForFunction(async()=>{
  const {value}=await window.notes.snapshot();
  return (await window.notes.captureStatus({vaultId:value.id})).value?.records.length===1;
 });
 await settings().getByText('선택한 세션의 대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
 await closeSettings();
 let state=await captureState(),record=state.records[0];
 await check('manual import opened from a team document shows and writes only the personal journal',async()=>{
  assert.equal(state.enabled,false);assert.equal(state.records.length,1);assert.equal(record.sessions.length,1);
  assert.deepEqual(await readdir(team),['Shared.md']);
  assert.match(await page.getByRole('button',{name:'공간 전환·관리',exact:true}).innerText(),/개인 노트/);
  assert.equal(await page.locator('.capture-record-title').count(),1);
  assert.equal(await page.getByRole('button',{name:'프로젝트별 기록',exact:true}).count(),1);
  const content=await readFile(path.join(vault,record.sessions[0].path),'utf8');assert.match(content,/첫 질문 원문/);assert.doesNotMatch(content,/DO NOT IMPORT/);
  assert.match(await readFile(path.join(vault,journal),'utf8'),/사용자가 직접 작성한 기록/);
  assert.match(await readFile(path.join(source,'project/chatSessions/first.json'),'utf8'),/첫 질문 원문/);
 });
 await page.getByRole('button',{name:'파일 목록',exact:true}).click();
 await page.getByRole('region',{name:'개인 노트 · vault',exact:true}).getByTitle(journal,{exact:true}).click();
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 await page.getByRole('button',{name:'저널 자동기록 설정',exact:true}).click();await settings().getByRole('checkbox',{name:'자동 기록',exact:true}).check();await settings().getByRole('button',{name:'설정 적용',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.capture-toolbar')?.textContent.includes('켜짐'));
 await closeSettings();
 await check('the first hourly scan leaves the personal journal enabled with a sticky note open',async()=>{
  const [sticky]=await Promise.all([
   app.waitForEvent('window'),
   app.evaluate(()=>globalThis.captureTestTray.getMenuItemById('sticky-new').click()),
  ]);
  await sticky.getByRole('textbox',{name:'Sticky Note 메모'}).waitFor();
  const feed=page.getByRole('region',{name:'저널 피드',exact:true});
  const controls=feed.getByRole('button',{name:/^(저널 블록 추가|하위 블록 접기|하위 블록 펼치기|가져오기)$/});
  assert.equal(await controls.count(),4);
  await pauseCaptureScan();
  try{
   await page.clock.fastForward('59:00');
   assert.equal(await captureScanStarted(20),false,'automatic capture must wait until the one-hour tick');
   await page.clock.fastForward('01:00');
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
  await page.clock.fastForward('01:00:00');
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
  assert.equal(captureLinkRanges(await readFile(path.join(vault,journal),'utf8')).length,2);
  assert.notEqual(state.records[0].sessions[0].path,state.records[0].sessions[1].path);
 });
 const firstPath=record.sessions[0].path;
 const secondPath=state.records[0].sessions.find(session=>session.title==='보존할 두 번째 대화').path;
 await check('a journal session title opens its own document',async()=>{
  await page.locator('.capture-record details summary').click();
  await page.getByRole('button',{name:'보존할 두 번째 대화',exact:true}).click();
  await page.getByRole('region',{name:`문서 ${secondPath}`,exact:true}).waitFor();
  await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 });
 await page.locator('.capture-record details summary').click();await page.screenshot({path:path.join(output,'journal-titles.png')});
 await page.getByRole('button',{name:'검토 대화 대화 삭제',exact:true}).click();
 await check('a title delete button removes only that conversation and reimport cannot revive it',async()=>{
  await page.waitForFunction(()=>document.querySelector('.capture-record-title')?.textContent.includes('1건'));
  await page.getByRole('button',{name:'가져오기',exact:true}).click();
  await importSession('보존할 두 번째 대화');
  await settings().getByText('선택한 세션에 새로 가져올 대화가 없습니다.',{exact:true}).waitFor();
  await closeSettings();
  state=await captureState();assert.equal(state.records[0].sessions.length,1);const content=await readFile(path.join(vault,secondPath),'utf8');assert.match(content,/두 번째 질문/);assert.doesNotMatch(content,/첫 질문 원문/);
  await assert.rejects(readFile(path.join(vault,firstPath)),{code:'ENOENT'});
  assert.doesNotMatch(await readFile(path.join(profile,'copilot-journal.json'),'utf8'),/첫 질문 원문/);
 });
 await check('manual session selection appends only new messages before the next hourly run',async()=>{
  await put('second','보존할 두 번째 대화','교체하면 안 되는 질문','즉시 가져올 첫 질문','즉시 가져올 두 번째 질문');
  await page.getByRole('button',{name:'가져오기',exact:true}).click();
  await importSession('보존할 두 번째 대화');
  await settings().getByText('선택한 세션의 대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
  await closeSettings();
  const content=await readFile(path.join(vault,secondPath),'utf8');
  assert.match(content,/> 두 번째 질문/);assert.doesNotMatch(content,/교체하면 안 되는 질문/);
  assert.match(content,/즉시 가져올 첫 질문/);assert.match(content,/즉시 가져올 두 번째 질문/);
  assert.equal(captureLinkRanges(await readFile(path.join(vault,journal),'utf8')).length,1);
 });
 const editor=page.getByRole('region',{name:'저널 피드',exact:true}).getByRole('textbox',{name:'Markdown 편집기',exact:true});
 await check('Live Preview hides capture control markers',async()=>assert.doesNotMatch(await editor.textContent(),/dynote:copilot/));await editor.click();await page.keyboard.press(`${mod}+End`);await put('third','세 번째 대화','자동 수집 중 질문');await page.keyboard.type('입력 중인 내용도 보존합니다'.repeat(20),{delay:15});await page.keyboard.press(`${mod}+s`);
 await page.locator('.save-status.saved').waitFor();
 await page.clock.fastForward('01:00:00');
 await check('automatic refresh keeps the user journal text and the editor mode',async()=>{await page.waitForFunction(()=>document.querySelector('.capture-record-title')?.textContent.includes('2건'));assert.match(await readFile(path.join(vault,journal),'utf8'),/입력 중인 내용도 보존합니다/);assert.equal(await page.locator('.journal-feed .cm-live-preview').count(),1);});
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
 const deleteGroup=page.getByRole('button',{name:`${record.label} ${localDate()} 기록 삭제`,exact:true});
 await deleteGroup.click();
 await check('group title delete removes the record and managed link together',async()=>{await page.locator('.capture-record').waitFor({state:'detached'});await assert.rejects(readFile(path.join(vault,secondPath)),{code:'ENOENT'});const content=await readFile(path.join(vault,journal),'utf8');assert.match(content,/입력 중인 내용도 보존합니다/);assert.doesNotMatch(content,/dynote:copilot /);});
 await page.getByRole('button',{name:'삭제 되돌리기',exact:true}).click();await page.locator('.capture-record').waitFor();
 await check('undo restores the document and journal link without unrelated deleted chats',async()=>{const content=await readFile(path.join(vault,secondPath),'utf8');assert.match(content,/두 번째 질문/);assert.doesNotMatch(content,/첫 질문 원문/);assert.match(await readFile(path.join(vault,journal),'utf8'),/dynote:copilot /);});
 await deleteGroup.click();await page.locator('.capture-record').waitFor({state:'detached'});
 const vaultId=await page.evaluate(async()=>(await window.notes.snapshot()).value.id);
 await app.close();
 const wslRoot=path.join(root,'session-state'),configFile=path.join(profile,'copilot-journal.json');
 await mkdir(wslRoot,{recursive:true});
 const config=JSON.parse(await readFile(configFile,'utf8'));
 config.vaults[vaultId].wslSource={root:wslRoot,distro:'ubuntu'};
 await writeFile(configFile,JSON.stringify(config));
 app=await launch();await setup();
 await page.getByRole('button',{name:'가져오기',exact:true}).click();
 await loadSessions();
 await check('deletion exclusions survive restart and omit deleted sessions from the picker',async()=>{
  assert.equal(await sessionOptions().getByRole('checkbox').count(),0);
  assert.equal((await captureState()).records.length,0);
  await assert.rejects(readFile(path.join(vault,secondPath)),{code:'ENOENT'});
 });
 await closeSettings();
 const pastAt=new Date();pastAt.setHours(12,0,0,0);pastAt.setDate(pastAt.getDate()-1);
 await check('a past WSL Agent Host session is selected and retried without a duplicate',async()=>{
  const date=localDate(pastAt),timestamp=pastAt.toISOString();
  await mkdir(path.join(wslRoot,'past'),{recursive:true});
  await writeFile(path.join(wslRoot,'past/workspace.yaml'),'cwd: /home/dev/WSL Work\nclient_name: vscode-agent-host\n');
  await writeFile(path.join(wslRoot,'past/events.jsonl'),[
   {type:'session.start',data:{sessionId:'past'}},
   {type:'user.message',id:'u',timestamp,data:{content:'어제 작성한 질문'}},
   {type:'assistant.message',id:'a',timestamp,data:{content:'검증용 답변',reasoningText:'DO NOT IMPORT THINKING'}},
   {type:'assistant.turn_end',data:{}},
  ].map(event=>JSON.stringify(event)).join('\n')+'\n');
  const unreadable=path.join(source,'project/chatSessions/unreadable.json');
  await writeFile(unreadable,JSON.stringify({version:99,sessionId:'unreadable',requests:[]}));
  await page.getByRole('button',{name:'저널 자동기록 설정',exact:true}).click();
  await settings().getByText(wslRoot,{exact:true}).waitFor();
  await importSession('어제 작성한 질문');
  await settings().getByText('선택한 세션의 대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
  await settings().getByRole('alert').filter({hasText:'VS Code 대화 일부를 읽지 못해 목록에서 제외했습니다.'}).waitFor();
  const [imported]=(await captureState()).records;
  assert.equal(imported.date,date);
  assert.equal(imported.journalPath,`Journal/${date}.md`);
  const content=await readFile(path.join(vault,imported.sessions[0].path),'utf8');
  assert.match(content,/어제 작성한 질문/);assert.doesNotMatch(content,/DO NOT IMPORT THINKING/);
  await settings().getByRole('button',{name:'선택한 세션 가져오기',exact:true}).click();
  await settings().getByText('선택한 세션에 새로 가져올 대화가 없습니다.',{exact:true}).waitFor();
  assert.equal((await readFile(path.join(vault,imported.journalPath),'utf8')).match(/^<!-- dynote:copilot /gm).length,1);
  await rm(unreadable);
  await closeSettings();
 });
 await check('an existing daily document is preserved while its journal link moves to the session',async()=>{
  const [imported]=(await captureState()).records;
  const newPath=imported.sessions[0].path;
  await app.close();
  const stored=JSON.parse(await readFile(configFile,'utf8')),legacy=stored.vaults[vaultId];
  const daily=legacy.records[imported.id];
  delete legacy.sessionLayout;
  legacy.projects={};
  legacy.enabled=false;
  await writeFile(configFile,JSON.stringify(stored));
  const original=renderCapture(daily)+'\n사용자 메모\n';
  await writeFile(path.join(vault,daily.path),original);
  await writeFile(path.join(vault,daily.journalPath),'# 지난 저널\n\n'+captureLink(daily));
  await rm(path.join(vault,newPath));
  app=await launch();await setup();
  await page.getByRole('button',{name:'가져오기',exact:true}).click();
  await page.locator('.capture-toolbar').getByText('기존 대화와 저널 링크를 세션별로 이관했습니다.',{exact:true}).waitFor();
  assert.equal(await readFile(path.join(vault,daily.path),'utf8'),original);
  assert.match(await readFile(path.join(vault,newPath),'utf8'),/어제 작성한 질문/);
  const links=captureLinkRanges(await readFile(path.join(vault,daily.journalPath),'utf8'));
  assert.equal(links.length,1);assert.ok(links[0].link.text.includes(newPath));
 });
 await check('project history groups imported sessions across dates and opens the selected session',async()=>{
  const earlier=new Date(pastAt);earlier.setDate(earlier.getDate()-1);
  const from=localDate(earlier),to=localDate(pastAt);
  const continuedTitle='이어진 세션 #1';
  const request=(id,timestamp,text)=>({requestId:id,timestamp,message:{text},modelState:{value:1}});
  const putSession=(project,id,customTitle,requests)=>writeFile(path.join(source,project,'chatSessions',`${id}.json`),JSON.stringify({version:3,sessionId:id,customTitle,requests}));
  await mkdir(path.join(source,'other/chatSessions'),{recursive:true});
  await writeFile(path.join(source,'other/workspace.json'),JSON.stringify({folder:'vscode-remote://wsl%2BDebian/home/dev/WSL%20Work'}));
  await putSession('project','aaa-older','먼저 끝난 세션',[request('a',+pastAt-3600000,'어제 오전 질문')]);
  await putSession('project','zzz-continued',continuedTitle,[
   request('a',+earlier,'처음 질문'),request('b',+pastAt+3600000,`이어진 질문\n\n## ${to}\n인용된 대화의 제목`),
  ]);
  await putSession('other','zzz-continued','다른 배포판의 세션',[request('a',+pastAt,'별개 프로젝트 질문')]);
  await page.getByRole('button',{name:'저널 자동기록 설정',exact:true}).click();
  await settings().getByRole('checkbox',{name:/WSL \(Ubuntu\)/}).check();
  await settings().getByRole('checkbox',{name:/WSL \(Debian\)/}).check();
  await loadSessions();
  const options=sessionOptions().getByRole('checkbox');
  assert.equal(await options.count(),4);
  await settings().screenshot({path:path.join(output,'session-picker.png')});
  for(const option of await options.all())await option.check();
  await settings().getByRole('button',{name:'선택한 세션 가져오기',exact:true}).click();
  await settings().getByText('선택한 세션의 대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
  await closeSettings();
  const {projects,records}=await captureState();
  const {key}=projects.find(project=>project.id==='project');
  const history=page.getByRole('dialog',{name:'프로젝트별 기록',exact:true});
  const openHistory=()=>page.getByRole('button',{name:'프로젝트별 기록',exact:true}).click({timeout:5000});
  const project=distro=>history.locator('.capture-history-project').filter({has:page.getByText(`WSL (${distro}) · /home/dev/WSL Work`,{exact:true})});
  const ubuntu=project('Ubuntu'),debian=project('Debian');
  await openHistory();
  await ubuntu.locator(':scope > summary').click();
  await debian.locator(':scope > summary').click();
  const sessionTitles=group=>group.locator('li > button > span').allTextContents();
  assert.deepEqual(await sessionTitles(ubuntu),[continuedTitle,'어제 작성한 질문','먼저 끝난 세션']);
  assert.deepEqual(await sessionTitles(debian),['다른 배포판의 세션']);
  await history.getByText('이전 날짜 기록',{exact:true}).click();
  await history.screenshot({path:path.join(output,'project-history.png')});
  await history.getByRole('button',{name:from,exact:true}).click();
  const sessionFor=date=>records.find(record=>record.projectKey===key&&record.date===date).sessions.find(session=>session.title===continuedTitle);
  const target=sessionFor(to).path;
  assert.equal(sessionFor(from).path,target);
  const pane=page.getByRole('region',{name:`문서 ${target}`,exact:true});
  const editor=pane.getByRole('textbox',{name:'Markdown 편집기',exact:true});
  const cursorLine=()=>editor.evaluate(el=>{
   const {state}=el.cmTile.root.view;
   return state.doc.lineAt(state.selection.main.head).text;
  });
  await pane.waitFor();
  assert.equal(await cursorLine(),`## ${from}`,'open the earlier date in the same session document');
  const openLatest=async()=>{
   await page.getByRole('button',{name:'달력과 일지',exact:true}).click();
   await openHistory();
   await ubuntu.locator(':scope > summary').click();
   await history.getByRole('button',{name:/^이어진 세션/}).click();
  };
  await openLatest();
  assert.equal(await cursorLine(),`## ${to}`,'skip matching headings quoted inside the session');
  const file=path.join(vault,target);
  const [heading,...sections]=(await readFile(file,'utf8')).split(/(?=^## )/m);
  const index=sections.findIndex(section=>section.startsWith(`## ${to}\n`));
  assert.ok(index>0);
  const reordered=[heading,sections[index],...sections.filter((_,i)=>i!==index)].map(part=>part.trimEnd()).join('\n\n')+'\n';
  await editor.evaluate((el,content)=>{
   const view=el.cmTile.root.view;
   view.dispatch({changes:{from:0,to:view.state.doc.length,insert:content}});
  },reordered);
  await page.keyboard.press(`${mod}+s`);
  await page.locator('.save-status.saved').waitFor();
  assert.equal(await readFile(file,'utf8'),reordered);
  await openLatest();
  assert.equal(await cursorLine(),`## ${to}`,'follow the latest date after reordering sections');
  await page.getByRole('button',{name:'읽기 보기',exact:true}).click();
  await page.evaluate(()=>{
   const scroll=Element.prototype.scrollIntoView;
   Element.prototype.scrollIntoView=function(...args){
    if(this.matches('.markdown-preview > h2'))window.captureTestReadHeading=this.textContent;
    return scroll.apply(this,args);
   };
  });
  await openLatest();
  await pane.locator('.document-content.read .markdown-preview').waitFor();
  assert.equal(await page.evaluate(()=>window.captureTestReadHeading),to,'scroll to the latest date in the read view');
 });
 await check('team and stale-vault IPC cannot capture private chats',async()=>{
  const result=await page.evaluate(async team=>{const before=(await window.notes.snapshot()).value;const selected=await window.notes.selectVault({root:team});return [selected,await window.notes.syncCapture({vaultId:before.id,manual:true}),await window.notes.syncCapture({vaultId:selected.value.id,manual:true})];},team);
  assert.equal(result[0].ok,true);assert.equal(result[1].ok,false);assert.equal(result[2].ok,false);assert.match(result[2].error,/개인/);
 });
 await check('renderer has no errors',async()=>assert.deepEqual(errors,[]));
 await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log(JSON.stringify({checks,errors},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'report.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));throw error;}
finally{await app.close();await rm(root,{recursive:true,force:true});}
