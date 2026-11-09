import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await mkdtemp(`${tmpdir()}/dynote-journal-threading-`),profile=`${root}/profile`,vault=`${root}/vault`;
const output=process.env.DYNOTE_UI_OUTPUT||'output/playwright/journal-threading',mod=process.platform==='darwin'?'Meta':'Control';
const path='Journal/2026-11-04.md';
const original='# 2026-11-04\n\n- # Heading one\n  - ## Heading two\n    - Earlier leaf\n    - Active leaf 한글\n      Continuation text\n  - Peer branch\n    - Peer leaf\n- Other root\n- [ ] Task parent\n  - [ ] Task leaf\n\nTail prose\n';
await mkdir(profile);await mkdir(`${vault}/Journal`,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault,vaultPurposes:{[vault]:'personal'}}));
await writeFile(`${vault}/${path}`,original);await writeFile(`${vault}/Normal.md`,original);
const longPath='Journal/2026-11-03.md',longContent='- # Scroll root\n  - ## Scroll parent\n    - Wrapped sibling '+('긴 문장을 여러 줄로 표시합니다. '.repeat(180))+'\n    - Scrolled leaf\n';
await writeFile(`${vault}/${longPath}`,longContent);
const importedPath='Journal/2026-11-02.md',importedContent='- Imported parent\n    - Imported child\n\t\t- Imported leaf\n';
await writeFile(`${vault}/${importedPath}`,importedContent);
const launch=()=>electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE||`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:process.env.DYNOTE_EXECUTABLE?[]:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
let app=await launch(),page;const errors=[],failures=[],checks=[];
const check=(name,fn)=>{try{fn();checks.push(name);}catch(error){failures.push({name,message:error.message});}};
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const setup=async()=>{page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();};
const open=async name=>{await page.keyboard.press(`${mod}+k`);await page.getByRole('textbox',{name:'빠른 문서 검색'}).fill(`path:${name}`);await page.locator('.switch-results button').filter({hasText:name}).first().click();await page.getByRole('button',{name:'Live Preview',exact:true}).click();await page.getByRole('textbox',{name:'Markdown 편집기',exact:true}).waitFor();await settle();};
const click=async text=>{await page.locator('.cm-journal .cm-line').filter({hasText:text}).first().click();await settle();};
const active=()=>page.locator('.cm-journal-active').allTextContents();
const ancestors=()=>page.locator('.cm-journal-ancestor').allTextContents();
const threads=()=>page.locator('.cm-journal-threading .cm-journal-thread').count();
const save=async()=>{await page.keyboard.press(`${mod}+s`);await page.getByText('모든 변경사항 저장됨',{exact:true}).waitFor();};
try{
 await setup();await open(path);await click('Active leaf');
 const circles=await page.locator('.cm-journal .cm-live-bullet').evaluateAll(bullets=>bullets.map(bullet=>{const line=bullet.closest('.cm-line'),box=bullet.getBoundingClientRect(),dot=getComputedStyle(bullet,'::after'),walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let text;while(walker.nextNode())if(/Heading one|Heading two|Active leaf/.test(walker.currentNode.textContent)){const range=document.createRange();range.selectNodeContents(walker.currentNode);text=range.getClientRects()[0];break;}return {line:line.textContent,font:parseFloat(getComputedStyle(line).fontSize),width:parseFloat(dot.width),height:parseFloat(dot.height),offset:text?Math.abs((box.top+box.bottom-text.top-text.bottom)/2):null};}));
 await writeFile(`${output}/circles.json`,JSON.stringify(circles,null,2));
 check('H1/H2/body circles stay 6px and align with their first text row',()=>{const targets=circles.filter(circle=>circle.offset!==null);assert.equal(targets.length,3);for(const circle of targets){assert.equal(circle.width,6);assert.equal(circle.height,6);assert.ok(circle.offset<1.5,JSON.stringify(circle));}assert.ok(targets[0].font>targets[1].font&&targets[1].font>targets[2].font);});
 const initialAncestors=await ancestors(),initialActive=await active(),initialThreads=await threads();
 check('focused leaf connects only its two ancestors',()=>{assert.equal(initialThreads,2);assert.equal(initialAncestors.length,2);assert.match(initialAncestors[0],/Heading one/);assert.match(initialAncestors[1],/Heading two/);assert.equal(initialActive.length,1);assert.match(initialActive[0],/Active leaf/);});
 const threadStyle=await page.locator('.cm-journal-thread').evaluateAll(elements=>elements.map(element=>{const style=getComputedStyle(element);let opacity=1;for(let parent=element;parent;parent=parent.parentElement)opacity*=Number(getComputedStyle(parent).opacity);return {verticalWidth:style.borderLeftWidth,horizontalWidth:style.borderBottomWidth,color:style.borderLeftColor,effectiveOpacity:opacity};}));
 await page.screenshot({path:`${output}/headings-and-thread.png`});
 await click('Peer leaf');const peerAncestors=await ancestors(),peerThreads=await threads();
 check('cursor movement switches the ancestor path and excludes siblings',()=>{assert.equal(peerThreads,2);assert.equal(peerAncestors.length,2);assert.match(peerAncestors[1],/Peer branch/);});
 await click('Continuation text');const continuationThreads=await threads(),continuationActive=await active();
 check('continuation keeps its owning block active',()=>{assert.equal(continuationThreads,2);assert.equal(continuationActive.length,1);assert.match(continuationActive[0],/Active leaf/);});
 await click('Task leaf');const taskThreads=await threads();check('task checkboxes connect to their parent without toggling the task',()=>assert.equal(taskThreads,1));
 await click('Active leaf');await page.keyboard.press('Tab');await settle();const indented=await threads();
 check('indent adds the previous sibling to the path',()=>assert.equal(indented,3));
 await page.keyboard.press(`${mod}+z`);await settle();const restored=await threads();check('undo restores the ancestor path',()=>assert.equal(restored,2));
 await click('Heading one');await page.getByRole('button',{name:'하위 블록 접기',exact:true}).click();await settle();const folded=await threads();
 check('folding removes hidden descendants from the thread',()=>assert.equal(folded,0));
 await page.getByRole('button',{name:'하위 블록 펼치기',exact:true}).click();await click('Active leaf');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(760,760));await settle();const narrow=await threads();check('resize retains the focused ancestor path',()=>assert.equal(narrow,2));
 await page.screenshot({path:`${output}/narrow-thread.png`});
 await page.getByRole('button',{name:'편집 보기',exact:true}).click();await settle();const sourceThreads=await threads();check('source mode has no visual thread overlay',()=>assert.equal(sourceThreads,0));
 await page.getByRole('button',{name:'Live Preview',exact:true}).click();await click('Active leaf');await save();
 assert.equal(await readFile(`${vault}/${path}`,'utf8'),original);
 await open(longPath);await page.getByRole('textbox',{name:'Markdown 편집기',exact:true}).press(`${mod}+End`);await settle();await click('Scrolled leaf');await page.waitForFunction(()=>document.querySelectorAll('.cm-journal-thread').length===2,{},{timeout:3000}).catch(()=>{});await settle();
 const scrolledThreads=await threads(),geometry=await page.locator('.cm-journal').evaluate(editor=>{
  const leaf=[...editor.querySelectorAll('.cm-line')].find(line=>line.textContent.includes('Scrolled leaf')),circle=leaf?.querySelector('.cm-live-bullet')?.getBoundingClientRect();
  const lines=[...editor.querySelectorAll('.cm-journal-thread')].map(line=>{const rect=line.getBoundingClientRect();return {left:rect.left,right:rect.right,bottom:rect.bottom};});
  const wrapped=[...editor.querySelectorAll('.cm-line')].find(line=>line.textContent.includes('Wrapped sibling')),walker=wrapped&&document.createTreeWalker(wrapped,NodeFilter.SHOW_TEXT);let wrapLeft=null;while(walker?.nextNode())if(walker.currentNode.textContent.includes('Wrapped sibling')){const range=document.createRange();range.selectNodeContents(walker.currentNode);wrapLeft=Math.min(...[...range.getClientRects()].map(rect=>rect.left));break;}
  return {wrapLeft,circle:circle?{x:(circle.left+circle.right)/2,y:(circle.top+circle.bottom)/2}:null,lines};
 });
 check('wrapped siblings and offscreen ancestors retain aligned connectors after scrolling',()=>{assert.equal(scrolledThreads,2);assert.ok(geometry.circle);assert.ok(geometry.wrapLeft>geometry.lines.at(-1).left+2,JSON.stringify(geometry));assert.ok(Math.abs(geometry.lines.at(-1).right-geometry.circle.x)<1.5,JSON.stringify(geometry));assert.ok(Math.abs(geometry.lines.at(-1).bottom-geometry.circle.y)<1.5,JSON.stringify(geometry));});
 await page.screenshot({path:`${output}/scrolled-thread.png`});assert.equal(await readFile(`${vault}/${longPath}`,'utf8'),longContent);
 await open('Normal.md');const normal=await page.locator('.cm-journal-threading').count();check('ordinary documents have no journal thread layer',()=>assert.equal(normal,0));
 await open(importedPath);await click('Imported leaf');
 const importedSpacing=await page.locator('.cm-journal .cm-live-bullet').evaluateAll(bullets=>bullets.map(bullet=>{const rect=bullet.getBoundingClientRect();return (rect.left+rect.right)/2;}));
 check('four-space and tab-indented Markdown retains a 30px step per hierarchy level',()=>{assert.equal(importedSpacing.length,3);for(let index=1;index<importedSpacing.length;index++)assert.ok(Math.abs(importedSpacing[index]-importedSpacing[index-1]-30)<1,JSON.stringify(importedSpacing));});
 assert.equal(await readFile(`${vault}/${importedPath}`,'utf8'),importedContent);
 await page.screenshot({path:`${output}/imported-indentation.png`});
 const timingPath='Journal/2026-11-01.md';
 const timingContent='- Root block\n  - Image parent ![[_attachments/timing.png]]\n    - Leaf after image\n    - Peer after image\n  - Following sibling\n';
 const imePath='Journal/2026-10-31.md';
 const imeContent='- IME root\n  - IME parent\n    - IME leaf\n    - IME sibling\n';
 const png=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');
  canvas.width=230;canvas.height=205;
  const context=canvas.getContext('2d');
  context.fillStyle='#d8c7eb';context.fillRect(0,0,230,205);
  return canvas.toDataURL('image/png').split(',')[1];
 });
 await mkdir(`${vault}/_attachments`,{recursive:true});
 await writeFile(`${vault}/_attachments/timing.png`,Buffer.from(png,'base64'));
 await writeFile(`${vault}/${timingPath}`,timingContent);
 await writeFile(`${vault}/${imePath}`,imeContent);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));
 await page.getByRole('button',{name:'문서 새로고침',exact:true}).click();
 await page.getByTitle(timingPath,{exact:true}).waitFor();
 await open(timingPath);await click('Leaf after image');
 const image=page.locator('img.cm-live-image');
 await image.click();await image.waitFor({state:'hidden'});
 await page.evaluate(()=>{
  const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){
   if(!value.endsWith('/timing.png'))return descriptor.set.call(this,value);
   Object.defineProperty(HTMLImageElement.prototype,'src',descriptor);
   window.resumeThreadImage=()=>descriptor.set.call(this,value+'?delayed-preview');
  }});
 });
 await click('Leaf after image');
 await page.waitForFunction(()=>typeof window.resumeThreadImage==='function');
 const imageLayout=()=>page.locator('.cm-journal').evaluate(editor=>{
  const rect=element=>element.getBoundingClientRect();
  const picture=rect(editor.querySelector('img.cm-live-image'));
  const bullet=rect(editor.querySelector('.cm-journal-active .cm-live-bullet'));
  const caret=rect(editor.querySelector('.cm-cursor-primary'));
  return {imageTop:picture.top,imageBottom:picture.bottom,editorHeight:rect(editor.querySelector('.cm-content')).height,
   bulletY:(bullet.top+bullet.bottom)/2,caretY:(caret.top+caret.bottom)/2,
   ends:[...editor.querySelectorAll('.cm-journal-thread')].map(line=>rect(line).bottom)};
 });
 const beforeImage=await imageLayout();
 await page.evaluate(()=>window.resumeThreadImage());
 await page.waitForFunction(()=>document.querySelector('img.cm-live-image')?.naturalHeight===205);
 await settle();
 const afterImage=await imageLayout();
 check('an image that loads after returning from Markdown keeps the branch on the bullet below it',()=>{
  assert.equal(beforeImage.ends.length,2);
  assert.ok(afterImage.bulletY-beforeImage.bulletY>100,JSON.stringify({beforeImage,afterImage}));
  assert.equal(afterImage.ends.length,2);
  assert.ok(afterImage.ends.at(-1)>afterImage.imageBottom,JSON.stringify({beforeImage,afterImage}));
  assert.ok(Math.abs(afterImage.ends.at(-1)-afterImage.bulletY)<1.5,JSON.stringify({beforeImage,afterImage}));
 });
 check('the editing caret follows the child below the loaded image',()=>{
  assert.ok(afterImage.caretY>afterImage.imageBottom,JSON.stringify({beforeImage,afterImage}));
  assert.ok(Math.abs(afterImage.caretY-afterImage.bulletY)<8,JSON.stringify({beforeImage,afterImage}));
 });
 assert.equal(await readFile(`${vault}/${timingPath}`,'utf8'),timingContent);
 await page.screenshot({path:`${output}/image-thread.png`});

 await open(imePath);
 await page.getByRole('textbox',{name:'Markdown 편집기',exact:true}).focus();
 await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowUp':'Control+Home');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
 await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowRight':'End');
 await settle();
 assert.match((await active())[0]??'',/IME leaf/);
 const cdp=await page.context().newCDPSession(page),ime=[];
 try {
  for(const text of ['ㅎ','하','한']){
   await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
   await settle();
   ime.push({text,threads:await threads(),active:await active(),ancestors:await ancestors()});
  }
  await cdp.send('Input.insertText',{text:'한'});
 }finally{await cdp.detach();}
 await save();
 check('Korean IME keeps the active path visible throughout composition',()=>{
  for(const state of ime){
   assert.equal(state.threads,2,JSON.stringify(state));
   assert.equal(state.ancestors.length,2);
   assert.equal(state.active.length,1);
   assert.ok(state.active[0].includes('IME leaf'+state.text),JSON.stringify(state));
  }
 });
 const committed=await readFile(`${vault}/${imePath}`,'utf8');
 check('the composed text is saved once in the focused child',()=>assert.equal(committed,imeContent.replace('IME leaf','IME leaf한')));
 await app.close();app=await launch();await setup();await open(path);await click('Active leaf');const restarted=await threads();
 check('restart preserves Markdown bytes and restores threading',()=>assert.equal(restarted,2));assert.equal(await readFile(`${vault}/${path}`,'utf8'),original);
 check('renderer has no errors',()=>assert.deepEqual(errors,[]));
 const report={checks,failures,errors,circles,importedSpacing,threadStyle,imageLayout:{before:beforeImage,after:afterImage},ime};await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));assert.deepEqual(failures,[]);
}finally{await app.close();await rm(root,{recursive:true,force:true});}
