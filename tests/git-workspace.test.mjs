import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {runGit} from '../core/git-backup.mjs';
import * as tools from '../core/git-workspace.mjs';
async function fixture(t){const dir=await mkdtemp(`${tmpdir()}/dynote-git-workspace-`);t.after(()=>rm(dir,{recursive:true,force:true}));const root=`${dir}/vault`;await mkdir(root);await runGit(root,['init','--initial-branch=main']);await runGit(root,['config','user.name','Fixture']);await runGit(root,['config','user.email','fixture@example.test']);await writeFile(`${root}/A.md`,'original\n');await runGit(root,['add','--','A.md']);await runGit(root,['commit','-m','initial']);return {dir,root};}
test('GIT-01 status/stage/diff/commit/unstage use the actual index and preserve worktree',async t=>{
 assert.equal(typeof tools.GitWorkspace,'function');const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 await writeFile(`${root}/A.md`,'changed\n');await writeFile(`${root}/B.md`,'new\n');
 let status=await git.status();assert.deepEqual(status.files.map(f=>f.path).sort(),['A.md','B.md']);
 await git.action({kind:'stage',path:'A.md'});assert.match(await git.diff('A.md',true),/\+changed/);
 await git.action({kind:'commit',message:'native commit'});assert.match((await runGit(root,['log','-1','--format=%s'])).stdout,/native commit/);
 assert.equal(await readFile(`${root}/B.md`,'utf8'),'new\n');await git.action({kind:'stage',path:'B.md'});await git.action({kind:'unstage',path:'B.md'});
 assert.equal((await runGit(root,['diff','--cached','--name-only'])).stdout,'');
});
test('new journals in an untracked folder can be staged individually',async t=>{
 const {root}=await fixture(t),git=new tools.GitWorkspace(root),journal='Journal/2026-11-06.md';
 await mkdir(`${root}/Journal`);
 await writeFile(`${root}/${journal}`,'# Today\n');
 await writeFile(`${root}/Journal/data.tmp`,'synthetic non-note');
 const status=await git.status();
 assert.deepEqual(status.files.map(file=>file.path),[journal]);
 assert.equal(status.excluded,1);
 await git.action({kind:'stage',path:journal});
 assert.equal((await runGit(root,['diff','--cached','--name-only'])).stdout.trim(),journal);
});
test('GIT-01 excluded staging and invalid native arguments cannot commit unreviewed files',async t=>{
 assert.equal(typeof tools.GitWorkspace,'function');const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 await writeFile(`${root}/.secret`,'synthetic only');await runGit(root,['add','--','.secret']);
 assert.equal((await git.status()).excluded,1);await assert.rejects(git.action({kind:'commit',message:'bad'}),/노트 이외/);
 await assert.rejects(git.action({kind:'stage',path:'../other.md'}),/경로/);await assert.rejects(git.action({kind:'create-branch',branch:'--bad'}),/브랜치/);
 assert.equal(await readFile(`${root}/.secret`,'utf8'),'synthetic only');
});
test('GIT-01 clean fast-forward pull succeeds and dirty worktree is preserved',async t=>{
 assert.equal(typeof tools.GitWorkspace,'function');const {dir,root}=await fixture(t),git=new tools.GitWorkspace(root),remote=`${dir}/remote.git`,other=`${dir}/other`;
 await runGit(dir,['init','--bare',remote]);await runGit(root,['remote','add','origin',remote]);await runGit(root,['push','--set-upstream','origin','main']);await runGit(dir,['clone','--branch','main','--',remote,other]);await runGit(other,['config','user.name','Fixture']);await runGit(other,['config','user.email','fixture@example.test']);
 await writeFile(`${other}/A.md`,'remote\n');await runGit(other,['add','--','A.md']);await runGit(other,['commit','-m','remote']);await runGit(other,['push']);
 await assert.rejects(git.action({kind:'pull'},async apply=>{
   await writeFile(`${root}/A.md`,'edited during download\n');
   return apply();
 }),/변경사항/);
 assert.equal(await readFile(`${root}/A.md`,'utf8'),'edited during download\n');
 await runGit(root,['restore','--','A.md']);
 await git.action({kind:'fetch'});await git.action({kind:'pull'});assert.equal(await readFile(`${root}/A.md`,'utf8'),'remote\n');
 await writeFile(`${root}/A.md`,'dirty\n');await assert.rejects(git.action({kind:'pull'}),/변경사항/);assert.equal(await readFile(`${root}/A.md`,'utf8'),'dirty\n');
 await git.action({kind:'stage',path:'A.md'});await git.action({kind:'commit',message:'local diverged'});const localHead=(await runGit(root,['rev-parse','HEAD'])).stdout;
 await writeFile(`${other}/Remote.md`,'remote new\n');await runGit(other,['add','--','Remote.md']);await runGit(other,['commit','-m','other diverged']);await runGit(other,['push']);
 await assert.rejects(git.action({kind:'pull'}));assert.equal((await runGit(root,['rev-parse','HEAD'])).stdout,localHead);assert.equal(await readFile(`${root}/A.md`,'utf8'),'dirty\n');
});
test('GIT-01 branch changes require clean files and merged-only deletion preserves unmerged work',async t=>{
 assert.equal(typeof tools.GitWorkspace,'function');const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 await git.action({kind:'create-branch',branch:'feature'});assert.equal((await git.status()).branch,'feature');
 await writeFile(`${root}/A.md`,'branch work\n');await assert.rejects(git.action({kind:'switch-branch',branch:'main'}),/변경사항/);
 await git.action({kind:'stage',path:'A.md'});await git.action({kind:'commit',message:'feature work'});await git.action({kind:'switch-branch',branch:'main'});
 await assert.rejects(git.action({kind:'delete-branch',branch:'feature'}));assert.ok((await git.status()).branches.includes('feature'));
});

