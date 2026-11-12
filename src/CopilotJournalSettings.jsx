import {useEffect,useState} from 'react';
const sessionTime=new Intl.DateTimeFormat('ko-KR',{dateStyle:'short',timeStyle:'short'});
export default function CopilotJournalSettings({state,destination,importNotice,onRefresh,onSource,onSave,onSessions,onImport,onManageSpaces,disabled}){
 const [enabled,setEnabled]=useState(state?.enabled??false),[selected,setSelected]=useState(()=>state?.projects?.filter(p=>p.selected).map(p=>p.id)??[]);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const [sessions,setSessions]=useState(null),[sessionIds,setSessionIds]=useState([]);
 const run=async action=>{setPending(true);setError('');try{const value=await action();if(value?.projects){setEnabled(value.enabled);setSelected(value.projects.filter(p=>p.selected).map(p=>p.id));}}catch(e){setError(e.message);}finally{setPending(false);}};
 useEffect(()=>{if(destination)run(onRefresh);},[]);
 const projectIds=selected.join(',');
 useEffect(()=>{setSessions(null);setSessionIds([]);},[projectIds,state?.sourceRoot,state?.wslSourceRoot]);
 const busy=disabled||pending,personal=state?.personal===true;
 return <section className="settings-section capture-settings" aria-label="저널 자동기록 설정">
  <h3>VS Code Copilot 대화 가져오기</h3>
  <p>프로젝트 안에 세션별 문서를 만들고 각 날짜의 저널에 링크를 추가합니다. 다시 가져올 때는 아직 기록하지 않은 대화만 추가합니다.</p>
  {destination ? <p>개인 노트 저장 위치 <strong>{destination}</strong></p> :
   <p role="status">대화를 저장할 개인 노트 폴더를 연결해 주세요. <button onClick={onManageSpaces}>보관함 설정 열기</button></p>}
  {destination&&<>
  <label>VS Code 기록 폴더<code className="capture-source-path">{state?.sourceRoot||'불러오는 중…'}</code></label>
  <div className="settings-actions"><button disabled={busy||!personal} onClick={()=>run(onSource)}>기록 폴더 선택</button><button disabled={busy} onClick={()=>run(onRefresh)}>프로젝트 새로고침</button></div>
  {(state?.wslSourceRoot||state?.projects.some(project=>project.wsl))&&<>
   <label>WSL Copilot 기록 폴더{state.wslSourceRoot&&<code className="capture-source-path">{state.wslSourceRoot}</code>}</label>
   <p className="muted">Agent Host 대화는 WSL 배포판의 <code>~/.copilot/session-state</code> 폴더를 연결하면 가져옵니다. Windows에서는 탐색기에 <code>\\wsl.localhost</code>를 입력해 배포판을 열 수 있습니다.</p>
   <div className="settings-actions"><button disabled={busy||!personal} onClick={()=>run(()=>onSource(true))}>WSL 기록 폴더 선택</button></div>
  </>}
  <fieldset disabled={busy||!personal}><legend>가져올 프로젝트</legend>
   {!state?.projects.length&&<p className="muted">로컬 프로젝트 기록이 없습니다. VS Code의 workspaceStorage 폴더를 선택해 주세요.</p>}
   {state?.projects.map(project=><label className="capture-project" key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,project.id]:old.filter(id=>id!==project.id))}/><span>{project.label}<small>{project.path}</small></span></label>)}
  </fieldset>
  <label className="capture-toggle"><input type="checkbox" checked={enabled} disabled={busy||!personal} onChange={e=>setEnabled(e.target.checked)}/>자동 기록</label>
  <p className="muted">자동 기록은 앱 실행 중 1시간마다 활성화 이후의 대화를 확인합니다. 수동으로 가져올 때는 세션을 선택하면 이전 날짜의 대화도 함께 저장합니다. 삭제한 항목은 다시 가져오지 않습니다.</p>
  <p className="muted">수집 문서는 이 개인 보관함의 Git 백업 설정을 따릅니다. 내부 추론·도구 출력·첨부파일은 가져오지 않습니다.</p>
  <div className="settings-actions"><button className="primary-button" disabled={busy||!personal||(enabled&&!selected.length)} onClick={()=>run(()=>onSave({enabled,projects:selected}))}>설정 적용</button></div>
  <fieldset disabled={busy||!personal}><legend>가져올 세션</legend>
   <button disabled={busy||!personal||!selected.length} onClick={()=>run(async()=>{
    const result=await onSessions(selected);
    setSessions(result.sessions);setSessionIds([]);setError(result.error||'');
   })}>세션 불러오기</button>
   {sessions===null?<p className="muted">프로젝트를 선택하고 세션 목록을 불러오세요.</p>:
    !sessions.length?<p role="status">가져올 수 있는 완료된 대화 세션이 없습니다. 기록 폴더와 프로젝트를 확인해 주세요.</p>:
    sessions.map(session=><label className="capture-project" key={session.id}>
     <input type="checkbox" checked={sessionIds.includes(session.id)} onChange={event=>setSessionIds(old=>event.target.checked?[...old,session.id]:old.filter(id=>id!==session.id))}/>
     <span>{session.title}<small>{session.projectLabel} · {sessionTime.format(session.lastActivity)}</small><small>{session.projectPath}</small></span>
    </label>)}
  </fieldset>
  <div className="settings-actions"><button disabled={busy||!personal||!sessionIds.length} onClick={()=>run(async()=>{
    await onSave({enabled,projects:selected});
    await onImport(sessionIds);
   })}>선택한 세션 가져오기</button></div>
  {(error||state?.error)&&<p className="error-banner" role="alert">{error||state.error}</p>}
  {importNotice&&<p className="muted" role="status">{importNotice}</p>}
  </>}
 </section>;
}
