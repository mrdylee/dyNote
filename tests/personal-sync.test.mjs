import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PersonalSyncStore, devicePath, deviceRecord, conflictFolder, assertSyncEntry,blobLimit } from "../core/personal-sync-store.mjs";
import { PersonalSync } from "../core/personal-sync.mjs";
import { mergeCaptureBlocks } from "../core/personal-sync-text.mjs";
import { integrate, chooseVersion, checkTreeChanges,normalizePublished } from "../core/personal-sync-merge.mjs";

async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),"dynote-sync-store-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,"vault"); await mkdir(root);
  const store=new PersonalSyncStore(root);
  await store.git(["init","--initial-branch=main"]);
  const config={authorName:"Note Writer",authorEmail:"test@example.invalid"};
  const cloud=deviceRecord(randomUUID(),"Cloud PC"), local=deviceRecord(randomUUID(),"Local PC"), late=deviceRecord(randomUUID(),"Laptop");
  async function checkpoint(parent, device, files) {
    const updates=new Map([[devicePath(device.id),await store.storeRecord(device)]]);
    for(const [name,content] of Object.entries(files)) updates.set(name,content===null?null:await store.storeBytes(Buffer.from(content)));
    const tree=await store.writeTree(parent,updates);
    return store.commitTree(tree,parent?[parent]:[],"노트 저장",device,config);
  }
  return {root,store,config,cloud,local,late,checkpoint};
}

test("personal merge preserves all variants, includes independent notes, and protects selection when a later PC edits the published value",async t=>{
  const {root,store,config,cloud,local,late,checkpoint}=await fixture(t);
  const file="회의록.md";
  const base=await checkpoint(null,cloud,{[file]:"1시\n","자료.zip":Buffer.from([0,1])});
  const a=await checkpoint(base,cloud,{[file]:"2시\n","자료.zip":Buffer.from([0,2])});
  const b=await checkpoint(base,local,{[file]:"3시\n","자료.zip":Buffer.from([0,3]),"독립.md":"전달"});
  await writeFile(path.join(root,"unrelated.md"),"user draft");
  const merged=await integrate(store,a,b,local,config), files=await store.tree(merged);
  const state=await store.metadata(files);
  assert.deepEqual(state.groups.get(file).pending,[a,b].sort());
  assert.equal((await store.blob(files.get(file).oid)).toString(),"2시\n");
  assert.equal((await store.blob(files.get("독립.md").oid)).toString(),"전달");
  assert.equal(state.groups.get("자료.zip").pending.length,2);
  const c=await checkpoint(a,late,{[file]:"4시\n"});
  const withLate=await integrate(store,merged,c,late,config);
  let latest=await store.tree(withLate);
  assert.equal((await store.blob(latest.get(file).oid)).toString(),"2시\n");
  const all=(await store.metadata(latest)).groups.get(file);
  assert.deepEqual(all.pending,[a,b,c].sort());
  assert.equal(all.versions.get(b).device,"Local PC");
  await assert.rejects(chooseVersion(store,withLate,file,state.groups.get(file).pending,b,local,config),/새 버전/);
  const choice=await chooseVersion(store,withLate,file,all.pending,b,local,config);
  latest=await store.tree(choice);
  assert.equal((await store.blob(latest.get(file).oid)).toString(),"3시\n");
  assert.deepEqual((await store.metadata(latest)).groups.get(file).pending,[]);
  assert(latest.has(conflictFolder(file)+all.versions.get(c).blob+".blob"));
  assert.equal(await integrate(store,choice,c,late,config),choice);
  assert.equal((await store.git(["ls-files","--cached"])).stdout,"");
});

test("personal sync path validation separates ZIP and built-in metadata from unrelated files",async t=>{
  const {store}=await fixture(t);
  const blob=await store.storeBytes(Buffer.from("bytes"));
  assert.deepEqual([...checkTreeChanges(new Map(),new Map([["한글.Zip",blob]]))],["한글.Zip"]);
  for(const name of ["~$잠김.zip",".dynote-sync/private.txt","../private.md",".git/config",".secrets"])
    assert.throws(()=>checkTreeChanges(new Map(),new Map([[name,blob]])));
  assert.throws(()=>checkTreeChanges(new Map(),new Map([["a/b.md",blob],["A/c.md",blob]])),/경로/);
});