test('GIT-01 parent repository is rejected and a merged local branch can be removed safely',async t=>{
 assert.equal(typeof tools.GitWorkspace,'function');const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 await mkdir(`${root}/nested`);await assert.rejects(new tools.GitWorkspace(`${root}/nested`).status(),/루트/);
 await git.action({kind:'create-branch',branch:'empty-feature'});await git.action({kind:'switch-branch',branch:'main'});await git.action({kind:'delete-branch',branch:'empty-feature'});
 assert.equal((await git.status()).branches.includes('empty-feature'),false);assert.equal(await readFile(`${root}/A.md`,'utf8'),'original\n');
});

test('GIT-01 initial staging can be undone even after further edits without deleting bytes',async t=>{
 const dir=await mkdtemp(`${tmpdir()}/dynote-git-initial-`);t.after(()=>rm(dir,{recursive:true,force:true}));const git=new tools.GitWorkspace(dir);
 await git.action({kind:'init'});await writeFile(`${dir}/A.md`,'first\n');await git.action({kind:'stage',path:'A.md'});await writeFile(`${dir}/A.md`,'newer unsaved in index\n');
 await git.action({kind:'unstage',path:'A.md'});assert.equal(await readFile(`${dir}/A.md`,'utf8'),'newer unsaved in index\n');assert.equal((await runGit(dir,['diff','--cached','--name-only'])).stdout,'');
});

test('configured Git fetch/push addresses are readable without backup setup or config changes',async t=>{
 const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 await runGit(root,['remote','add','origin','https://team.example.invalid/docs.git']);
 await runGit(root,['remote','set-url','--add','origin','ssh://git@mirror.example.invalid/docs.git']);
 await runGit(root,['remote','set-url','--push','origin','git@write.example.invalid:docs.git']);
 await runGit(root,['remote','add','upstream','https://source.example.invalid/docs.git']);
 const config=await readFile(`${root}/.git/config`),note=await readFile(`${root}/A.md`);
 const state=await git.status();assert.deepEqual(state.remoteUrls,[
  {name:'origin',fetch:['https://team.example.invalid/docs.git','ssh://git@mirror.example.invalid/docs.git'],push:['git@write.example.invalid:docs.git']},
  {name:'upstream',fetch:['https://source.example.invalid/docs.git'],push:['https://source.example.invalid/docs.git']},
 ]);
 assert.deepEqual(await readFile(`${root}/.git/config`),config);assert.deepEqual(await readFile(`${root}/A.md`),note);
});

test('Git remote details distinguish a local repository from a folder without Git',async t=>{
 const {dir,root}=await fixture(t),git=new tools.GitWorkspace(root);
 const initialized=await git.status();assert.equal(initialized.available,true);assert.deepEqual(initialized.remoteUrls,[]);
 const plain=`${dir}/plain`;await mkdir(plain);
 const state=await new tools.GitWorkspace(plain).status();assert.equal(state.available,false);assert.deepEqual(state.remoteUrls,[]);
});

