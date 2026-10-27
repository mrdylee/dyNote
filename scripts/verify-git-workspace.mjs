import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {runGit} from '../core/git-backup.mjs';
const {_electron:electron}=await import(process.env.DYNOTE_PLAYWRIGHT_MODULE || 'playwright');
const fixture=await mkdtemp(`${tmpdir()}/dynote-git-ui-`),profile=`${fixture}/profile`,vault=`${fixture}/vault`;
await mkdir(profile);await mkdir(vault);await mkdir('output/playwright',{recursive:true});
await writeFile(`${profile}/settings.json`,JSON.stringify({vaultRoot:vault}));
await runGit(vault,['init','--initial-branch=main']);await runGit(vault,['config','user.name','Fixture']);await runGit(vault,['config','user.email','fixture@example.test']);
await writeFile(`${vault}/A.md`,'original\n');await runGit(vault,['add','--','A.md']);await runGit(vault,['commit','-m','initial']);await writeFile(`${vault}/A.md`,'native changed\n');
const app=await electron.launch({executablePath:`${process.cwd()}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,args:['.'],env:{...process.env,OPEN_NOTES_DATA:profile}});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'명령 팔레트',exact:true}).waitFor();await page.keyboard.press('Meta+p');await page.getByRole('textbox',{name:'명령 검색'}).fill('Git 변경 관리');await page.keyboard.press('Enter');
 const panel=page.getByRole('region',{name:'Git 변경 관리'});await panel.waitFor();await panel.getByRole('button',{name:'A.md 스테이징',exact:true}).click();
 await panel.getByRole('button',{name:'A.md 스테이징 해제',exact:true}).waitFor();await panel.getByRole('button',{name:'A.md',exact:true}).click();assert.match(await page.getByLabel('Git 파일 차이').textContent(),/\+native changed/);
 await page.getByRole('textbox',{name:'Git 커밋 메시지'}).fill('native UI commit');await page.getByRole('button',{name:'스테이징한 변경 커밋',exact:true}).click();await page.getByText('노트 변경사항이 없습니다.',{exact:true}).waitFor();
 assert.equal((await runGit(vault,['log','-1','--format=%s'])).stdout.trim(),'native UI commit');assert.equal(await readFile(`${vault}/A.md`,'utf8'),'native changed\n');
 await page.getByRole('textbox',{name:'새 Git 브랜치 이름'}).fill('feature-ui');await page.getByRole('button',{name:'브랜치 만들고 전환',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="전환할 Git 브랜치"]')?.value==='feature-ui');
 await page.getByRole('combobox',{name:'전환할 Git 브랜치'}).selectOption('main');await page.waitForFunction(()=>document.querySelector('[aria-label="전환할 Git 브랜치"]')?.value==='main');
 await writeFile(`${vault}/A.md`,'external dirty\n');await page.getByRole('textbox',{name:'새 Git 브랜치 이름'}).fill('blocked-dirty');await page.getByRole('button',{name:'브랜치 만들고 전환',exact:true}).click();
 await panel.getByRole('alert').filter({hasText:'변경사항'}).waitFor();assert.equal(await readFile(`${vault}/A.md`,'utf8'),'external dirty\n');
 await page.screenshot({path:'output/playwright/native-git-workspace.png'});assert.deepEqual(errors,[]);
 const report={checks:['native Git status/stage/diff/commit','actual HEAD and worktree verified','branch create and switch','dirty branch refusal preserves bytes'],errors};await writeFile('output/playwright/native-git-workspace.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){const p=app.windows()[0];if(p){console.error((await p.locator('body').innerText()).slice(-2400));await p.screenshot({path:'output/playwright/native-git-failure.png'});}throw e;}finally{await app.close();await rm(fixture,{recursive:true,force:true});}
