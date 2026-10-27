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
