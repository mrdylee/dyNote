import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {UpdateManager} from '../core/update-manager.mjs';

test('Git folder updates use the default branch, pin the selected commit, and restore verified LFS files', {
  skip:spawnSync('git',['lfs','version']).status !== 0 && 'requires Git LFS',
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(),'dynote-update-fixture-'));
  t.after(() => rm(root,{recursive:true, force:true, maxRetries:3}));
  const repo = path.join(root,'shared.git'), work = path.join(root,'work');
  const git = (cwd,...args) => execFileSync('git',args,{cwd,stdio:'pipe',encoding:'utf8'}).trim();
  git(root,'init','--bare','--initial-branch=company',repo);
  await mkdir(work);
  git(work,'init','--initial-branch=company');
  git(work,'lfs','install','--local');
  git(work,'remote','add','origin',pathToFileURL(repo).href);
  const folder = path.join(work,'dynote');
  await mkdir(folder);
  await writeFile(path.join(folder,'.gitattributes'),'*.exe filter=lfs diff=lfs merge=lfs -text\n');
  const name = 'Dynote-2.0.0-windows-x64-Setup.exe', bytes = Buffer.from('verified installer fixture');
  await writeFile(path.join(folder,name),bytes);
  await writeFile(path.join(folder,'latest.json'),JSON.stringify({version:'2.0.0',name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
  const publish = () => {
    git(work,'add','dynote');
    git(work,'-c','user.name=Fixture','-c','user.email=test@example.test','commit','-m','fixture');
    git(work,'push','origin','HEAD');
  };
  publish();
  const source = 'https://git.example.test/org/shared.git', config = path.join(root,'gitconfig');
  git(root,'config','--file',config,'url.'+pathToFileURL(repo).href+'.insteadOf',source);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => { if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous; });
  const options = {directory:path.join(root,'updates'),current:'1.0.0',installed:true,arch:'x64',platform:'win32',
    fetcher:() => { throw new Error('unexpected HTTP feed'); }};
  const manager = new UpdateManager(options);
  await manager.init();
  await manager.configure({source:'internal',internalFeedUrl:source,backgroundDownload:false});
  await manager.check();
  assert.equal(manager.state.phase,'available',manager.state.message);
  await rm(path.join(folder,name));
  publish();
  await manager.download();
  assert.equal(manager.state.phase,'ready',manager.state.message);
  assert.deepEqual(await readFile(await manager.readyPath()),bytes);
  const restored = new UpdateManager(options);
  await restored.init();
  assert.equal(await restored.readyPath(),await manager.readyPath());
});
