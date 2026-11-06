import {useEffect,useState} from 'react';
export default function CopilotJournalSettings({state,destination,onRefresh,onSource,onSave,onImport,onManageSpaces,disabled}){
 const [enabled,setEnabled]=useState(state?.enabled??false),[selected,setSelected]=useState(()=>state?.projects?.filter(p=>p.selected).map(p=>p.id)??[]);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const run=async action=>{setPending(true);setError('');try{const value=await action();if(value?.projects){setEnabled(value.enabled);setSelected(value.projects.filter(p=>p.selected).map(p=>p.id));}}catch(e){setError(e.message);}finally{setPending(false);}};
 useEffect(()=>{if(destination)run(onRefresh);},[]);
 const busy=disabled||pending,personal=state?.personal===true;
 return <section className="settings-section capture-settings" aria-label="저널 자동기록 설정">
  <h3>VS Code Copilot 대화 가져오기</h3>
  <p>선택한 프로젝트의 질문과 답변을 날짜별 문서에 모으고 저널에 링크를 추가합니다. 세션을 새로 열어도 같은 프로젝트의 기록을 이어갑니다.</p>
  {destination ? <p>개인 노트 저장 위치 <strong>{destination}</strong></p> :
   <p role="status">대화를 저장할 개인 노트 폴더를 연결해 주세요. <button onClick={onManageSpaces}>보관함 설정 열기</button></p>}
  {destination&&<>
  <label>VS Code 기록 폴더<code className="capture-source-path">{state?.sourceRoot||'불러오는 중…'}</code></label>
  <div className="settings-actions"><button disabled={busy||!personal} onClick={()=>run(onSource)}>기록 폴더 선택</button><button disabled={busy} onClick={()=>run(onRefresh)}>프로젝트 새로고침</button></div>
  <fieldset disabled={busy||!personal}><legend>가져올 프로젝트</legend>
   {!state?.projects.length&&<p className="muted">로컬 프로젝트 기록이 없습니다. VS Code의 workspaceStorage 폴더를 선택해 주세요.</p>}
   {state?.projects.map(project=><label className="capture-project" key={project.id}><input type="checkbox" checked={selected.includes(project.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,project.id]:old.filter(id=>id!==project.id))}/><span>{project.label}<small>{project.path}</small></span></label>)}
  </fieldset>
  <label className="capture-toggle"><input type="checkbox" checked={enabled} disabled={busy||!personal} onChange={e=>setEnabled(e.target.checked)}/>자동 기록</label>
  <p className="muted">자동 기록은 앱 실행 중 1시간마다 활성화 이후의 대화를 확인합니다. 저널의 ‘가져오기’는 자동 기록을 꺼도 선택한 프로젝트의 오늘 대화를 바로 가져옵니다. 삭제한 항목은 다시 가져오지 않습니다.</p>
  <p className="muted">수집 문서는 이 개인 보관함의 Git 백업 설정을 따릅니다. 내부 추론·도구 출력·첨부파일은 가져오지 않습니다. WSL·SSH·Cloud 대화는 이 로컬 수집 대상이 아닙니다.</p>
  <div className="settings-actions"><button className="primary-button" disabled={busy||!personal||(enabled&&!selected.length)} onClick={()=>run(()=>onSave({enabled,projects:selected}))}>설정 적용</button>
   <button disabled={busy||!personal||!selected.length} onClick={()=>run(async()=>{await onSave({enabled,projects:selected});await onImport();})}>오늘 대화 가져오기</button></div>
  {(error||state?.error)&&<p className="error-banner" role="alert">{error||state.error}</p>}
  </>}
 </section>;
}
