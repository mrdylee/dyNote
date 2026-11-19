import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const fixture=await mkdtemp(`${tmpdir()}/dynote-toc-`),profile=`${fixture}/profile`,vaultRoot=`${fixture}/vault`;
await mkdir(profile);await mkdir(vaultRoot);await mkdir('output/playwright',{recursive:true});
const filler=Array.from({length:18},(_,i)=>`본문 ${i+1}: 목차에서 제목을 선택해 문서를 탐색합니다.\n`).join('\n');
const content=`---\ntags: [outline]\n---\n# 목차 디자인\n\n${filler}\n## **시작하기**\n\n${filler}\n### 같은 제목\n\n${filler}\n### 같은 제목\n\n${filler}\n## 긴 제목도 잘리지 않고 여러 줄로 표시되어 문서 구조를 쉽게 파악할 수 있습니다\n\n${filler}\n###### 깊은 제목\n\n${filler}\n\`\`\`md\n# 코드 안 제목\n\`\`\`\n`;
await writeFile(`${vaultRoot}/Outline.md`,content);await writeFile(`${vaultRoot}/Empty.md`,'제목 없는 문서');
const longOutline=Array.from({length:50},(_,index)=>`${'#'.repeat(1+index%6)} 제목 ${index+1}`).join('\n');
await writeFile(`${vaultRoot}/Long.md`,`${longOutline}\n###### ${'LongUnbrokenHeading'.repeat(8)}\n`);
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot}));
const report={checks:[],errors:[]};
const executablePath=process.env.DYNOTE_EXECUTABLE;
const app=await electron.launch({
 executablePath:executablePath||`${process.cwd()}/node_modules/electron/dist/${process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':process.platform==='win32'?'electron.exe':'electron'}`,
 args:executablePath?[]:['.'],
 env:{...process.env,OPEN_NOTES_DATA:profile},
});
try{
 report.runtime=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,executable:process.execPath}));
 if(executablePath)assert.equal(report.runtime.packaged,true);
 const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,900));
 const toc=page.getByRole('region',{name:'문서 목차'}),rows=toc.getByRole('button');
 const file=name=>page.locator(`.file-row[title="${name}"]`).click();
 const mode=name=>page.locator('.view-segments').getByRole('button',{name,exact:true}).click();
 await page.getByRole('tab',{name:'목차',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'목차',exact:true}).getAttribute('aria-selected'),'true');
 await file('Outline.md');await rows.nth(5).waitFor();assert.equal(await rows.count(),6);
 assert.equal(await rows.nth(1).innerText(),'시작하기');
 report.checks.push('Outline is the default; formatting is stripped and fenced code is excluded');
 for(const label of ['Live Preview','편집 보기','분할 보기']){
  await mode(label);await rows.nth(3).click();
  const selected=await page.locator('.document-pane.focused .cm-content').evaluate(el=>{const v=el.cmTile.root.view;return {line:v.state.doc.lineAt(v.state.selection.main.head).number,text:v.state.doc.lineAt(v.state.selection.main.head).text};});
  const expected=content.split('\n').map((line,i)=>({line,i})).filter(x=>x.line==='### 같은 제목')[1].i+1;
  assert.equal(selected.line,expected);assert.equal(selected.text,'### 같은 제목');
  assert.match(await page.locator('.view-segments').getByRole('button',{name:label,exact:true}).getAttribute('class'),/active/);
  await page.waitForFunction(()=>document.querySelectorAll('.toc-list button')[3]?.getAttribute('aria-current')==='location');
  report.checks.push(`${label}: duplicate heading navigates to the correct source line without switching mode`);
 }
 await mode('읽기 보기');
 for(const index of [1,2,3,5]){
  await rows.nth(index).click();
  await page.waitForFunction(i=>{const pane=document.querySelector('.document-pane.focused');const hs=[...pane.querySelectorAll('.markdown-preview h1,.markdown-preview h2,.markdown-preview h3,.markdown-preview h6')];const y=hs[i].getBoundingClientRect().top-pane.getBoundingClientRect().top;return y>=30&&y<100;},index);
  await page.waitForFunction(i=>document.querySelectorAll('.toc-list button')[i]?.getAttribute('aria-current')==='location',index);
 }
 report.checks.push('Read view: formatted, repeated and level-six headings scroll to the correct section');
 await page.locator('.document-pane.focused').evaluate(pane=>{const h=pane.querySelectorAll('.markdown-preview h3')[0];pane.scrollTop+=h.getBoundingClientRect().top-pane.getBoundingClientRect().top-40;});
 await page.waitForFunction(()=>document.querySelector('.toc-list button[aria-current]')?.textContent==='같은 제목');
 assert.equal(await rows.nth(2).getAttribute('aria-current'),'location');
 report.checks.push('Manual scrolling updates the active heading and its rail');
 await page.getByRole('tab',{name:'Copilot',exact:true}).click();
 const input=page.locator('.copilot-panel:not([hidden]) textarea');await input.fill('패널을 바꿔도 남아 있는 초안');
 await page.getByRole('tab',{name:'목차',exact:true}).click();await rows.nth(1).waitFor();
 await page.getByRole('tab',{name:'Copilot',exact:true}).click();assert.equal(await input.inputValue(),'패널을 바꿔도 남아 있는 초안');
 report.checks.push('Copilot composer draft survives outline/Copilot switching');
 await page.getByRole('tab',{name:'문서 정보',exact:true}).click();assert.equal(await page.locator('.document-info').isVisible(),true);
 await page.getByRole('button',{name:'목차 열기',exact:true}).click();
 await page.reload();await page.getByRole('tab',{name:'목차',exact:true}).waitFor();
 assert.equal(await page.getByRole('tab',{name:'목차',exact:true}).getAttribute('aria-selected'),'true');
 report.checks.push('Document info remains available; selected panel persists across reload');
 await file('Empty.md');assert.equal(await toc.innerText().then(x=>x.includes('아직 제목이 없습니다.')),true);
 await file('Outline.md');await mode('읽기 보기');await rows.nth(1).click();
 await page.getByRole('button',{name:'오른쪽 패널 표시/숨기기',exact:true}).click();assert.equal(await toc.count(),0);
 await page.getByRole('button',{name:'목차 열기',exact:true}).click();await rows.nth(5).waitFor();
 report.checks.push('Empty document hint and one-click reopening work');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,760));
 const layout=await page.locator('.context-panel').evaluate(panel=>({width:panel.clientWidth,scroll:panel.scrollWidth,tabs:[...panel.querySelectorAll('[role=tab]')].map(el=>({width:el.clientWidth,scroll:el.scrollWidth}))}));
 assert.ok(layout.scroll<=layout.width);assert.ok(layout.tabs.every(tab=>tab.scroll<=tab.width));
 report.checks.push('All three panel choices fit at the minimum window width');
 const leftResize=page.getByRole('separator',{name:'왼쪽 패널 너비'});
 const rightResize=page.getByRole('separator',{name:'오른쪽 패널 너비'});
 const width=async handle=>Number(await handle.getAttribute('aria-valuenow'));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1320,900));
 await page.waitForFunction(()=>innerWidth===1320 && Number(document.querySelector('[aria-label="왼쪽 패널 너비"]').getAttribute('aria-valuemax'))>600);
 await leftResize.press('End');
 assert.ok(await width(leftResize)>480);
 assert.equal(await width(leftResize),Number(await leftResize.getAttribute('aria-valuemax')));
 assert.ok((await page.locator('.workspace').boundingBox()).width>=280);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1050,760));
 await page.waitForFunction(()=>innerWidth===1050 && Number(document.querySelector('[aria-label="왼쪽 패널 너비"]').getAttribute('aria-valuenow'))<480);
 const constrainedLeft=await width(leftResize);
 const leftHandle=await leftResize.boundingBox();
 const leftX=leftHandle.x+leftHandle.width/2,leftY=leftHandle.y+leftHandle.height/2;
 await page.mouse.move(leftX,leftY);
 await page.mouse.down();
 await page.mouse.move(leftX-80,leftY,{steps:8});
 assert.ok(await width(leftResize)<constrainedLeft);
 await page.mouse.move(leftX,leftY,{steps:8});
 await page.mouse.up();
 assert.equal(await width(leftResize),constrainedLeft,'the divider can return to its starting width within one drag');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1320,900));
 await page.waitForFunction(()=>innerWidth===1320);
 await leftResize.dblclick();
 assert.equal(await width(leftResize),244);
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="오른쪽 패널 너비"]').getAttribute('aria-valuemax'))>700);
 const handle=await rightResize.boundingBox();
 const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x-330,y,{steps:8});
 await page.mouse.up();
 const expanded=await width(rightResize);
 assert.ok(expanded>600);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1050,760));
 await page.waitForFunction(width=>innerWidth===1050 && Number(document.querySelector('[aria-label="오른쪽 패널 너비"]').getAttribute('aria-valuenow'))<width,expanded);
 assert.ok(await width(rightResize)<expanded);
 assert.ok((await page.locator('.workspace').boundingBox()).width>=280);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1320,900));
 await rightResize.and(page.locator(`[aria-valuenow="${expanded}"]`)).waitFor();
 assert.equal(await width(rightResize),expanded);
 report.checks.push('Both panels resize past the old caps, drag can reverse in a narrow window, and the right panel restores its saved width');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1050,760));
 await page.evaluate(()=>localStorage.setItem('dynote.panelWidths',JSON.stringify({left:244,right:240})));
 await page.reload();
 await file('Long.md');
 await rows.last().waitFor();
 const scrollLayout=await toc.evaluate(panel=>{
  const list=panel.querySelector('.toc-scroll'), title=panel.querySelector('h3');
  const tabs=panel.closest('.context-panel').querySelector('.context-tabs');
  const titleTop=title.getBoundingClientRect().top, tabsTop=tabs.getBoundingClientRect().top;
  list.scrollTop=list.scrollHeight;
  return {
   panelWidth:panel.closest('.context-panel').getBoundingClientRect().width,
   scrollTop:list.scrollTop,
   hasOverflow:list.scrollWidth>list.clientWidth,
   headingWraps:list.querySelector('li:last-child button').offsetHeight>list.querySelector('button').offsetHeight,
   headerFixed:title.getBoundingClientRect().top===titleTop && tabs.getBoundingClientRect().top===tabsTop,
  };
 });
 assert.ok(Math.abs(scrollLayout.panelWidth-240)<1, `outline panel width: ${scrollLayout.panelWidth}`);
 assert.ok(scrollLayout.scrollTop>0);
 assert.equal(scrollLayout.hasOverflow,false);
 assert.equal(scrollLayout.headingWraps,true);
 assert.equal(scrollLayout.headerFixed,true);
 report.checks.push('At 240 px, the outline scrolls independently and long headings wrap without horizontal overflow');
 await page.evaluate(()=>localStorage.removeItem('dynote.panelWidths'));
 await page.reload();
 await file('Outline.md');await mode('읽기 보기');await rows.nth(1).click();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,900));
 await page.mouse.move(660,210);
 await page.screenshot({path:'output/playwright/table-of-contents.png',animations:'disabled'});
 assert.deepEqual(report.errors,[]);assert.equal(await readFile(`${vaultRoot}/Outline.md`,'utf8'),content);
 report.checks.push('Navigation leaves the Markdown file unchanged; no renderer errors');
 await writeFile('output/playwright/table-of-contents.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){const page=app.windows()[0];if(page)await page.screenshot({path:'output/playwright/table-of-contents-failure.png'});throw error;}
finally{await app.close();await rm(fixture,{recursive:true,force:true});}
