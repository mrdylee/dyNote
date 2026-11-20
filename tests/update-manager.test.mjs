import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {releaseInformation} from '../core/update-information.mjs';
const tools=await import('../core/update-manager.mjs').catch(()=>({}));
const bytes=Buffer.from('verified archive'),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const asset=(name,extra={})=>({name,browser_download_url:`https://github.com/mrdylee/dyNote/releases/download/v2.0.0/${name}`,size:bytes.length,digest,...extra});
const release=(tag,name)=>({tag_name:tag,assets:[asset(name)]});
const target={platform:'darwin',arch:'arm64'};
test('update selection skips newer releases with incompatible assets',()=>{
 const result=releaseInformation([release('v3.0.0','Dynote-3.0.0-windows-x64.zip'),release('v2.0.0','Dynote-2.0.0-mac-arm64.zip')],'1.0.0',false,target);
 assert.equal(result.latest.tag,'v2.0.0');assert.equal(result.latest.assets[0].digest,digest);
 assert.equal(releaseInformation([release('v3.0.0','Dynote-3.0.0-mac-x64.zip')],'1.0.0',false,target).latest,null);
});
test('actual macos release naming and prerelease flag select the supported Mac archive',()=>{
 const feed=[{...release('v0.11.0','Dynote-0.11.0-windows-x64.zip'),prerelease:true},{...release('v0.10.1','Dynote-0.10.1-macos-arm64.zip'),prerelease:true}];
 assert.equal(releaseInformation(feed,'0.9.0',true,target).latest?.tag,'v0.10.1');
 assert.equal(releaseInformation(feed,'0.9.0',false,target).latest,null);
});
async function fixture(t,options={}){
 assert.equal(typeof tools.UpdateManager,'function');
 const directory=await mkdtemp(`${tmpdir()}/dynote-update-`);t.after(()=>rm(directory,{recursive:true,force:true}));
 const manager=new tools.UpdateManager({directory,current:'1.0.0',...target,fetcher:async()=>new Response(bytes),check:async()=>releaseInformation([release('v2.0.0','Dynote-2.0.0-mac-arm64.zip')],'1.0.0',false,target),...options});
 await manager.init();return {manager,directory};
}
test('weekly scheduler persists success, bypasses interval manually and deduplicates requests',async t=>{
 let now=1000000000,calls=0;
 const {manager}=await fixture(t,{now:()=>now,check:async()=>{calls++;return {available:false,latest:null};}});
 await Promise.all([manager.check(),manager.check()]);assert.equal(calls,1);
 now+=7*86400000-1;await manager.check();assert.equal(calls,1);
 now++;await manager.check();assert.equal(calls,2);
 await manager.configure({enabled:false});await manager.check();assert.equal(calls,2);
 await manager.check(true);assert.equal(calls,3);
});
test('failed checks retry after one hour without recording successful check',async t=>{
 let now=1000000000,calls=0;
 const {manager}=await fixture(t,{now:()=>now,check:async()=>{calls++;throw new Error('offline');}});
 await manager.check();assert.equal(manager.state.lastCheckedAt,0);assert.equal(manager.state.phase,'error');
 now+=3599999;await manager.check();assert.equal(calls,1);now++;await manager.check();assert.equal(calls,2);
});
test('download verifies hash, caches readiness and settings survive restart',async t=>{
 const {manager,directory}=await fixture(t);await manager.check(true);
 assert.equal(manager.state.phase,'ready');assert.deepEqual(await readFile(await manager.readyPath()),bytes);
 await manager.configure({enabled:false,backgroundDownload:false});
 const restored=new tools.UpdateManager({directory,current:'1.0.0',...target});await restored.init();
 assert.equal(restored.state.preferences.enabled,false);assert.equal(restored.state.phase,'ready');
});
test('corrupt or truncated downloads never announce readiness and partial files are removed',async t=>{
 const {manager,directory}=await fixture(t,{fetcher:async()=>new Response('bad')});await manager.check(true);
 assert.equal(manager.state.phase,'error');await assert.rejects(manager.readyPath(),/완료/);
 assert.equal((await readdir(directory)).some(n=>n.endsWith('.part')),false);
});
test('missing trusted digest requires official manual download',async t=>{
 const info=releaseInformation([{tag_name:'v2.0.0',assets:[asset('Dynote-2.0.0-mac-arm64.zip',{digest:null})]}],'1.0.0',false,target);
 const {manager}=await fixture(t,{check:async()=>info});await manager.check(true);
 assert.equal(manager.state.phase,'available');assert.match(manager.state.message,/검증/);
});
test('same-size hash corruption is rejected and cached files are reverified after restart',async t=>{
 const {manager,directory}=await fixture(t);await manager.check(true);const file=await manager.readyPath();
 await writeFile(file,Buffer.alloc(bytes.length,65));
 await assert.rejects(manager.readyPath(),/검증/);
 const restored=new tools.UpdateManager({directory,current:'1.0.0',...target});await restored.init();
 assert.notEqual(restored.state.phase,'ready');assert.equal(restored.state.lastCheckedAt,0);
});
test('failed manual check never leaves stale successful result visible',async t=>{
 let failed=false;const {manager}=await fixture(t,{check:async()=>{if(failed)throw new Error('offline');return {available:false,latest:null};}});
 await manager.check(true);failed=true;await manager.check(true);assert.equal(manager.state.result,null);
});
test('settings changes and a scheduled check cannot race persistence',async t=>{
 let release;const {manager}=await fixture(t,{check:()=>new Promise(resolve=>{release=resolve;})});
 const checking=manager.check(true);await assert.rejects(manager.configure({enabled:false}),/끝난/);
 release({available:false,latest:null});await checking;
});
test('a check waits for in-flight settings persistence instead of racing its temporary file',async t=>{
 let calls=0;const {manager}=await fixture(t,{check:async()=>{calls++;return {available:false,latest:null};}});
 const configuring=manager.configure({backgroundDownload:false});
 await Promise.all([configuring,manager.check()]);assert.equal(calls,0);
 await manager.check();assert.equal(calls,1);
});
test('selected download folder stores verified archives and survives restart',async t=>{
 const {manager,directory}=await fixture(t);
 const downloads=path.join(directory,'Selected downloads');await mkdir(downloads);
 await manager.configure({downloadDirectory:downloads});await manager.check(true);
 const file=await manager.readyPath();
 assert.equal(path.dirname(file),downloads);assert.deepEqual(await readFile(file),bytes);
 assert.equal(manager.state.downloadedPath,file);
 assert.equal((await readdir(directory)).some(name=>name.endsWith('.zip')),false);
 const restored=new tools.UpdateManager({directory,current:'1.0.0',...target});await restored.init();
 assert.equal(restored.state.preferences.downloadDirectory,downloads);
 assert.equal(restored.state.downloadedPath,file);assert.equal(await restored.readyPath(),file);
});
test('legacy downloads remain discoverable when the default or future download folder changes',async t=>{
 const {manager,directory}=await fixture(t);await manager.check(true);
 const oldFile=await manager.readyPath(),settings=path.join(directory,'settings.json');
 const saved=JSON.parse(await readFile(settings,'utf8'));delete saved.preferences.downloadDirectory;delete saved.cached.directory;
 await writeFile(settings,JSON.stringify(saved));
 const downloads=path.join(directory,'Downloads'),next=path.join(directory,'Next');await mkdir(downloads);await mkdir(next);
 const restored=new tools.UpdateManager({directory,downloadDirectory:downloads,current:'1.0.0',...target});await restored.init();
 assert.equal(restored.state.preferences.downloadDirectory,downloads);
 assert.equal(restored.state.downloadedPath,oldFile);assert.equal(await restored.readyPath(),oldFile);
 await restored.configure({downloadDirectory:next});assert.equal(await restored.readyPath(),oldFile);
 restored.lookup=manager.lookup;restored.fetcher=manager.fetcher;await restored.check(true);
 assert.equal(path.dirname(await restored.readyPath()),next);assert.deepEqual(await readFile(oldFile),bytes);
});
test('invalid download folders leave the existing preferences and archive intact',async t=>{
 const {manager,directory}=await fixture(t);await manager.check(true);
 const file=await manager.readyPath(),before=await readFile(path.join(directory,'settings.json'),'utf8');
 await assert.rejects(manager.configure({downloadDirectory:'relative/folder'}),/폴더/);
 await assert.rejects(manager.configure({downloadDirectory:file}),/폴더/);
 assert.equal(await readFile(path.join(directory,'settings.json'),'utf8'),before);
 assert.equal(await manager.readyPath(),file);
});
test('simultaneous downloads into one folder publish only their own complete archives',async t=>{
 let controllerA,controllerB,progressA,progressB;
 const waitingA=new Promise(resolve=>{progressA=resolve;}),waitingB=new Promise(resolve=>{progressB=resolve;});
 const {manager:first,directory}=await fixture(t,{
  fetcher:async()=>new Response(new ReadableStream({start(controller){controllerA=controller;controller.enqueue(bytes.subarray(0,bytes.length/2));}})),
  onChange:state=>{if(state.phase==='downloading'&&state.progress===50)progressA();},
 });
 const shared=path.join(directory,'Shared');await mkdir(shared);await first.configure({downloadDirectory:shared});
 const {manager:second}=await fixture(t,{
  downloadDirectory:shared,
  fetcher:async()=>new Response(new ReadableStream({start(controller){controllerB=controller;controller.enqueue(bytes.subarray(0,bytes.length/2));}})),
  onChange:state=>{if(state.phase==='downloading'&&state.progress===50)progressB();},
 });
 const checkingA=first.check(true);await waitingA;
 const checkingB=second.check(true);await waitingB;
 controllerA.enqueue(bytes.subarray(bytes.length/2));controllerA.close();await checkingA;
 const firstState=first.state.phase,firstBytes=first.state.downloadedPath?await readFile(first.state.downloadedPath):null;
 controllerB.enqueue(bytes.subarray(bytes.length/2));controllerB.close();await checkingB;
 assert.equal(firstState,'ready');assert.deepEqual(firstBytes,bytes);
 assert.equal(second.state.phase,'ready');assert.deepEqual(await readFile(await first.readyPath()),bytes);
 assert.deepEqual(await readFile(await second.readyPath()),bytes);
 assert.equal((await readdir(shared)).some(name=>name.endsWith('.part')),false);
});
test('a failed download cannot remove a concurrent download temporary file',async t=>{
 let controllerA,progressA;
 const waitingA=new Promise(resolve=>{progressA=resolve;});
 const {manager:first,directory}=await fixture(t,{
  fetcher:async()=>new Response(new ReadableStream({start(controller){controllerA=controller;controller.enqueue(bytes.subarray(0,bytes.length/2));}})),
  onChange:state=>{if(state.phase==='downloading'&&state.progress===50)progressA();},
 });
 const shared=path.join(directory,'Shared');await mkdir(shared);await first.configure({downloadDirectory:shared});
 const {manager:second}=await fixture(t,{downloadDirectory:shared,fetcher:async()=>new Response('bad')});
 const checking=first.check(true);await waitingA;
 await second.check(true);assert.equal(second.state.phase,'error');
 controllerA.enqueue(bytes.subarray(bytes.length/2));controllerA.close();await checking;
 assert.equal(first.state.phase,'ready');assert.deepEqual(await readFile(await first.readyPath()),bytes);
 assert.equal((await readdir(shared)).some(name=>name.endsWith('.part')),false);
});
test('an offline check keeps the previous verified archive available and rechecks it before opening',async t=>{
 const {manager,directory}=await fixture(t);await manager.check(true);const file=await manager.readyPath();
 manager.lookup=async()=>{throw new Error('offline');};await manager.check(true);
 assert.equal(manager.state.phase,'error');assert.equal(manager.state.result,null);
 assert.equal(manager.state.downloadedPath,file);assert.equal(await manager.readyPath(),file);
 const restored=new tools.UpdateManager({directory,current:'1.0.0',...target});await restored.init();
 assert.equal(restored.state.downloadedPath,file);assert.equal(await restored.readyPath(),file);
 await writeFile(file,Buffer.alloc(bytes.length,65));await assert.rejects(manager.readyPath(),/검증/);
});
test('a failed newer download preserves the previously verified installer location',async t=>{
 const {manager}=await fixture(t);await manager.check(true);const file=await manager.readyPath();
 manager.lookup=async()=>releaseInformation([release('v3.0.0','Dynote-3.0.0-mac-arm64.zip')],'1.0.0',false,target);
 manager.fetcher=async()=>new Response('bad');await manager.check(true);
 assert.equal(manager.state.phase,'error');assert.equal(manager.state.downloadedPath,file);
 assert.equal(await manager.readyPath(),file);assert.deepEqual(await readFile(file),bytes);
});