test('remote display metadata omits URL credentials and tokens without changing stored URLs',async t=>{
 const {root}=await fixture(t),git=new tools.GitWorkspace(root);
 for(const host of ['example.invalid','invalid host']){
  const url=`https://fixture-user:fixture-password@${host}/docs.git?token=fixture-token#fixture-secret`;
  await runGit(root,['config','remote.origin.url',url]);
  const config=await readFile(`${root}/.git/config`),state=await git.status();
  assert.ok(Array.isArray(state.remoteUrls));assert.equal(state.remoteUrls[0].fetch.length,1);
  assert.ok(state.remoteUrls[0].fetch[0].includes(`${host}/docs.git`));
  assert.doesNotMatch(JSON.stringify(state.remoteUrls),/fixture-user|fixture-password|fixture-token|fixture-secret/);
  assert.deepEqual(await readFile(`${root}/.git/config`),config);
 }
});

async function teamFixture(t) {
  const {dir,root}=await fixture(t), remote=`${dir}/team.git`, other=`${dir}/colleague`;
  await runGit(root,['branch','-m','team-dev']);
  await runGit(dir,['init','--bare','--initial-branch=team-dev',remote]);
  await runGit(root,['remote','add','team',remote]);
  await runGit(root,['push','--set-upstream','team','team-dev']);
  await runGit(dir,['clone','--branch','team-dev','--',remote,other]);
  for (const [key,value] of [['user.name','Colleague'],['user.email','colleague@example.test']])
    await runGit(other,['config',key,value]);
  const publish=async (name,bytes)=>{
    await writeFile(`${other}/${name}`,bytes);
    await runGit(other,['add','--force','--',name]);
    await runGit(other,['commit','-m','team edit']);
    await runGit(other,['push']);
  };
  const head=async (where,ref='HEAD')=>(await runGit(where,['rev-parse',ref])).stdout.trim();
  return {dir,root,remote,other,publish,head,git:new tools.GitWorkspace(root)};
}

test('team quick-sync checks the selected Git address before saving or transferring notes',async t=>{
  const {root,remote,git,head}=await teamFixture(t), before=await head(root);
  const address=(await runGit(root,['remote','get-url','team'])).stdout.trim();
  await writeFile(`${root}/A.md`,'unsent team edit');
  await assert.rejects(git.syncTeam(null,url=>{
    assert.equal(url,address);
    throw new Error('Reserved repository');
  }),/Reserved repository/);
  assert.equal(await head(root),before);
  assert.equal(await head(remote,'team-dev'),before);
  assert.equal(await readFile(`${root}/A.md`,'utf8'),'unsent team edit');
});

test('team quick-sync merges independent native edits on the tracked branch, reports local-only files and stays idle',async t=>{
  const {dir,root,remote,other,git,publish,head}=await teamFixture(t);
  await runGit(root,['remote','add','origin',`${dir}/unrelated.git`]);
  await mkdir(`${root}/File Storage`);
  await writeFile(`${root}/File Storage/only.zip`,'private archive');
  await writeFile(`${root}/A.md`,'my edit\n');
  await publish('B.md','their edit\n');
  const result=await git.syncTeam();
  assert.equal(result.phase,'synced');
  assert(result.localOnlyFiles.some(file=>file.name==='File Storage/only.zip'));
  assert.match(result.message,/로컬|기기/);
  assert.equal((await runGit(remote,['show','team-dev:B.md'])).stdout,'their edit\n');
  const checkedOut=(await runGit(root,['cat-file','--filters','HEAD:B.md'],{nativeCheckout:true})).stdout;
  assert.equal(await readFile(`${root}/B.md`,'utf8'),checkedOut);
  assert.equal((await runGit(remote,['show','team-dev:A.md'])).stdout,'my edit\n');
  const saved=await head(root);
  assert.equal(await head(remote,'team-dev'),saved);
  assert.equal(await head(root,'@{upstream}'),saved);
  const names=(await runGit(remote,['ls-tree','--name-only','-r','team-dev'])).stdout;
  assert.doesNotMatch(names,/only\.zip|\.dynote-sync/);
  await runGit(other,['pull','--ff-only']);
  assert.equal(await readFile(`${other}/A.md`,'utf8'),'my edit\n');
  await git.syncTeam();
  assert.equal(await head(root),saved);
});

