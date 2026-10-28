// Account-backed inference with a synthetic schedule only. No personal notes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CopilotController } from '../electron/copilot-controller.mjs';
import { capturePrompt, parseCapture, ideasPrompt, parseIdeas } from '../core/planner.mjs';
const directory=process.env.DYNOTE_LIVE_COPILOT_DIRECTORY;
if(!directory)throw new Error('Set DYNOTE_LIVE_COPILOT_DIRECTORY to an existing connected profile.');
const events=[];
const c=new CopilotController({directory,onEvent:e=>events.push(e),openExternal(){throw new Error('No interactive login in this probe.');}});
try{
  const status=await c.status();assert.equal(status.authenticated,true);
  const model=status.models.find(m=>m.id==='gpt-6.1-sol'&&m.vision)??status.models.find(m=>m.vision);assert.ok(model);
  const data=(await readFile('output/playwright/planner/synthetic-schedule.png')).toString('base64');
  c.send({requestId:'planner-live-capture',vaultId:'synthetic',model:model.id,mode:'chat',prompt:capturePrompt,context:{kind:'none'},history:[],image:{mimeType:'image/png',data}});
  await c.settled();
  const done=events.find(e=>e.type==='done');assert.ok(done,events.find(e=>e.type==='error')?.error??'No response');
  const items=parseCapture(done.content);const link=items.find(i=>i.target.toLowerCase().includes('link')),bms=items.find(i=>i.target.toLowerCase().includes('bms'));
  assert.ok(link);assert.equal(link.start,'2026-11-20');assert.equal(link.end,'2026-11-21');assert.ok(bms);assert.equal(bms.start,'');assert.equal(bms.end,'');assert.ok(bms.uncertainty);
  events.length=0;c.send({requestId:'planner-live-ideas',vaultId:'synthetic',model:model.id,mode:'chat',prompt:ideasPrompt('DV 전에 필요한 준비를 두 가지 대안으로 정리해 줘.'),context:{kind:'document',path:'Synthetic.md',content:JSON.stringify(link)},history:[]});
  await c.settled();const result=events.find(e=>e.type==='done');assert.ok(result,events.find(e=>e.type==='error')?.error??'No ideas');const ideas=parseIdeas(result.content);assert.ok(ideas.length>=2);assert.ok(ideas.every(i=>i.status==='candidate'));
  await mkdir('output/playwright/planner',{recursive:true});
  const report={model:model.id,liveVision:true,syntheticImageOnly:true,knownDatesCorrect:true,missingYearPreserved:true,liveBrainstorm:true,items,ideas};
  await writeFile('output/playwright/planner/live-vision.json',JSON.stringify(report,null,2));console.log({model:model.id,knownDatesCorrect:true,missingYearPreserved:true,liveBrainstorm:true});
}finally{await c.close();}
