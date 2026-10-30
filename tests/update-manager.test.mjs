import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
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
