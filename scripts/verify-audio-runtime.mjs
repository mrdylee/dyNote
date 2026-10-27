import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const fixture=await mkdtemp(`${tmpdir()}/dynote-audio-`),profile=`${fixture}/profile`,vault=`${fixture}/vault`;
await mkdir(profile);await mkdir(vault);await mkdir('output/playwright',{recursive:true});await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault}));await writeFile(`${vault}/A.md`,'# Recording fixture\n');
// These flags provide synthetic input; no physical microphone is requested.
const app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],env:{...process.env,OPEN_NOTES_DATA:profile}});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.keyboard.press('Meta+p');await page.getByRole('textbox',{name:'명령 검색'}).fill('음성 녹음');await page.keyboard.press('Enter');await page.getByRole('button',{name:'녹음 시작',exact:true}).click();await page.getByRole('button',{name:'녹음 중단하고 저장',exact:true}).waitFor();};
 await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();await open();await page.waitForTimeout(300);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'음성 녹음',exact:true}).getByRole('alert').filter({hasText:'저장하거나 취소'}).waitFor();
 await page.getByRole('button',{name:'녹음 취소',exact:true}).click();assert.equal((await readdir(vault)).includes('_attachments'),false);
 await open();await page.waitForTimeout(1300);await page.getByRole('button',{name:'녹음 중단하고 저장',exact:true}).click();
 const audio=page.getByLabel('오디오 재생',{exact:true});await audio.waitFor();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);
 const files=await readdir(`${vault}/_attachments`);assert.equal(files.length,1);assert.match(files[0],/\.webm$/);
 const bytes=await readFile(`${vault}/_attachments/${files[0]}`);assert.equal(bytes.subarray(0,4).toString('hex'),'1a45dfa3');assert.ok(bytes.length>100);assert.match(await readFile(`${vault}/A.md`,'utf8'),/!\[\[_attachments\/.+\.webm\]\]/);
 assert.equal(await audio.getAttribute('autoplay'),null);assert.deepEqual(errors,[]);await page.screenshot({path:'output/playwright/native-audio.png'});
 const report={input:'Chromium synthetic audio device, not physical microphone',checks:['explicit start','active close guard','cancel saves no file','stop/save produces one valid WebM header','note embed saved','audio playback metadata loads without autoplay'],bytes:bytes.length,errors};await writeFile('output/playwright/native-audio.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){const p=app.windows()[0];if(p){console.error((await p.locator('body').innerText()).slice(-1800));await p.screenshot({path:'output/playwright/native-audio-failure.png'});}await app.evaluate(({app})=>app.exit(0)).catch(()=>{});throw e;}finally{await app.close();await rm(fixture,{recursive:true,force:true});}