test('Windows update selection keeps Setup and ZIP on their own distribution paths', () => {
 const zip = 'Dynote-2.0.0-windows-x64.zip';
 const setup = 'Dynote-2.0.0-windows-x64-Setup.exe';
 const windows = { platform: 'win32', arch: 'x64' };
 const feed = [
  release('v3.0.0', 'Dynote-3.0.0-windows-arm64-Setup.exe'),
  { tag_name: 'v2.0.0', assets: [asset(zip), asset(setup)] },
 ];
 assert.deepEqual(releaseInformation(feed, '1.0.0', false, windows).latest.assets.map(a => a.name), [zip]);
 assert.deepEqual(releaseInformation(feed, '1.0.0', false, { ...windows, installed: true }).latest.assets.map(a => a.name), [setup]);
});

test('installed Windows app verifies its Setup download and restores it on restart', async t => {
 const name = 'Dynote-2.0.0-windows-x64-Setup.exe';
 const windows = { platform: 'win32', arch: 'x64', installed: true };
 const feed = [release('v2.0.0', name)];
 const { manager, directory } = await fixture(t, {
  ...windows,
  check: async () => releaseInformation(feed, '1.0.0', false, windows),
 });
 await manager.check(true);
 assert.equal(manager.state.phase, 'ready');
 const file = await manager.readyPath();
 assert.ok(file.endsWith(name));
 assert.deepEqual(await readFile(file), bytes);
 const restored = new tools.UpdateManager({ directory, current: '1.0.0', ...windows });
 await restored.init();
 assert.equal(await restored.readyPath(), file);
 await writeFile(file, Buffer.alloc(bytes.length));
 await assert.rejects(restored.readyPath(), /검증/);
});

