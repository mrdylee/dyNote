import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const fixture=await mkdtemp(`${tmpdir()}/dynote-pdf-links-`),profile=`${fixture}/profile`,vault=`${fixture}/vault`;
await mkdir(profile);await mkdir(vault);await mkdir('output/playwright',{recursive:true});
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault}));
await writeFile(`${vault}/Note.md`,'# PDF links\n\n[[manual.pdf#page=2&selection=0,0,0,6|Selection]]\n\n[Annotation](manual.pdf#page=2&annotation=8R)\n\n[[a%23b.pdf#page=2|Hash file]]\n');await copyFile('tests/fixtures/link-target.pdf',`${vault}/manual.pdf`);
await copyFile('tests/fixtures/link-target.pdf',`${vault}/a#b.pdf`);
const before=await readFile(`${vault}/manual.pdf`);
const app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.markdown-preview a').filter({hasText:'Selection'}).click();
 await page.getByLabel('PDF 2페이지',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.getSelection()?.toString()==='Second');
 assert.equal(await page.getByLabel('PDF 페이지',{exact:true}).inputValue(),'2');
 await page.getByRole('button',{name:'선택 영역 링크 복사',exact:true}).click();
 const text=await app.evaluate(({clipboard})=>clipboard.readText());assert.equal(text,'[[manual.pdf#page=2&selection=0,0,0,6]]');
 await page.getByRole('button',{name:'PDF 확대',exact:true}).click();await page.getByRole('button',{name:'PDF 축소',exact:true}).click();
 await page.getByRole('region',{name:'PDF 백링크'}).getByRole('button',{name:'Note.md',exact:true}).first().click();
 await page.locator('.markdown-preview a').filter({hasText:'Annotation'}).click();await page.getByLabel('PDF 링크 주석',{exact:true}).waitFor();
 await page.getByRole('button',{name:'문서로 돌아가기',exact:true}).click();await page.locator('.markdown-preview a').filter({hasText:'Hash file'}).click();await page.getByLabel('PDF 2페이지',{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/native-pdf-links.png'});
 assert.deepEqual(await readFile(`${vault}/manual.pdf`),before);assert.deepEqual(errors,[]);
 const report={checks:['wiki selection fragment opens page 2','text selection restored','native clipboard copies compatible selection link','zoom cancellation','PDF backlinks return to source','Markdown annotation fragment highlights original annotation','source PDF bytes unchanged'],errors};
 await writeFile('output/playwright/native-pdf-links.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){const p=app.windows()[0];if(p){console.error((await p.locator('body').innerText()).slice(-2400));await p.screenshot({path:'output/playwright/native-pdf-failure.png'});}throw e;}finally{await app.close();await rm(fixture,{recursive:true,force:true});}
