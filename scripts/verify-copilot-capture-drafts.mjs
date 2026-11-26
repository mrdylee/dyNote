import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runGit} from '../core/git-backup.mjs';
import {Vault} from '../core/vault.mjs';
import {CopilotJournal} from '../electron/copilot-journal.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await realpath(await mkdtemp(path.join(tmpdir(),'dynote-capture-drafts-')));
const profile=path.join(root,'profile'),personal=path.join(root,'personal'),team=path.join(root,'team'),source=path.join(root,'workspaceStorage');
let app;
try{
 for(const directory of [profile,personal,team,path.join(source,'project/chatSessions')])await mkdir(directory,{recursive:true});
 for(const directory of [personal,team])await writeFile(path.join(directory,'Home.md'),'# Original\n');
 await writeFile(path.join(source,'project/workspace.json'),JSON.stringify({folder:pathToFileURL(path.join(root,'Work')).href}));
 await writeFile(path.join(source,'project/chatSessions/session.json'),JSON.stringify({version:3,sessionId:'session',customTitle:'검증 대화',requests:[{requestId:'q',timestamp:Date.now(),message:{text:'질문'},modelState:{value:1},response:[{value:'답변'}]}]}));
 await writeFile(path.join(profile,'settings.json'),JSON.stringify({vaultRoot:personal,vaults:[personal,team],vaultPurposes:{[personal]:'personal',[team]:'team'}}));
 const personalVault=await Vault.open(personal,profile),teamVault=await Vault.open(team,profile);
 const controller=new CopilotJournal({file:path.join(profile,'copilot-journal.json'),sourceRoot:source,sessionRoot:path.join(root,'.copilot/session-state')});
 await controller.load();await controller.configure(personalVault,{enabled:false,projects:['project']},true);
 const drafts={};
 for(const vault of [personalVault,teamVault]){
  const note=(await vault.documentSnapshot()).notes.find(note=>note.path==='Home.md');
  drafts[vault.id]=[{path:'Home.md',kind:'edit',original:note.content,content:note.content+'AI draft\n',aiContent:note.content+'AI draft\n',revision:note.revision,userEdited:false}];
 }
 const executablePath=process.env.DYNOTE_EXECUTABLE;
 app=await electron.launch({executablePath:executablePath||path.resolve('node_modules/electron/dist',process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron'),args:executablePath?[]:['.'],env:{...process.env,OPEN_NOTES_DATA:profile,COPILOT_HOME:path.join(root,'.copilot')}});
 const page=await app.firstWindow();page.setDefaultTimeout(12000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();
 const setDraft=async id=>{
  await page.evaluate(({id,draft})=>localStorage.setItem(`dynote.copilot.drafts.${id}`,JSON.stringify(draft)),{id,draft:drafts[id]});
  await page.reload();await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();
 };
 const settings=()=>page.getByRole('dialog',{name:'설정',exact:true});
 const openSettings=async()=>{
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await settings().getByRole('button',{name:'Copilot 대화 자동 저장',exact:true}).click();
  assert.equal(await settings().getByRole('button',{name:'세션 불러오기',exact:true}).count(),0);
  await settings().getByRole('group',{name:'가져올 프로젝트',exact:true}).waitFor();
  await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true}).waitFor();
 };
 await setDraft(teamVault.id);await openSettings();
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
 await settings().getByRole('button',{name:'기록 폴더 선택',exact:true}).click();
 await settings().getByRole('button',{name:'전체 선택',exact:true}).click();
 await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true}).click();
 await settings().getByText('대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
 assert.equal(await settings().getByRole('alert').count(),0,'unrelated team drafts must not block personal imports');
 const status=await page.evaluate(async id=>(await window.notes.captureStatus({vaultId:id})).value,personalVault.id);
 assert.equal(status.records.length,1);
 assert.match(await readFile(path.join(personal,status.records[0].sessions[0].path),'utf8'),/질문/);
 const importedPath=path.join(personal,status.records[0].sessions[0].path),before=await readFile(importedPath);
 const bare=path.join(root,'remote.git'),remote='https://example.invalid/personal.git';
 await runGit(personal,['init','--bare','--initial-branch=main',bare]);
 await runGit(personal,['init','--initial-branch=main']);
 await runGit(personal,['config','url.'+bare.replaceAll('\\','/')+'.insteadOf',remote]);
 const invoke=(method,args={})=>page.evaluate(async({method,args})=>{
  const result=await window.notes[method](args);
  if(!result.ok)throw new Error(result.error);
  return result.value;
 },{method,args:{vaultId:personalVault.id,...args}});
 await invoke('connectGit',{config:{mode:'personal-sync',zipPaths:[],remote,branch:'main',deviceName:'Test PC',authorName:'Writer',authorEmail:'test@example.invalid'}});
 const name=status.records[0].sessions[0].path;
 await invoke('syncGit');
 assert.match((await runGit(bare,['show','main:'+name])).stdout,/질문/);
 // Keep this test's disposable trash outside the user's system Trash.
 await app.evaluate(({shell},trash)=>{shell.trashItem=file=>process.getBuiltinModule('fs').promises.rename(file,trash);},path.join(root,'trashed'));
 await invoke('trashFolder',{path:'Copilot Note'});
 await invoke('syncGit');
 assert.equal((await runGit(bare,['ls-tree','--name-only','main','--',name])).stdout.trim(),'');
 await rm(path.join(source,'project/chatSessions/session.json'));
 await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true}).click();
 await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true,disabled:false}).waitFor();
 await settings().getByText('대화를 개인 노트에 가져왔습니다.',{exact:true}).waitFor();
 assert.deepEqual(await readFile(importedPath),before);
 await invoke('disconnectGit');
 assert.equal(await readFile(path.join(team,'Home.md'),'utf8'),'# Original\n');
 assert.deepEqual(await page.evaluate(id=>JSON.parse(localStorage.getItem(`dynote.copilot.drafts.${id}`)),teamVault.id),drafts[teamVault.id]);
 await settings().getByRole('button',{name:'닫기',exact:true}).click();
 await setDraft(personalVault.id);await openSettings();
 assert.equal(await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true}).isDisabled(),true);
 await settings().getByRole('button',{name:'미확정 변경 검토: Home.md',exact:true}).click();
 await settings().waitFor({state:'hidden'});
 await page.getByRole('button',{name:'변경 되돌리기',exact:true}).click();
 await page.getByLabel('AI 실시간 변경',{exact:true}).waitFor({state:'hidden'});
 assert.equal(await readFile(path.join(personal,'Home.md'),'utf8'),'# Original\n');
 await openSettings();
 assert.equal(await settings().getByRole('button',{name:'선택한 프로젝트 가져오기',exact:true}).isDisabled(),false);
 assert.deepEqual(errors,[]);
 console.log('Copilot capture: selecting projects imports their chats without session selection; team drafts preserved; own drafts block writes and can be reviewed without losing content.');
}catch(error){app?.process().kill();throw error;}
finally{if(app&&!app.process().killed)await app.close();await rm(root,{recursive:true,force:true});}
