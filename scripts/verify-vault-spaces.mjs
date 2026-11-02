import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE||'playwright');
const root=await realpath(await mkdtemp(`${tmpdir()}/dynote-spaces-ui-`)),profile=`${root}/profile`,personal=`${root}/Personal`,team=`${root}/Team`,nested=`${personal}/Nested`,config=`${root}/gitconfig`;
for(const folder of [profile,personal,team,nested])await mkdir(folder,{recursive:true});
await mkdir('output/playwright',{recursive:true});
const original='# Personal\n\nPrivate fixture only.\n',shared='# Team\n\nShared fixture only.\n';
await writeFile(`${personal}/Private.md`,original);await writeFile(`${team}/Shared.md`,shared);
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:personal}));await writeFile(config,'');
const env={...process.env,OPEN_NOTES_DATA:profile,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1'};
const git=(...args)=>execFileSync('git',args,{env,encoding:'utf8',stdio:['pipe','pipe','pipe']});
git('config','--file',config,'user.name','Space Fixture');git('config','--file',config,'user.email','fixture@example.invalid');
const remotes={personal:'https://spaces.test/personal.git',team:'https://spaces.test/team.git'};
for(const [purpose,remote] of Object.entries(remotes)){
 const bare=`${root}/${purpose}.git`;git('init','--bare','--initial-branch=main',bare);git('config','--file',config,`url.file://${bare}.insteadOf`,remote);
}
const launch=()=>electron.launch({executablePath:process.env.DYNOTE_EXECUTABLE||`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:process.env.DYNOTE_EXECUTABLE?[]:['.'],env});
let app,page;const report={checks:[],errors:[]};
async function start(){app=await launch();page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));await page.getByRole('button',{name:'설정',exact:true}).waitFor();await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setSize(1050,700);});}
const identity=()=>page.getByRole('button',{name:'공간 전환·관리',exact:true});
const row=name=>page.locator('.vault-settings-list li').filter({has:page.getByText(name,{exact:true})});
const close=()=>page.getByRole('dialog',{name:'설정',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
const picker=folder=>app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
async function connect(purpose){
 await page.getByRole('button',{name:'백업·복원',exact:true}).click();
 await page.getByRole('textbox',{name:'Git 저장소 주소',exact:true}).fill(remotes[purpose]);
 await page.getByRole('button',{name:'연결하고 백업 시작',exact:true}).click();
 await page.locator('.git-space-context').getByText(remotes[purpose],{exact:true}).waitFor();
 await page.getByRole('button',{name:'자동 백업 끄기',exact:true}).click();
}
try{
 await start();await identity().waitFor({timeout:3000});assert.match(await identity().innerText(),/용도 미지정/);await identity().click();
 await page.getByRole('heading',{name:'개인·팀 공간',exact:true}).waitFor();
 assert.match(await page.locator('.space-guide').innerText(),/서로 다른 폴더/);
 assert.match(await page.locator('.space-guide').innerText(),/Git 저장소/);
 await page.getByRole('combobox',{name:'Personal 공간 용도',exact:true}).selectOption('personal');
 await page.getByText('공간 용도를 저장했습니다.',{exact:true}).waitFor();assert.match(await identity().innerText(),/개인 노트/);
 assert.equal(await readFile(`${personal}/Private.md`,'utf8'),original);
 await page.screenshot({path:'output/playwright/vault-spaces-personal.png'});
 report.checks.push('legacy space remains unclassified; explicit personal choice is saved without modifying notes');
 await picker(nested);await page.getByRole('button',{name:'팀 공유 폴더 연결',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'서로 포함'}).waitFor();
 assert.equal(JSON.parse(await readFile(`${profile}/settings.json`,'utf8')).vaultRoot,personal);
 report.checks.push('nested personal/team folders are rejected and the original space stays selected');
 await connect('personal');
 await page.getByRole('button',{name:'개인·팀 공간 관리',exact:true}).click();
 await picker(team);await page.getByRole('button',{name:'팀 공유 폴더 연결',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.vault-switch')?.textContent.includes('팀 공유 노트'));
 await connect('team');assert.match(await page.locator('.git-space-context').innerText(),/팀 공유 노트/);assert.match(await page.locator('.git-space-context').innerText(),/접근 권한/);
 assert.equal(git('--git-dir',`${root}/personal.git`,'show','main:Private.md'),original);
 assert.equal(git('--git-dir',`${root}/team.git`,'show','main:Shared.md'),shared);
 assert.throws(()=>git('--git-dir',`${root}/team.git`,'show','main:Private.md'));
 report.checks.push('personal and team connect to separate real local remotes; private notes are absent from the team repository');
 await page.locator('.git-space-context').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/vault-spaces-git.png'});
 await close();await page.getByRole('button',{name:'파일 목록',exact:true}).click();await page.locator('.file-row[title="Shared.md"]').click();
 await page.getByRole('button',{name:'편집 보기',exact:true}).click();await page.locator('.cm-content').click();await page.keyboard.press(process.platform==='darwin'?'Meta+End':'Control+End');await page.keyboard.insertText('Team edit\n');
 await identity().click();await row(personal).getByRole('button',{name:'열기',exact:true}).click();
 await identity().filter({hasText:'개인 노트'}).waitFor();
 assert.match(await identity().innerText(),/개인 노트/);assert.equal(await readFile(`${team}/Shared.md`,'utf8'),shared+'Team edit\n');
 await page.getByRole('button',{name:'백업·복원',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Git 저장소 주소',exact:true}).inputValue(),remotes.personal);
 await close();await page.getByRole('button',{name:'전체 검색',exact:true}).click();await page.getByRole('textbox',{name:'전체 문서 검색',exact:true}).fill('Shared fixture');
 assert.equal(await page.locator('.search-result').count(),0);
 report.checks.push('space switch flushes team edits, restores the personal Git address and keeps search scoped to the current space');
 await app.close();await start();await identity().filter({hasText:'개인 노트'}).waitFor();assert.match(await identity().innerText(),/개인 노트/);await identity().click();
 assert.equal(await page.getByRole('combobox',{name:'Personal 공간 용도',exact:true}).inputValue(),'personal');assert.equal(await page.getByRole('combobox',{name:'Team 공간 용도',exact:true}).inputValue(),'team');
 for(const width of [1050,800]){
  await app.evaluate(({BrowserWindow},width)=>{const window=BrowserWindow.getAllWindows()[0];window.setMinimumSize(800,700);window.setSize(width,700);},width);
  const overflow=await page.getByRole('dialog',{name:'설정',exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
 }
 await page.screenshot({path:'output/playwright/vault-spaces-compact.png'});
 const before=await readFile(`${profile}/settings.json`);const invalid=await page.evaluate(async root=>window.notes.setVaultPurpose({root,purpose:'public'}),personal);assert.equal(invalid.ok,false);assert.deepEqual(await readFile(`${profile}/settings.json`),before);
 report.checks.push('purpose choices persist after restart; compact settings fit; invalid IPC cannot rewrite settings');
 assert.equal(await readFile(`${personal}/Private.md`,'utf8'),original);assert.deepEqual(report.errors,[]);
 await writeFile('output/playwright/vault-spaces.json',JSON.stringify(report,null,2)+'\n');console.log(report);
}catch(error){console.error(error,report.errors);await app?.evaluate(({app})=>app.exit(1)).catch(()=>{});throw error;}finally{await app?.close();await rm(root,{recursive:true,force:true});}
