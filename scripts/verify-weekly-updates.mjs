import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await mkdtemp(`${tmpdir()}/dynote-weekly-update-`),profile=`${root}/profile`,vault=`${root}/vault`;
await mkdir(`${profile}/updates`,{recursive:true});await mkdir(vault);await writeFile(`${vault}/Keep.md`,'original\n');
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault}));
await writeFile(`${profile}/updates/settings.json`,JSON.stringify({preferences:{enabled:false}}));
const bytes='controlled archive for integrity test',digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const name=`Dynote-99.0.0-${process.platform==='darwin'?'mac':process.platform}-${process.arch}.zip`;
const app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('region',{name:'저널 피드'}).waitFor();
 await app.evaluate((_electron,{bytes,digest,name})=>{
   globalThis.fetch=async url=>String(url).includes('api.github.com')?new Response(JSON.stringify([{tag_name:'v99.0.0',name:'Controlled update',body:'<img src=x onerror=alert(1)>',assets:[{name,size:bytes.length,digest,browser_download_url:`https://github.com/mrdylee/dyNote/releases/download/v99.0.0/${name}`}]}]),{headers:{'content-type':'application/json'}}):new Response(bytes);
 },{bytes,digest,name});
 const settings=async()=>{await page.keyboard.press('Meta+p');await page.getByRole('textbox',{name:'명령 검색'}).fill('Dynote 업데이트 확인');await page.keyboard.press('Enter');};
 await settings();await page.getByRole('button',{name:'지금 업데이트 확인',exact:true}).click();
 await page.locator('.update-settings').getByRole('button',{name:'설치 파일 위치 열기',exact:true}).waitFor();
 assert.equal(await page.locator('.release-notes').textContent(),'<img src=x onerror=alert(1)>');assert.equal(await page.locator('.release-notes img').count(),0);
 const downloaded=(await readdir(`${profile}/updates`)).find(n=>n.endsWith('.zip'));assert.equal(await readFile(`${profile}/updates/${downloaded}`,'utf8'),bytes);
 assert.equal(await readFile(`${vault}/Keep.md`,'utf8'),'original\n');
 await app.evaluate(()=>{globalThis.fetch=async()=>{throw new Error('Controlled offline');};});
 await page.getByRole('button',{name:'지금 업데이트 확인',exact:true}).click();await page.getByRole('alert').filter({hasText:'Controlled offline'}).waitFor();
 assert.equal(await page.getByRole('status',{name:'업데이트 확인 결과'}).count(),0);
 await page.evaluate(()=>{localStorage.setItem('dynote.updates.beta','true');localStorage.setItem('dynote.updates.ignored','["v88.0.0"]');});
 await page.reload();await page.getByRole('region',{name:'저널 피드'}).waitFor();await settings();
 await page.waitForFunction(()=>document.querySelector('[aria-label="시험 버전 포함"]')?.checked===true);
 const migrated=await page.evaluate(()=>window.notes.updateState());assert.deepEqual(migrated.value.preferences.ignored,['v88.0.0']);
 assert.deepEqual(errors,[]);console.log('PASS controlled manual check, verified background download, inert notes, failure feedback, legacy preferences; no real release downloaded or installed');
}finally{await app.close();await rm(root,{recursive:true,force:true});}