test('automatic install is supported only for the installed Windows x64 distribution', async t => {
 const {manager}=await fixture(t);
 assert.equal(manager.state.installSupported,false);
 await assert.rejects(manager.beginInstall(async()=>({directory:'unused'})),/설치형/);
});

test('installation revalidates bytes, serializes changes and remembers an unsuccessful attempt', async t => {
 const windows={platform:'win32',arch:'x64',installed:true};
 const {manager,directory}=await fixture(t,{...windows,check:async()=>releaseInformation([release('v2.0.0','Dynote-2.0.0-windows-x64-Setup.exe')],'1.0.0',false,windows)});
 assert.equal(manager.state.installSupported,true);
 assert.equal(manager.state.preferences.autoInstall,true);
 await manager.check(true);
 let releaseStage;
 const installing=manager.beginInstall(async args=>{assert.equal(args.tag,'v2.0.0');await new Promise(resolve=>{releaseStage=resolve;});return {directory:path.join(directory,'install','test')};});
 await new Promise(resolve=>setTimeout(resolve,20));
 await assert.rejects(manager.configure({autoInstall:false}),/끝난/);
 releaseStage();await installing;
 assert.equal(manager.state.phase,'installing');
 await manager.cancelInstall('저장을 완료하지 못했습니다.');
 const restored=new tools.UpdateManager({directory,current:'1.0.0',...windows});await restored.init();
 assert.equal(restored.state.phase,'ready');assert.equal(restored.state.installation.tag,'v2.0.0');
 assert.match(restored.state.message,/저장/);
 await restored.configure({autoInstall:false});
 const disabled=new tools.UpdateManager({directory,current:'1.0.0',...windows});await disabled.init();
 assert.equal(disabled.state.preferences.autoInstall,false);
 await writeFile(await restored.readyPath(),Buffer.alloc(bytes.length));
 let staged=false;await assert.rejects(restored.beginInstall(async()=>{staged=true;}),/검증/);
 assert.equal(staged,false);
});

test('completed upgrade removes staged installer and Windows BOM errors are readable on a failed upgrade', async t => {
 const windows={platform:'win32',arch:'x64',installed:true};
 const {manager,directory}=await fixture(t,{...windows,check:async()=>releaseInformation([release('v2.0.0','Dynote-2.0.0-windows-x64-Setup.exe')],'1.0.0',false,windows)});
 await manager.check(true);
 const job=path.join(directory,'install','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');await mkdir(job,{recursive:true});
 await manager.beginInstall(async()=>({directory:job}));
 await writeFile(path.join(job,'result.json'),'\uFEFF'+JSON.stringify({error:'Setup exit code: 5'}));
 const failed=new tools.UpdateManager({directory,current:'1.0.0',...windows});await failed.init();
 assert.match(failed.state.message,/exit code: 5/);
 const upgraded=new tools.UpdateManager({directory,current:'2.0.0',...windows});await upgraded.init();
 assert.equal(upgraded.state.installation,null);assert.equal(upgraded.state.downloadedPath,null);
 await assert.rejects(readdir(job),{code:'ENOENT'});
});
