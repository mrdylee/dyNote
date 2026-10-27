import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const fixture=await mkdtemp(`${tmpdir()}/dynote-updates-`),profile=`${fixture}/profile`;
await mkdir(profile);await mkdir('output/playwright',{recursive:true});
let app,page;const errors=[];
const start=async()=>{app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();await page.keyboard.press('Meta+p');await page.getByRole('textbox',{name:'명령 검색'}).fill('Dynote 업데이트 확인');await page.keyboard.press('Enter');};
try {
 await start();await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="업데이트 확인 결과"]') || document.querySelector('.update-settings [role="alert"]'));
 const liveRequest=await page.locator('.update-settings [role="alert"]').count()?'network-failure':'success';
 const liveResult=await page.locator('.update-settings').innerText();
 assert.match(liveResult,/현재 버전 0\.6\.3/);
 await page.getByRole('checkbox',{name:'시험 버전 포함'}).check();
 // Controlled feed follows the one real public request; it is not live release evidence.
 await app.evaluate(()=>{globalThis.fetch=async()=>({ok:true,json:async()=>[{tag_name:'v9.0.0',name:'Fixture release',body:'<img src=x onerror=window.releaseInjection=true>',draft:false,prerelease:false,assets:[]}]});});
 await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();await page.getByRole('button',{name:'이 버전 무시',exact:true}).waitFor();
 assert.equal(await page.locator('.release-notes').textContent(),'<img src=x onerror=window.releaseInjection=true>');assert.equal(await page.locator('.release-notes img').count(),0);
 await page.getByRole('button',{name:'이 버전 무시',exact:true}).click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dynote.updates.ignored'))),['v9.0.0']);
 await app.evaluate(()=>{globalThis.fetch=async()=>{throw new Error('Fixture network unavailable');};});
 await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();await page.getByRole('alert').filter({hasText:'Fixture network unavailable'}).waitFor();
 assert.equal(await page.getByRole('status',{name:'업데이트 확인 결과'}).count(),0);
 await page.screenshot({path:'output/playwright/native-updates.png'});
 await app.close();app=null;await start();assert.equal(await page.getByRole('checkbox',{name:'시험 버전 포함'}).isChecked(),true);
 await page.getByRole('button',{name:'무시한 버전 다시 표시',exact:true}).click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('dynote.updates.ignored'))),[]);
 assert.deepEqual(errors,[]);
 const report={liveRequest,liveResult,controlledChecks:['feed text remains inert','ignore/restore version','channel persistence','request failure never claims up-to-date'],errors};
 await writeFile('output/playwright/native-updates.json',JSON.stringify(report,null,2));console.log({liveRequest,controlledChecks:report.controlledChecks,errors});
}finally{if(app)await app.close();await rm(fixture,{recursive:true,force:true});}
