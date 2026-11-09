import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {localDate} from '../core/periodic-notes.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await mkdtemp(`${tmpdir()}/dynote-journal-ergonomics-`),profile=`${root}/profile`,vault=`${root}/vault`,outside=`${root}/outside`;
const output=process.env.DYNOTE_UI_OUTPUT||'output/playwright/journal-ergonomics',mod=process.platform==='darwin'?'Meta':'Control',journal=`Journal/${localDate()}.md`;
const original='# General\n\nKeep this document.\n',journalOriginal=`# ${localDate()}\n\n## Project review\n\n- Project planning\n`;
for(const path of [profile,`${vault}/Journal`,`${vault}/Project/Sub`,`${vault}/Keep/Daily`,`${vault}/_attachments`,outside,output])await mkdir(path,{recursive:true});
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault,vaultPurposes:{[vault]:'personal'}}));
await writeFile(`${vault}/General.md`,original);await writeFile(`${vault}/${journal}`,journalOriginal);
await writeFile(`${vault}/Project/A.md`,'# A\n');await writeFile(`${vault}/Project/Sub/B.md`,'# B\n');await writeFile(`${vault}/Project/Sub/unknown.dat`,'preserve every file in system trash');
await writeFile(`${vault}/Keep/Daily/Keep.md`,'# Keep\n');await writeFile(`${vault}/_attachments/Index.md`,'# Attachment index\n');await writeFile(`${outside}/untouched.txt`,'outside');await symlink(outside,`${vault}/Linked`,process.platform==='win32'?'junction':'dir');
const launch=()=>electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE||`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:process.env.DYNOTE_EXECUTABLE?[]:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
let app=await launch(),page;const errors=[],failures=[],checks=[],samples=[];
const check=async(name,fn)=>{console.error('Checking:',name);try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
const setup=async()=>{page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1050));await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const open=async path=>{await page.keyboard.press(`${mod}+k`);await page.getByRole('textbox',{name:'빠른 문서 검색'}).fill(`path:${path}`);await page.locator('.switch-results button').filter({hasText:path}).first().click();await page.getByRole('region',{name:`문서 ${path}`,exact:true}).waitFor();await settle();};
const live=()=>page.getByRole('button',{name:'Live Preview',exact:true}).click();
const editor=()=>page.getByRole('textbox',{name:'Markdown 편집기',exact:true});
const save=async()=>{await page.keyboard.press(`${mod}+s`);await page.getByText('모든 변경사항 저장됨',{exact:true}).waitFor();};
const sample=async()=>samples.push(await page.evaluate(()=>({top:document.querySelector('.document-area').getBoundingClientRect().top,notice:[...document.querySelectorAll('.classification-notice')].some(el=>el.textContent.includes('이 기록을 폴더별로 정리할 수 있습니다.')),status:document.querySelector('.save-status')?.textContent})));
const menu=()=>page.getByRole('menu',{name:'문서·폴더 작업',exact:true});
const trashItem=()=>menu().getByRole('menuitem',{name:'휴지통으로 이동',exact:true});
const context=async locator=>{if(await page.evaluate(()=>typeof window.notes.trashFolder==='function'))await locator.click({button:'right'});else await locator.dispatchEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100});await settle();};
const rightFile=async path=>context(page.locator(`.file-row[title="${path}"]`));
const rightFolder=async name=>context(page.locator('.folder-row').filter({hasText:new RegExp(`^${name}$`)}));
try{
 console.error('Starting native ergonomics scenario');await setup();console.error('Opening ordinary document');await open('General.md');
 await check('ordinary Markdown opens in Live Preview by default',async()=>assert.ok(await page.locator('.document-content.live').count()));
 await page.getByRole('button',{name:'편집 보기',exact:true}).click();await open(journal);await open('General.md');
 await check('an explicit source mode survives switching documents',async()=>assert.equal(await page.locator('.document-content.edit').count(),1));
 await page.getByRole('button',{name:'달력과 일지',exact:true}).click();await settle();
 await check('the journal feed opens the editable Live Preview directly',async()=>assert.equal(await page.locator('.journal-feed .cm-live-preview').count(),1));
 await page.getByRole('region',{name:'달력과 일지',exact:true}).getByTitle(journal,{exact:true}).click();
 await live();await editor().click();await page.keyboard.press(`${mod}+End`);await save();await sample();
 for(let index=0;index<3;index++){
  await page.keyboard.type(` cycle${index}`);await sample();await page.waitForTimeout(250);await sample();await page.waitForTimeout(900);await sample();
 }
 await check('classification controls keep editor geometry stable through three autosaves',async()=>{assert.ok(samples.every(item=>item.notice),JSON.stringify(samples));assert.ok(Math.max(...samples.map(item=>item.top))-Math.min(...samples.map(item=>item.top))<1,JSON.stringify(samples));});
 await save();const before=(await page.locator('.document-area').boundingBox()).y;
 const review=page.getByRole('button',{name:/^분류 제안 검토/});await review.hover();await settle();
 await check('hover explains classification steps without moving the editor',async()=>{const tip=page.getByRole('tooltip');assert.equal(await tip.isVisible(),true);assert.match(await tip.textContent(),/미리보기/);assert.match(await tip.textContent(),/원문/);assert.equal((await page.locator('.document-area').boundingBox()).y,before);});
 await page.mouse.move(10,10);await review.focus();await settle();
 await check('keyboard focus also shows classification help',async()=>assert.equal(await page.getByRole('tooltip').isVisible(),true));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,900));await settle();const narrowBefore=(await page.locator('.document-area').boundingBox()).y;await review.hover();await settle();
 await check('classification help stays inside a narrow window and outside layout flow',async()=>{const box=await page.getByRole('tooltip').boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=760,JSON.stringify(box));assert.equal((await page.locator('.document-area').boundingBox()).y,narrowBefore);});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1050));await settle();
 await page.screenshot({path:`${output}/classification-help.png`});
 await check('tree menu supports Escape and outside-click dismissal',async()=>{
  await rightFile('General.md');assert.equal(await trashItem().count(),1);await page.screenshot({path:`${output}/file-context-menu.png`});await page.keyboard.press('Escape');assert.equal(await menu().count(),0);assert.equal(await page.locator('.file-row[title="General.md"]').evaluate(el=>el===document.activeElement),true);
  await rightFile('General.md');await page.getByRole('button',{name:'Live Preview',exact:true}).click();assert.equal(await menu().count(),0);
 });
 await rightFile('General.md');
 await check('file context menu supports cancel, recoverable trash and one-click undo',async()=>{
  assert.equal(await trashItem().count(),1);await trashItem().click();let dialog=page.getByRole('dialog',{name:'휴지통으로 이동',exact:true});await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(await readFile(`${vault}/General.md`,'utf8'),original);
  await rightFile('General.md');await trashItem().click();dialog=page.getByRole('dialog',{name:'휴지통으로 이동',exact:true});await dialog.getByRole('button',{name:'휴지통으로 이동',exact:true}).click();await page.locator('.file-row[title="General.md"]').waitFor({state:'detached'});await assert.rejects(readFile(`${vault}/General.md`),{code:'ENOENT'});
  await page.getByRole('button',{name:'되돌리기',exact:true}).click();await page.locator('.file-row[title="General.md"]').waitFor();assert.equal(await readFile(`${vault}/General.md`,'utf8'),original);
 });
 await page.keyboard.press('Escape');
 await check('built-in Journal and attachment folders have no trash menu item',async()=>{for(const folder of ['Journal','_attachments']){await rightFolder(folder);assert.equal(await trashItem().count(),0);}});await page.keyboard.press('Escape');
 await rightFolder('Project');
 await check('ordinary folder context trash requires confirmation and keeps unrelated documents',async()=>{
  assert.equal(await trashItem().count(),1);await trashItem().click();let dialog=page.getByRole('dialog',{name:'휴지통으로 이동',exact:true});assert.match(await dialog.textContent(),/시스템 휴지통/);await page.screenshot({path:`${output}/folder-trash-confirmation.png`});await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(await readFile(`${vault}/Project/Sub/unknown.dat`,'utf8'),'preserve every file in system trash');
  await rightFolder('Project');await trashItem().click();dialog=page.getByRole('dialog',{name:'휴지통으로 이동',exact:true});await dialog.getByRole('button',{name:'휴지통으로 이동',exact:true}).click();await page.locator('.folder-row').filter({hasText:/^Project$/}).waitFor({state:'detached'});await assert.rejects(readFile(`${vault}/Project/Sub/B.md`),{code:'ENOENT'});assert.equal(await readFile(`${vault}/General.md`,'utf8'),original);assert.match(await readFile(`${vault}/${journal}`,'utf8'),/Project planning/);assert.equal(await page.getByRole('button',{name:'되돌리기',exact:true}).count(),0);
 });
 await page.keyboard.press('Escape');
 await check('folder IPC rejects protected, containing, outside, symlink and stale-vault targets',async()=>{
  const replies=await page.evaluate(async()=>{const snapshot=await window.notes.snapshot();const id=snapshot.value.id;if(!window.notes.trashFolder)return null;const results=[];for(const args of [{path:'Journal'},{path:'_attachments'},{path:'Keep',protectedFolders:['Keep/Daily']},{path:'../outside'},{path:'Linked'},{path:'General.md'},{path:'Journal',vaultId:'stale'}])results.push(await window.notes.trashFolder({vaultId:id,...args}));return results;});
  assert.ok(replies);assert.ok(replies.every(reply=>reply.ok===false),JSON.stringify(replies));assert.equal(await readFile(`${vault}/Keep/Daily/Keep.md`,'utf8'),'# Keep\n');assert.equal(await readFile(`${outside}/untouched.txt`,'utf8'),'outside');assert.match(await readFile(`${vault}/${journal}`,'utf8'),/Project planning/);
 });
 await check('a configured journal folder and its parent also hide the trash action',async()=>{
  await page.evaluate(async()=>{const {value}=await window.notes.snapshot();localStorage.setItem(`dynote.journal.${value.id}`,JSON.stringify({daily:{folder:'Keep/Daily'}}));});await page.reload();await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();await open('General.md');await rightFolder('Keep');assert.equal(await trashItem().count(),0);await page.keyboard.press('Escape');
 });
 await open(journal);await live();await save();const saved=await readFile(`${vault}/${journal}`,'utf8');await app.close();app=await launch();console.error('Starting native ergonomics scenario');await setup();console.error('Opening ordinary document');await open('General.md');
 await check('restart keeps exact note bytes and restores the Live Preview default',async()=>{assert.equal(await page.locator('.document-content.live').count(),1);assert.equal(await readFile(`${vault}/General.md`,'utf8'),original);assert.equal(await readFile(`${vault}/${journal}`,'utf8'),saved);});
 await check('renderer has no errors',async()=>assert.deepEqual(errors,[]));
 const report={checks,failures,errors,samples};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.deepEqual(failures,[]);
}finally{await app.close();await rm(root,{recursive:true,force:true});}
