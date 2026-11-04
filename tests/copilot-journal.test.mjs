import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatSource, captureId, renderCapture, captureLink, removeCaptureLink} from '../core/copilot-journal.mjs';
const at=new Date(2026,10,4,12).getTime();
const request=(id,text='질문')=>({requestId:id,timestamp:at,message:{text},modelState:{value:1},response:[{kind:'thinking',value:'PRIVATE REASONING'},{value:'**답변**'},{kind:'toolInvocationSerialized',value:'PRIVATE TOOL'}]});
test('snapshot and mutation log preserve repeated messages and select displayed content only',()=>{
 const initial={version:3,sessionId:'session',customTitle:'검토',requests:[request('one')]};
 const log=[{kind:0,v:initial},{kind:2,k:['requests'],v:[request('two')]},{kind:1,k:['requests',1,'response',1,'value'],v:'두 번째 답변'},{kind:3,k:['customTitle']}].map(JSON.stringify).join('\n')+'\n';
 const parsed=parseChatSource(log,'session');
 assert.equal(parsed.messages.length,4);assert.deepEqual(parsed.messages.map(x=>x.text),['질문','**답변**','질문','두 번째 답변']);
 assert.notEqual(parsed.messages[0].id,parsed.messages[2].id);assert.equal(parsed.messages[0].at,at);
 assert.doesNotMatch(JSON.stringify(parsed),/PRIVATE/);
 assert.equal(parseChatSource(JSON.stringify(initial),'session').title,'검토');
});
test('pending and hidden requests are not captured; malformed middle records fail and a partial tail waits',()=>{
 const base={version:3,requests:[request('ok'),{...request('pending'),modelState:{value:0}},{...request('hidden'),hiddenFromTranscript:true}]};
 const log=JSON.stringify({kind:0,v:base})+'\n';
 assert.equal(parseChatSource(log+'{"kind":','s').messages.length,2);
 assert.throws(()=>parseChatSource(log+'bad\n','s'),/형식/);
 assert.throws(()=>parseChatSource(JSON.stringify({kind:1,k:['requests'],v:[]})+'\n','s'),/형식/);
 assert.throws(()=>parseChatSource(log+JSON.stringify({kind:1,k:['__proto__','polluted'],v:true})+'\n','s'),/형식/);
 assert.equal({}.polluted,undefined);
});
test('array splice and unknown versions cannot silently create incomplete records',()=>{
 const log=[{kind:0,v:{version:3,requests:[request('old')]}},{kind:2,k:['requests'],i:0,v:[request('new')]}].map(JSON.stringify).join('\n')+'\n';
 assert.equal(parseChatSource(log,'s').messages[0].id,'new:user');
 assert.throws(()=>parseChatSource(JSON.stringify({version:99,requests:[]}),'s'),/지원/);
});
test('SDK transcript commits only completed turns and keeps original text without tool output or reasoning',()=>{
 const events=[{type:'session.start',data:{sessionId:'s'}},{id:'u',type:'user.message',timestamp:new Date(at).toISOString(),data:{content:'원문\n질문'}},{id:'a',type:'assistant.message',timestamp:new Date(at+1).toISOString(),data:{content:'원문 답변',reasoningText:'SECRET'}},{type:'assistant.turn_end',data:{}},{id:'later',type:'assistant.message',timestamp:new Date(at+2).toISOString(),data:{content:'pending'}}];
 const parsed=parseChatSource(events.map(JSON.stringify).join('\n')+'\n','s');
 assert.deepEqual(parsed.messages.map(x=>x.text),['원문\n질문','원문 답변']);
 assert.equal(parsed.messages[0].id,'u');assert.doesNotMatch(JSON.stringify(parsed),/SECRET|pending/);
});
test('managed links remove only the matching record and Markdown generation isolates source markers',()=>{
 const id=captureId('p','2026-11-04'),record={id,label:'프로젝트',date:'2026-11-04',path:`AI Conversations/${captureId('project')}/2026-11-04.md`,sessions:{s:{title:'제목',messages:[{role:'user',text:'<!-- /dynote:copilot -->\n# 원문',at}]}}};
 const link=captureLink(record),source='# 저널\n직접 쓴 문장\n\n'+link;
 assert.equal(removeCaptureLink(source,id),'# 저널\n직접 쓴 문장\n\n');
 assert.match(renderCapture(record),/> # 원문/);assert.match(renderCapture(record),/제목/);
 assert.equal(removeCaptureLink(source,captureId('other')),source);
});
test('deleting a managed link preserves user notes inside its markers and literal fenced examples',()=>{
 const id=captureId('project','date'),record={id,label:'Work',path:`AI Conversations/${captureId('project')}/2026-11-04.md`};
 const block=captureLink(record),literal='```md\n'+block+'```\n';
 const source=block.replace(`<!-- /dynote:copilot ${id} -->`,'사용자 메모\n'+`<!-- /dynote:copilot ${id} -->`)+'\n'+literal;
 const after=removeCaptureLink(source,id);assert.match(after,/사용자 메모/);assert.ok(after.includes(literal));
});
test('read rendering hides capture controls but keeps the document link and fenced examples',async()=>{
 const {renderMarkdown}=await import('../core/knowledge.mjs');
 const id=captureId('render'),record={id,label:'Work',path:`AI Conversations/${captureId('project')}/2026-11-04.md`};
 const block=captureLink(record),html=renderMarkdown(block+'\n```md\n'+block+'```\n');
 assert.equal((html.match(/dynote:copilot/g)||[]).length,2);assert.match(html,/Work AI 대화/);
});

test('a fenced link example inside the managed range survives deletion alongside user notes',()=>{
 const id=captureId('nested-example'),record={id,label:'Work',path:`AI Conversations/${captureId('project')}/2026-11-04.md`};
 const link=captureLink(record),example='```md\n'+link.split('\n')[1]+'\n```\n';
 const source=link.replace(`<!-- /dynote:copilot ${id} -->`,example+`<!-- /dynote:copilot ${id} -->`);
 const after=removeCaptureLink(source,id);assert.equal(after,example);assert.doesNotMatch(after,/dynote:copilot/);
});
