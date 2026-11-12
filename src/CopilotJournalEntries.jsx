import {Download,Settings,Trash2,Undo2} from 'lucide-react';
export function CopilotJournalToolbar({state,importNotice,disabled,onImport,onHistory,onSettings,onRestore}){
 return <div className="capture-toolbar" aria-label="저널 자동기록 작업">
  <span className={state?.error?'capture-error':''} role="status" title={state?.error||undefined}>{state?.error||(state?.enabled?'Copilot 자동 기록 켜짐':'Copilot 대화 기록')}</span>
  {importNotice&&<span role="status">{importNotice}</span>}
  <button disabled={disabled} title="가져올 Copilot 대화 세션을 선택합니다." onClick={onImport}><Download size={14}/>가져오기</button>
  {onHistory&&<button disabled={disabled} onClick={onHistory}>프로젝트별 기록</button>}
  <button disabled={disabled} aria-label="저널 자동기록 설정" onClick={onSettings}><Settings size={14}/></button>
  {state?.trashId&&<button disabled={disabled} onClick={onRestore}><Undo2 size={14}/>삭제 되돌리기</button>}
 </div>;
}
const activityTime=new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const newestFirst=(a,b)=>b.lastActivity-a.lastActivity;
export function CopilotJournalHistory({state,onOpen}){
 const projectPaths=new Map(state?.projects?.map(project=>[project.key,project.path]));
 const groups=new Map();
 for(const {projectKey,label,date,sessions} of state?.records??[]){
  const group=groups.get(projectKey)??{label,sessions:new Map()};
  groups.set(projectKey,group);
  for(const session of sessions){
   const parts=group.sessions.get(session.id)??[];
   parts.push({...session,date});
   group.sessions.set(session.id,parts);
  }
 }
 if(!groups.size)return <p>아직 가져온 대화가 없습니다.</p>;
 return [...groups].sort(([,a],[,b])=>a.label.localeCompare(b.label,'ko')).map(([key,project])=>{
  const sessions=[...project.sessions.values()]
   .map(parts=>parts.sort(newestFirst))
   .sort(([a],[b])=>newestFirst(a,b));
  return <details className="capture-history-project" key={key}>
   <summary><strong>{project.label}</strong> <small>{sessions.length}건</small>
    <small className="capture-history-path">{projectPaths.get(key)??`AI Conversations/${key}`}</small>
   </summary>
   <ul>{sessions.map(([latest,...earlier])=><li key={latest.id}>
    <button className="capture-history-session" onClick={()=>onOpen(latest)}>
     <span>{latest.title}</span>
     <time dateTime={new Date(latest.lastActivity).toISOString()}>{latest.date} {activityTime.format(latest.lastActivity)}</time>
    </button>
    {earlier.length>0&&<details className="capture-history-dates"><summary>이전 날짜 기록</summary>
     {earlier.map(part=><button key={part.date} onClick={()=>onOpen(part)}>{part.date}</button>)}
    </details>}
   </li>)}</ul>
  </details>;
 });
}
export default function CopilotJournalEntries({records=[],disabled,onOpen,onTrash}){
 if(!records.length)return null;
 return <section className="capture-records" aria-label="AI 자동 기록">{records.map(record=>{
  const path=record.sessions[0].path,shared=record.sessions.every(session=>session.path===path);
  const title=<>{record.label} AI 대화 <small>{record.sessions.length}건</small></>;
  return <article className="capture-record" key={record.id}>
   <header>{shared?<button className="capture-record-title" onClick={()=>onOpen(path)} disabled={disabled}>{title}</button>:<span className="capture-record-title">{title}</span>}
    <button className="capture-delete" disabled={disabled} aria-label={`${record.label} ${record.date} 기록 삭제`} title={`${record.date} 대화 ${record.sessions.length}건과 저널 링크를 함께 휴지통으로 이동`} onClick={()=>onTrash(record.id)}><Trash2 size={15}/></button></header>
   <details><summary>대화 제목 보기</summary>{record.sessions.map(session=><div className="capture-session" key={session.id}>
    <button disabled={disabled} onClick={()=>onOpen(session.path)}>{session.title}</button>
    <button className="capture-delete" disabled={disabled} aria-label={`${session.title} 대화 삭제`} title="이 날짜의 대화를 휴지통으로 이동하고 이 세션을 다시 가져오지 않습니다." onClick={()=>onTrash(record.id,session.id)}><Trash2 size={14}/></button>
   </div>)}</details>
  </article>;
 })}</section>;
}
