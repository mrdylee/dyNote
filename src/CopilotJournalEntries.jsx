import {Download,Settings,Trash2,Undo2} from 'lucide-react';
export function CopilotJournalToolbar({state,disabled,onImport,onSettings,onRestore}){
 return <div className="capture-toolbar" aria-label="저널 자동기록 작업">
  <span className={state?.error?'capture-error':''} role="status" title={state?.error||undefined}>{state?.error||(state?.enabled?'Copilot 자동 기록 켜짐':'Copilot 대화 기록')}</span>
  <button disabled={disabled} title="선택한 VS Code 프로젝트의 오늘 대화를 가져옵니다." onClick={onImport}><Download size={14}/>가져오기</button>
  <button disabled={disabled} aria-label="저널 자동기록 설정" onClick={onSettings}><Settings size={14}/></button>
  {state?.trashId&&<button disabled={disabled} onClick={onRestore}><Undo2 size={14}/>삭제 되돌리기</button>}
 </div>;
}
export default function CopilotJournalEntries({records=[],disabled,onOpen,onTrash}){
 if(!records.length)return null;
 return <section className="capture-records" aria-label="AI 자동 기록">{records.map(record=><article className="capture-record" key={record.id}>
  <header><button className="capture-record-title" onClick={()=>onOpen(record.path)} disabled={disabled}>{record.label} AI 대화 <small>{record.sessions.length}건</small></button>
   <button className="capture-delete" disabled={disabled} aria-label={`${record.label} ${record.date} 기록 삭제`} title={`${record.date} 대화 ${record.sessions.length}건과 저널 링크를 함께 휴지통으로 이동`} onClick={()=>onTrash(record.id)}><Trash2 size={15}/></button></header>
  <details><summary>대화 제목 보기</summary>{record.sessions.map(session=><div className="capture-session" key={session.id}>
   <button disabled={disabled} onClick={()=>onOpen(record.path)}>{session.title}</button>
   <button className="capture-delete" disabled={disabled} aria-label={`${session.title} 대화 삭제`} title="이 대화만 휴지통으로 이동하고 자동 기록에서 제외" onClick={()=>onTrash(record.id,session.id)}><Trash2 size={14}/></button>
  </div>)}</details>
 </article>)}</section>;
}
