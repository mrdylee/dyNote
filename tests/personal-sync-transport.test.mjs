import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID,createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { PersonalSync, installDevice } from "../core/personal-sync.mjs";
import { runGit } from "../core/git-backup.mjs";

async function fixture(t) {
  const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),"dynote-device-")));
  t.after(()=>rm(temp,{force:true,recursive:true}));
  const bare=path.join(temp,"remote"); await mkdir(bare); await runGit(bare,["init","--bare","--initial-branch=main"]);
  const remote="https://example.invalid/personal.git";
  let now=1000000;
  async function pc(name,options={}) {
    const root=path.join(temp,name);await mkdir(root);
    const cfg={remote,branch:"main",authorName:"Writer",authorEmail:"writer@example.invalid",deviceName:name};
    const transport=(cwd,args,opts)=>runGit(cwd,args.map(arg=>arg===remote?bare:arg),opts);
    await transport(root,["init","--initial-branch=main"]);
    const service=new PersonalSync({root},transport,randomUUID(),{now:()=>now,...options});
    return {root,cfg,service,sync:opts=>service.sync(cfg,opts),write:(file,bytes)=>writeFile(path.join(root,file),bytes),read:file=>readFile(path.join(root,file))};
  }
  return {pc,bare,temp,advance:ms=>now+=ms};
}

test("independent working copies register, hand off Markdown and stable PDF, and idle polls add zero commits",async t=>{
  const {pc,advance,temp}=await fixture(t);
  assert.equal(...await Promise.all([installDevice(temp),installDevice(temp)]));
  const a=await pc("Cloud"),b=await pc("Local");
  await a.write("회의.md","보고서\n");await a.sync({register:true});
  const received=await b.sync({register:true});assert.equal(received.devices.length,2);
  assert.equal((await b.read("회의.md")).toString(),"보고서\n");
  await b.write("회의.md","보고서\n3시\n");await b.write("첨부.pdf","%PDF-1.4\n%%EOF\n");
  assert.equal((await b.sync()).pendingFiles.length,1);
  advance(2000);await b.sync();
  const update=await a.sync();assert.equal(update.phase,"synced");
  assert.equal((await a.read("회의.md")).toString(),"보고서\n3시\n");
  assert.deepEqual(await a.read("첨부.pdf"),await b.read("첨부.pdf"));
  const head=await a.service.disk.head();await b.sync();await a.sync();
  assert.equal(await b.service.disk.head(),head);
  assert.equal(await a.service.disk.head(),head);
  assert.equal((await a.service.store.git(["status","--porcelain"])).stdout,"");
});

test("remote receive retains a displaced open writer and publishes the late bytes as a separate version",async t=>{
  const {pc}=await fixture(t);const a=await pc("Cloud"),b=await pc("Local");
  await a.write("time.md","1시\n");await a.sync({register:true});await b.sync({register:true});await a.sync();
  const handle=await open(path.join(b.root,"time.md"),"r+");
  try {
    await a.write("time.md","2시\n");await a.sync();await b.sync();
    const restarted=new PersonalSync({root:b.root},b.service.store.run,b.service.deviceId);
    await restarted.sync(b.cfg);
    await handle.write(Buffer.from("3시\n"),0,5,0);await handle.sync();
    await restarted.sync(b.cfg);
  } finally {await handle.close();}
  await b.sync();const state=await a.sync();assert.equal(state.conflicts[0].count,2);
  assert.deepEqual(await a.read("time.md"),Buffer.from("2시\n"));
  const {versions,basis}=await a.service.versions("time.md");
  const picked=versions.find(v=>v.device==="Local");assert(picked);
  await a.service.resolve(a.cfg,"time.md",basis,picked.commit);await b.sync();
  assert.equal((await b.read("time.md")).toString(),"3시\n");
});

test("restarts at the gap between rename and publication; an outside replacement remains reachable",async t=>{
  const {pc}=await fixture(t),a=await pc("A"),b=await pc("B");
  await a.write("paper.md","base");await a.sync({register:true});await b.sync({register:true});await a.sync();
  await a.write("paper.md","remote");await a.sync();
  const old=await b.service.disk.head(),next=await a.service.disk.head();
  await b.service.store.git(["fetch","--",a.root,"main"]);
  await b.service.disk.begin("main",old,next);
  const job=await b.service.disk.job(),row=job.records.find(r=>r.name==="paper.md");
  await rename(path.join(b.root,row.name),path.join(b.service.disk.dir,row.saved));
  await b.write(row.name,"local while interrupted");
  const restarted=new PersonalSync({root:b.root},b.service.store.run,b.service.deviceId);
  await restarted.sync(b.cfg);await restarted.sync(b.cfg);
  const status=await a.sync();assert.equal(status.conflicts[0].count,2);
  const {versions}=await a.service.versions(row.name);
  assert.deepEqual(new Set(await Promise.all(versions.map(async v=>(await a.service.preview(row.name,v.commit)).toString()))),new Set(["remote","local while interrupted"]));
});

test("a stale open editor creates a recoverable side commit using its actual base",async t=>{
  const {pc}=await fixture(t),a=await pc("A"),b=await pc("B");
  await a.write("notes.md","1");await a.sync({register:true});await b.sync({register:true});await a.sync();
  await a.write("notes.md","2");await a.sync();await b.sync();
  const rev=createHash("sha256").update("1").digest("hex");
  assert((await b.service.saveDraft("notes.md","3",rev,b.cfg)).preserved);
  await b.sync();await a.sync();
  assert.equal((await a.service.versions("notes.md")).versions.length,2);
});

test("daily batch waits five minutes, rejects rewritten remotes and never publishes an excluded tracked file",async t=>{
  const {pc,bare,advance}=await fixture(t),a=await pc("A");
  await a.write("notes.md","1");await a.sync({register:true});const base=await a.service.disk.head();
  await a.write("notes.md","2");await a.sync({force:false});advance(299999);await a.sync({force:false});
  assert.equal(await a.service.disk.head(),base);advance(1);await a.sync({force:false});
  const updated=await a.service.disk.head();assert.notEqual(updated,base);
  await runGit(bare,["update-ref","refs/heads/main",base,updated]);
  await assert.rejects(a.sync(),/재작성/);assert.equal(await a.service.disk.head(),updated);
  await runGit(bare,["update-ref","refs/heads/main",updated,base]);
  await a.write(".outside","private");await a.service.store.git(["add","--",".outside"]);
  await a.service.store.git(["-c","user.name=external","-c","user.email=external@example.invalid","commit","-m","external"]);
  await assert.rejects(a.sync(),/범위 밖/);assert.equal((await runGit(bare,["rev-parse","main"])).stdout.trim(),updated);
});