test('team quick-sync leaves the index and both conflicting versions available without entering a merge',async t=>{
  const {root,remote,git,publish,head}=await teamFixture(t);
  await writeFile(`${root}/A.md`,'ours\n');
  await runGit(root,['add','--','A.md']);
  const before=await head(root);
  await publish('A.md','theirs\n');
  const upstream=await head(remote,'team-dev');
  await assert.rejects(git.syncTeam(),/스테이징/);
  assert.equal(await head(root),before);
  assert.equal((await runGit(root,['show',':A.md'])).stdout,'ours\n');
  await runGit(root,['restore','--staged','A.md']);
  await assert.rejects(git.syncTeam(),/충돌/);
  assert.equal(await readFile(`${root}/A.md`,'utf8'),'ours\n');
  assert.equal((await runGit(root,['show','HEAD:A.md'])).stdout,'ours\n');
  assert.equal((await runGit(root,['ls-files','--unmerged'])).stdout,'');
  await assert.rejects(readFile(`${root}/.git/MERGE_HEAD`),{code:'ENOENT'});
  assert.equal(await head(remote,'team-dev'),upstream);
});

test('team quick-sync protects an ignored worktree file which the incoming commit would replace',async t=>{
  const {root,git,publish,head}=await teamFixture(t);
  await writeFile(`${root}/.git/info/exclude`,'ignore.md\n');
  await writeFile(`${root}/ignore.md`,'unsent copy');
  await publish('ignore.md','remote copy');
  const before=await head(root);
  await assert.rejects(git.syncTeam());
  assert.equal(await head(root),before);
  assert.equal(await readFile(`${root}/ignore.md`,'utf8'),'unsent copy');
});

test('team quick-sync refuses a rewound or deleted upstream and a contradictory saved destination',async t=>{
  const {dir,root,remote,git,publish,head}=await teamFixture(t);
  const first=await head(root);
  await publish('next.md','remote first');
  await git.syncTeam();
  const recent=await head(root);
  await runGit(remote,['update-ref','refs/heads/team-dev',first,recent]);
  await assert.rejects(git.syncTeam(),/이력|재작성/);
  assert.equal(await head(remote,'team-dev'),first);
  await runGit(remote,['update-ref','-d','refs/heads/team-dev',first]);
  await assert.rejects(git.syncTeam(),/삭제|브랜치/);
  assert.equal((await runGit(remote,['show-ref','--heads'],{allow:[0,1]})).stdout,'');
  await runGit(root,['config',`url.${dir}/elsewhere.insteadOf`,'https://elsewhere.invalid/team.git']);
  const mismatch=await git.syncTeam({remote:'https://elsewhere.invalid/team.git',branch:'team-dev',push:true});
  assert.equal(mismatch.phase,'setup');
});

test('team quick-sync uses an explicit daily destination without a native remote and respects commit-only setup',async t=>{
  const {root,remote,git,publish,head}=await teamFixture(t);
  await runGit(root,['remote','remove','team']);
  const alias='https://team.example.invalid/docs.git';
  await runGit(root,['config',`url.${remote}.insteadOf`,alias]);
  const config={remote:alias,branch:'team-dev',authorName:'Team Writer',authorEmail:'team@example.test',push:false};
  const before=await head(root);
  await writeFile(`${root}/A.md`,'mine');
  assert.equal((await git.syncTeam(config)).phase,'setup');
  assert.equal(await head(root),before);
  await publish('incoming.md','theirs');
  assert.equal((await git.syncTeam({...config,push:true})).phase,'synced');
  assert.equal((await runGit(remote,['show','team-dev:A.md'])).stdout,'mine');
  assert.equal(await readFile(`${root}/incoming.md`,'utf8'),'theirs');
  assert.equal((await runGit(root,['log','-1','--format=%an'])).stdout.trim(),'Team Writer');
});

