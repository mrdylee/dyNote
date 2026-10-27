import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const server=createServer((_request,response)=>{if(_request.url==='/download'){response.setHeader('Content-Type','application/octet-stream');response.setHeader('Content-Disposition','attachment; filename=fixture.bin');response.end('fixture');return;}response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Untrusted title</title><h1>Isolated web fixture</h1><a href="file:///etc/hosts">Blocked file</a><button onclick="window.open(\'/popup\')">Popup</button><a href="/download">Download</a><script>window.probe={notes:typeof window.notes,require:typeof require};navigator.mediaDevices.getUserMedia({audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());window.probe.media="unexpected-grant";}).catch(()=>window.probe.media="denied");</script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
const fixture=await mkdtemp(`${tmpdir()}/dynote-web-`),profile=`${fixture}/profile`;await mkdir(profile);await mkdir('output/playwright',{recursive:true});
const app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();await page.keyboard.press('Meta+p');await page.getByRole('textbox',{name:'명령 검색'}).fill('웹 뷰어 열기');await page.keyboard.press('Enter');
 await page.getByRole('textbox',{name:'웹 뷰어 주소'}).fill(url);const childPromise=app.waitForEvent('window');await page.getByRole('button',{name:'웹 페이지 열기',exact:true}).click();const child=await childPromise;
 await child.getByText('Isolated web fixture',{exact:true}).waitFor();await child.waitForFunction(()=>window.probe?.media);assert.deepEqual(await child.evaluate(()=>window.probe),{notes:'undefined',require:'undefined',media:'denied'});
 const preferences=await app.evaluate(({BrowserWindow,session})=>{const child=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));const p=child.webContents.getLastWebPreferences();return {nodeIntegration:p.nodeIntegration,contextIsolation:p.contextIsolation,sandbox:p.sandbox,isolatedSession:child.webContents.session===session.fromPartition('dynote-web-viewer'),usesDefaultSession:child.webContents.session===session.defaultSession,title:child.getTitle()};});
 assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.sandbox,true);assert.equal(preferences.isolatedSession,true);assert.equal(preferences.usesDefaultSession,false);assert.match(preferences.title,/Dynote 웹/);
 await child.getByRole('link',{name:'Blocked file',exact:true}).click();assert.equal(child.url(),url);
 await child.getByRole('button',{name:'Popup',exact:true}).click();await child.waitForTimeout(100);assert.equal(app.windows().length,2);
 await app.evaluate(({BrowserWindow})=>{globalThis.fixtureDownload=null;const child=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));child.webContents.session.once('will-download',event=>{globalThis.fixtureDownload={prevented:event.defaultPrevented};});});
 await child.getByRole('link',{name:'Download',exact:true}).click();
 for(let i=0;i<30;i++){if(await app.evaluate(()=>globalThis.fixtureDownload))break;await child.waitForTimeout(50);}
 assert.deepEqual(await app.evaluate(()=>globalThis.fixtureDownload),{prevented:true});
 await child.screenshot({path:'output/playwright/native-web-viewer.png'});await child.close();await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();assert.deepEqual(errors,[]);
 const report={checks:['explicit local HTTP fixture loads','no native bridge or require in remote page','remote microphone denied','sandbox and separate session verified','page title cannot impersonate main app','file navigation, popups and downloads blocked','child closes without closing notes'],preferences,errors};await writeFile('output/playwright/native-web-viewer.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});throw e;}finally{await app.close();await new Promise(r=>server.close(r));await rm(fixture,{recursive:true,force:true});}
