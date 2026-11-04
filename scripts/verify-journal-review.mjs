import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,unlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {localDate} from '../core/periodic-notes.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await mkdtemp(`${tmpdir()}/dynote-journal-review-`),profile=`${root}/profile`,vault=`${root}/vault`,outside=`${root}/outside`,output=process.env.DYNOTE_UI_OUTPUT||'output/playwright/journal-review';
const mod=process.platform==='darwin'?'Meta':'Control',journal=`Journal/${localDate()}.md`;
for(const directory of [profile,`${vault}/Journal`,`${vault}/Projects`,`${outside}/Projects`,output])await mkdir(directory,{recursive:true});
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault}));await writeFile(`${vault}/Image.png`,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLQ0AAAAASUVORK5CYII=','base64'));
await writeFile(`${vault}/${journal}`,`# ${localDate()}\n\n## Projects\n- Review this project\n`);await writeFile(`${vault}/Projects/Plan.md`,'# Project\n');await writeFile(`${outside}/Projects/Outside.md`,'OUTSIDE MUST REMAIN');
const app=await electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE||`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:process.env.DYNOTE_EXECUTABLE?[]:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
const checks=[],failures=[],errors=[];
const check=async(name,fn)=>{console.error('Checking:',name);try{await fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
try{
 const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1050));await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();
 const openJournal=async()=>{await page.keyboard.press(`${mod}+k`);await page.getByRole('textbox',{name:'빠른 문서 검색'}).fill(`path:${journal}`);await page.locator('.switch-results button').filter({hasText:journal}).first().click();await page.getByRole('button',{name:/^분류 제안 검토/}).waitFor();};
 const review=()=>page.getByRole('button',{name:/^분류 제안 검토/});const tooltip=()=>page.getByRole('tooltip');
 await openJournal();await review().hover();
 await check('help describes the actual copy-and-preview workflow without a nonexistent original-handling choice',async()=>{const text=await tooltip().textContent();assert.doesNotMatch(text,/원문 처리 방법/);assert.match(text,/원본 저널은 그대로/);});
 await check('the explanation remains readable while the pointer moves into it',async()=>{await review().hover();const box=await tooltip().boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});assert.equal(await tooltip().isVisible(),true);});
 await check('Escape dismisses mouse-hover help without moving focus into the button',async()=>{await page.mouse.move(20,20);await page.getByRole('textbox',{name:'Markdown 편집기',exact:true}).click();await review().hover();assert.equal(await tooltip().isVisible(),true);await page.keyboard.press('Escape');assert.equal(await tooltip().isVisible(),false);});
 await check('Escape dismisses keyboard help and a later focus shows it again',async()=>{await page.mouse.move(20,20);await review().focus();assert.equal(await tooltip().isVisible(),true);await page.keyboard.press('Escape');assert.equal(await tooltip().isVisible(),false);await review().blur();await review().focus();assert.equal(await tooltip().isVisible(),true);});
 await check('after help is dismissed, the next Escape follows normal window handling',async()=>{await review().blur();await review().focus();await page.keyboard.press('Escape');await tooltip().waitFor({state:'hidden'});await page.evaluate(()=>{window.__reviewEscapeCount=0;window.addEventListener('keydown',event=>{if(event.key==='Escape')window.__reviewEscapeCount++;},{once:true});});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__reviewEscapeCount),1);await review().blur();await review().focus();});
 await page.screenshot({path:`${output}/review-help.png`});
 await check('a hidden journal does not leave classification controls over Planner',async()=>{await page.getByRole('button',{name:'개발 플래너',exact:true}).click();assert.equal(await review().count(),0);});
 await check('a hidden journal does not leave classification controls over Graph',async()=>{await page.getByRole('button',{name:'그래프 보기',exact:true}).click();assert.equal(await review().count(),0);});
 await openJournal();
 await check('an attachment hides classification controls for the background journal',async()=>{await page.getByRole('button',{name:'Image.png',exact:true}).click();await page.locator('.attachment-view').waitFor();assert.equal(await review().count(),0);});
 await openJournal();const reply=await page.evaluate(()=>window.notes.snapshot());const id=reply.value.id;
 await check('replacing the vault root with a link cannot trash a directory outside the selected vault',async()=>{
  await rename(vault,`${vault}-original`);await symlink(outside,vault,process.platform==='win32'?'junction':'dir');
  try{const result=await page.evaluate(args=>window.notes.trashFolder(args),{vaultId:id,path:'Projects'});assert.equal(result.ok,false,JSON.stringify(result));assert.equal(await readFile(`${outside}/Projects/Outside.md`,'utf8'),'OUTSIDE MUST REMAIN');}
  finally{await unlink(vault);await rename(`${vault}-original`,vault);}
 });
 await check('a rejected path change releases the mutation lock for a valid folder operation',async()=>{const result=await page.evaluate(args=>window.notes.trashFolder(args),{vaultId:id,path:'Projects'});assert.equal(result.ok,true,JSON.stringify(result));await assert.rejects(readFile(`${vault}/Projects/Plan.md`),{code:'ENOENT'});});
 await check('renderer has no errors',async()=>assert.deepEqual(errors,[]));
 const report={checks,failures,errors};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.deepEqual(failures,[]);
}finally{await app.close();await rm(root,{recursive:true,force:true});}
