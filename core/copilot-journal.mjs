import {createHash} from 'node:crypto';
export const captureId=(...parts)=>createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,20);
const problem=()=>new Error('지원하지 않거나 저장 중인 Copilot 대화 기록 형식입니다.');
const text=value=>typeof value==='string'?value:'';
const timestamp=value=>typeof value==='number'?value:Date.parse(value);
const title=value=>text(value).replace(/[\r\n\x00-\x1f]/g,' ').trim().slice(0,120);
function rows(source){
 const lines=source.replace(/^\uFEFF/,'').split('\n'),result=[];
 for(let i=0;i<lines.length;i++){
  if(!lines[i].trim())continue;
  try{result.push(JSON.parse(lines[i]));}catch{if(i===lines.length-1&&!source.endsWith('\n'))break;throw problem();}
 }
 return result;
}
function snapshot(entries){
 let state;
 for(const entry of entries){
  if(entry.kind===0){state=entry.v;continue;}
  if(!state||![1,2,3].includes(entry.kind)||!Array.isArray(entry.k)||!entry.k.length||entry.k.some(k=>!['string','number'].includes(typeof k)||['__proto__','prototype','constructor'].includes(k)))throw problem();
  let parent=state;
  for(const key of entry.k.slice(0,-1)){if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,key))throw problem();parent=parent[key];}
  if(!parent||typeof parent!=='object')throw problem();
  const key=entry.k.at(-1);
  if(entry.kind===1)parent[key]=entry.v;
  if(entry.kind===3)delete parent[key];
  if(entry.kind===2){
   const array=parent[key]??[];
   if(!Array.isArray(array)||(entry.v!==undefined&&!Array.isArray(entry.v)))throw problem();
   if(entry.i!==undefined){if(!Number.isInteger(entry.i)||entry.i<0||entry.i>array.length)throw problem();array.length=entry.i;}
   for(const value of entry.v??[])array.push(value);
   parent[key]=array;
  }
 }
 return state;
}
function fromSnapshot(value,sessionId){
 if(!value||!Array.isArray(value.requests)||![1,2,3].includes(value.version))throw new Error('지원하지 않는 Copilot 대화 버전입니다.');
 const messages=[];
 for(const [index,request] of value.requests.entries()){
  if(request.hiddenFromTranscript||request.isHidden||request.isSystemInitiated||request.shouldBeRemovedOnSend)continue;
  if(request.modelState?request.modelState.value!==1:!request.result||request.isCanceled)continue;
  const at=timestamp(request.timestamp??value.creationDate),id=text(request.requestId)||String(index);
  if(!Number.isFinite(at))continue;
  const question=request.requestHiddenFromTranscript?'':text(request.message?.text??request.message);
  const answer=(Array.isArray(request.response)?request.response:[]).map(part=>{
   if(typeof part==='string')return part;
   if(part?.kind==='markdownContent')return text(part.content?.value??part.content);
   return !part?.kind?text(part?.value):'';
  }).join('');
  if(question)messages.push({id:`${id}:user`,role:'user',text:question,at});
  if(answer)messages.push({id:`${id}:assistant`,role:'assistant',text:answer,at});
 }
 return {sessionId:text(value.sessionId)||sessionId,title:title(value.customTitle)||title(messages.find(m=>m.role==='user')?.text),messages};
}
export function parseChatSource(source,sessionId){
 let value;
 try{value=JSON.parse(source.replace(/^\uFEFF/,''));}catch{/* JSONL sources are reconstructed below. */}
 if(value?.requests)return fromSnapshot(value,sessionId);
 const entries=rows(source);
 if(entries[0]?.kind!==undefined)return fromSnapshot(snapshot(entries),sessionId);
 const messages=[],seen=new Set();let pending=[],name='',known=false;
 for(const [index,event] of entries.entries()){
  if(event.type==='session.start'){known=true;sessionId=text(event.data?.sessionId)||sessionId;}
  if(event.type==='user.message'||event.type==='assistant.message'){
   known=true;const data=event.data??{},content=text(data.content),at=timestamp(event.timestamp);
   if(!content||!Number.isFinite(at)||data.hiddenFromTranscript||data.isSystemInitiated)continue;
   const id=text(event.id)||text(data.messageId)||`${index}`;
   if(seen.has(id))continue;seen.add(id);
   const role=event.type==='user.message'?'user':'assistant';
   if(role==='user'&&!name)name=title(content);
   pending.push({id,role,text:content,at});
  }
  if(event.type==='assistant.turn_end'){messages.push(...pending);pending=[];}
 }
 if(!known&&entries.length)throw problem();
 return {sessionId,title:name,messages};
}
const heading=value=>title(value).replace(/[#[\]|<>`]/g,'');
export const captureSessionHeading=value=>heading(value)||'대화';
const quote=value=>value.split('\n').map(line=>`> ${line}`).join('\n');
export function renderCapture(record){
 const parts=[`# ${heading(record.label)} · AI 대화 · ${record.date}`,'','VS Code Copilot에서 가져온 대화 기록입니다.',''];
 for(const session of Object.values(record.sessions)){
  parts.push(`## ${captureSessionHeading(session.title)}`,'');
  for(const message of session.messages)parts.push(`### ${message.role==='user'?'질문':'답변'}`,'',quote(message.text),'');
 }
 return parts.join('\n');
}
export const captureLink=record=>`<!-- dynote:copilot ${record.id} -->\n- [[${record.path}|${heading(record.label)} AI 대화]]\n<!-- /dynote:copilot ${record.id} -->\n`;
export {removeCaptureLink} from './copilot-journal-links.mjs';