test('team quick-sync keeps Windows checkout line endings out of the remote PDF and follows incoming notes',async t=>{
  const {dir,remote,publish,head}=await teamFixture(t), clone=`${dir}/windows`;
  const pdf=Buffer.from('%PDF-1.4\nstartxref\n0\n%%EOF\n'), binary=Buffer.from([1,0,10,31]);
  await publish('paper.pdf',pdf);
  await publish('binary.png',binary);
  await runGit(dir,['-c','core.autocrlf=true','clone','--config','core.autocrlf=true','--branch','team-dev','--',remote,clone]);
  await runGit(clone,['config','user.name','Windows']);
  await runGit(clone,['config','user.email','win@example.test']);
  for(const name of ['A.md','paper.pdf']){
    const bytes=await readFile(`${clone}/${name}`);
    assert(bytes.includes('\r\n'));
    await rm(`${clone}/${name}`);
    await writeFile(`${clone}/${name}`,bytes);
  }
  assert.equal((await runGit(clone,['diff','--name-only'])).stdout.trim(),'A.md\npaper.pdf');
  const git=new tools.GitWorkspace(clone), before=await head(remote,'team-dev');
  assert.equal((await git.syncTeam()).phase,'synced');
  assert.equal(await head(remote,'team-dev'),before);
  assert.deepEqual((await runGit(remote,['show','team-dev:paper.pdf'],{encoding:null})).stdout,pdf);
  assert.deepEqual(await readFile(`${clone}/binary.png`),binary);
  await publish('A.md','incoming\n');
  await git.syncTeam();
  assert.equal(await readFile(`${clone}/A.md`,'utf8'),'incoming\r\n');
  const edited=Buffer.from('%PDF-1.4\r\nchanged stream\r\n%%EOF\r\n');
  await writeFile(`${clone}/paper.pdf`,edited);
  await git.syncTeam();
  assert.deepEqual((await runGit(remote,['show','team-dev:paper.pdf'],{encoding:null})).stdout,edited);
});

test('team quick-sync cannot re-create a branch deleted between the snapshot and the push',async t=>{
  const {root,remote,git,head}=await teamFixture(t), initial=await head(root), native=git.git.bind(git);
  await writeFile(`${root}/A.md`,'local addition\n');
  git.git=async (args,options)=>{
    if(args[0]==='push')await runGit(remote,['update-ref','-d','refs/heads/team-dev',initial]);
    return native(args,options);
  };
  await assert.rejects(git.syncTeam());
  assert.equal((await runGit(remote,['show-ref','--heads'],{allow:[0,1]})).stdout,'');
  assert.equal((await runGit(root,['show','HEAD:A.md'])).stdout,'local addition\n');
});

test('team quick-sync respects previous origin history even after the local upstream was unset',async t=>{
  const {root,remote,git,head}=await teamFixture(t);
  await runGit(root,['remote','rename','team','origin']);
  await runGit(root,['branch','--unset-upstream']);
  const before=await head(root,'refs/remotes/origin/team-dev');
  await runGit(remote,['update-ref','-d','refs/heads/team-dev',before]);
  await assert.rejects(git.syncTeam(),/삭제/);
  assert.equal((await runGit(remote,['show-ref','--heads'],{allow:[0,1]})).stdout,'');
});

test('team quick-sync opens setup if the saved URL has a different native push destination',async t=>{
  const {dir,root,remote,git,head}=await teamFixture(t), alias='https://team.example.invalid/notes.git';
  await runGit(root,['remote','remove','team']);
  await runGit(root,['config',`url.${remote}.insteadOf`,alias]);
  await runGit(root,['config',`url.${dir}/other-team.git.pushInsteadOf`,alias]);
  const before=await head(remote,'team-dev');
  await writeFile(`${root}/A.md`,'private team edit');
  assert.equal((await git.syncTeam({remote:alias,branch:'team-dev',push:true})).phase,'setup');
  assert.equal(await head(root),before);
  assert.equal(await head(remote,'team-dev'),before);
});

test('team quick-sync sends an unconnected space to setup and preserves an ongoing Git operation',async t=>{
  const {dir,root,remote,git,head}=await teamFixture(t);
  const plain=`${dir}/plain`;
  await mkdir(plain);
  assert.equal((await new tools.GitWorkspace(plain).syncTeam()).phase,'setup');
  const before=await head(root);
  await writeFile(`${root}/.git/MERGE_HEAD`,before+'\n');
  await assert.rejects(git.syncTeam(),/진행 중인 Git/);
  assert.equal(await readFile(`${root}/.git/MERGE_HEAD`,'utf8'),before+'\n');
  assert.equal(await head(remote,'team-dev'),before);
});