test("each conflicting Markdown hunk can be chosen independently while clean edits are retained",async t=>{
  const {store,config,cloud,local,checkpoint}=await fixture(t);
  const path="meeting.md",base=await checkpoint(null,cloud,{[path]:"first\nx\na\nb\nc\ny\nlast\n"});
  const a=await checkpoint(base,cloud,{[path]:"CLOUD INTRO\nx2\na\nb\nc\ny2\nlast\n"});
  const b=await checkpoint(base,local,{[path]:"first\nx3\na\nb\nc\ny3\nLOCAL END\n"});
  const head=await integrate(store,a,b,local,config),files=await store.tree(head);
  const group=(await store.metadata(files)).groups.get(path);
  const final=await chooseVersion(store,head,path,group.pending,b,local,config,{hunks:[a,b]});
  const blob=(await store.tree(final)).get(path);
  assert.equal((await store.blob(blob.oid)).toString(),"CLOUD INTRO\nx2\na\nb\nc\ny3\nLOCAL END\n");
});

test("simultaneous decisions survive even if one chooses the already published contents",async t=>{
  const {store,config,cloud,local,checkpoint}=await fixture(t);
  const name="보고.md",base=await checkpoint(null,cloud,{[name]:"1시"});
  const a=await checkpoint(base,cloud,{[name]:"2시"}),b=await checkpoint(base,local,{[name]:"3시"});
  const head=await integrate(store,a,b,local,config), basis=[a,b].sort();
  const ca=await chooseVersion(store,head,name,basis,a,cloud,config);
  const cb=await chooseVersion(store,head,name,basis,b,local,config);
  const merged=await integrate(store,ca,cb,cloud,config),state=await store.metadata(await store.tree(merged));
  assert.deepEqual(state.groups.get(name).pending,[ca,cb].sort());
  const chosen=await chooseVersion(store,merged,name,[ca,cb],ca,local,config);
  assert.equal((await store.blob((await store.tree(chosen)).get(name).oid)).toString(),"2시");
});

test("a new clone reconstructs edits published by a plain Git client while review was open",async t=>{
  const {store,config,cloud,local,checkpoint}=await fixture(t);
  const name="meeting.md",base=await checkpoint(null,cloud,{[name]:"1"});
  const a=await checkpoint(base,cloud,{[name]:"2"}),b=await checkpoint(base,local,{[name]:"3"});
  const review=await integrate(store,a,b,local,config);
  const four=await checkpoint(review,cloud,{[name]:"4"}), five=await checkpoint(four,cloud,{[name]:"5"});
  const normalized=await normalizePublished(store,five,local,config);
  const files=await store.tree(normalized),state=await store.metadata(files);
  assert.deepEqual(state.groups.get(name).pending,[a,b,four,five].sort());
  assert.equal((await store.blob(files.get(name).oid)).toString(),"2");
  assert.equal(await normalizePublished(store,normalized,local,config),normalized);
});

test("file, metadata and review-page limits are independent",async t=>{
  const {root,store,local,config}=await fixture(t);
  const device=await store.storeRecord(local);
  assert.doesNotThrow(()=>assertSyncEntry("limit.pdf",{...device,size:blobLimit}));
  assert.throws(()=>assertSyncEntry("limit.pdf",{...device,size:blobLimit+1}),/한도/);
  assert.throws(()=>assertSyncEntry(devicePath(local.id),{...device,size:65537}),/한도/);
  const name="time.md",entries=new Map(),file=await store.storeBytes(Buffer.from("2"));
  entries.set(name,file);entries.set(conflictFolder(name)+file.oid+".blob",file);
  for(let n=0;n<51;n++) {
    const commit=n.toString(16).padStart(40,"0");
    entries.set(conflictFolder(name)+commit+".json",await store.storeRecord({path:name,commit,blob:file.oid,author:"Writer",device:"PC",id:local.id,time:new Date(n*1000).toISOString()}));
  }
  const head=await store.commitTree(await store.writeTree(null,entries),[],"pages",local,config);
  await store.git(["update-ref","refs/heads/main",head]);
  const service=new PersonalSync({root},store.run,local.id);await service.init();
  const first=await service.versions(name),second=await service.versions(name,50);
  assert.equal(first.versions.length,50);assert.equal(second.versions.length,1);assert.equal(first.basis.length,51);
});

test("Journal union keeps original blocks and manual text in place and sorts only new links",()=>{
  const block=i=>"<!-- dynote:copilot "+i+" -->\n- [[Copilot Note/"+i+"/"+i+".md|chat]]\n<!-- /dynote:copilot "+i+" -->\n";
  const id=i=>i.repeat(20),base="intro\n\n"+block(id("a"))+"\nmanual after existing block\n";
  const left=base+"\n"+block(id("c")),right=base+"\n"+block(id("b"));
  const merged=mergeCaptureBlocks(base,left,right);
  assert(merged.startsWith(base));assert(merged.indexOf(id("b"))<merged.indexOf(id("c")));
  assert.equal(mergeCaptureBlocks(base,right,left),merged);
});

