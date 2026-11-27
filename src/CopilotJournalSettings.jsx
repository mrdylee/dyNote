import {useEffect,useState} from 'react';
export default function CopilotJournalSettings({state,destination,importNotice,onResolve,pendingEdits=[],importBlocked,onReviewEdit,onReconnect,onRefresh,onSource,onSave,onImport,onManageSpaces,disabled}){
 const [enabled,setEnabled]=useState(state?.enabled??false);
 const [selected,setSelected]=useState(()=>state?.projects.filter(project=>project.selected).map(project=>project.id)??[]);
 const [pending,setPending]=useState(false),[error,setError]=useState('');
 const run=async action=>{
  setPending(true);setError('');
  try{
   const value=await action();
   if(value?.projects){setEnabled(value.enabled);setSelected(value.projects.filter(project=>project.selected).map(project=>project.id));}
  }catch(e){setError(e.message);}finally{setPending(false);}
 };
 useEffect(()=>{if(destination)run(onRefresh);},[]);
 const busy=disabled||pending,personal=state?.personal===true;
 const projects=state?.projects??[];
 const projectIds=projects.filter(project=>selected.includes(project.id)).map(project=>project.id);
 const autoEnabled=enabled&&projectIds.length>0;
 const preferences={enabled:autoEnabled,projects:projectIds};
 return <section className="settings-section capture-settings" aria-label="Copilot 대화 자동 저장 설정">
  <h3>Copilot 대화 자동 저장</h3>
  <p>프로젝트를 선택하면 해당 프로젝트의 완료된 Copilot 대화를 과거 날짜까지 가져올 수 있습니다. 개인 노트의 Copilot Note 폴더에 대화별로 저장하고 각 날짜의 저널에 링크를 추가합니다.</p>
  {destination ? <p>개인 노트 저장 위치 <strong>{destination}</strong></p> :
   <p role="status">대화를 저장할 개인 노트 폴더를 연결해 주세요. <button onClick={onManageSpaces}>보관함 설정 열기</button></p>}
  {destination&&<>
  {personal&&state?.canReconnect&&<details>
   <summary>이동한 개인 노트의 이전 기록 연결</summary>
   <form onSubmit={event=>{event.preventDefault();const root=new FormData(event.currentTarget).get('previousRoot');run(()=>onReconnect(root));}}>
    <label>이동 전 개인 노트 폴더의 전체 경로<input name="previousRoot" required disabled={busy}/></label>
    <p>이 PC에서 위 경로에 저장한 Copilot 기록을 현재 개인 노트에 연결합니다. 연결 후 가져올 프로젝트를 선택하세요.</p>
    <button disabled={busy||importBlocked}>이전 기록 연결</button>
   </form>
  </details>}
  <label>VS Code 기록 폴더<code className="capture-source-path">{state?.sourceRoot||'불러오는 중…'}</code></label>
  {state?.sessionRoot&&<label>로컬 Copilot Agent Host 기록 폴더<code className="capture-source-path">{state.sessionRoot}</code></label>}
  <div className="settings-actions"><button disabled={busy||!personal} onClick={()=>run(()=>onSource(false))}>기록 폴더 선택</button><button disabled={busy} onClick={()=>run(onRefresh)}>기록 새로고침</button></div>
  {(state?.wslSourceRoot||state?.projects.some(project=>project.wsl))&&<>
   <label>WSL Copilot 기록 폴더{state.wslSourceRoot&&<code className="capture-source-path">{state.wslSourceRoot}</code>}</label>
   <p className="muted">Agent Host 대화는 WSL 배포판의 <code>~/.copilot/session-state</code> 폴더를 연결하면 가져옵니다. Windows에서는 탐색기에 <code>\\wsl.localhost</code>를 입력해 배포판을 열 수 있습니다.</p>
   <div className="settings-actions"><button disabled={busy||!personal} onClick={()=>run(async()=>{await onSource(true);})}>WSL 기록 폴더 선택</button></div>
   {!state.wslSourceRoot&&<p role="status">WSL Agent Host 대화도 가져오려면 해당 배포판의 기록 폴더를 연결해 주세요.</p>}
  </>}
  <fieldset disabled={busy||!personal}><legend>가져올 프로젝트</legend>
   <div className="settings-actions">
    <button type="button" disabled={projectIds.length===projects.length} onClick={()=>setSelected(projects.map(project=>project.id))}>전체 선택</button>
    <button type="button" disabled={!projectIds.length} onClick={()=>setSelected([])}>전체 해제</button>
    <span className="muted">{projects.length}개 중 {projectIds.length}개 선택</span>
   </div>
   {!projects.length&&<p className="muted">로컬 프로젝트 기록이 없습니다. VS Code의 workspaceStorage 폴더를 선택해 주세요.</p>}
   {projects.map(project=><label className="capture-project" key={project.id}>
    <input type="checkbox" checked={selected.includes(project.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,project.id]:old.filter(id=>id!==project.id))}/>
    <span>{project.label}<small>{project.cached&&'Dynote 저장 기록 · '}{project.path}</small></span>
   </label>)}
  </fieldset>
  <label className="capture-toggle"><input type="checkbox" checked={autoEnabled} disabled={busy||!personal||!projectIds.length} onChange={e=>setEnabled(e.target.checked)}/>대화 자동 저장</label>
  <p className="muted">자동 저장을 켜고 설정을 적용하면 앱 실행 중 1시간마다 선택한 프로젝트에서 활성화 이후의 대화를 확인합니다. 왼쪽 파일 목록에서 삭제한 대화 파일은 선택한 프로젝트를 다시 가져오면 남아 있는 기록으로 복구합니다. 저널에서 삭제한 기록은 삭제 되돌리기로 복구하세요.</p>
  <p className="muted">수집 문서는 이 개인 보관함의 Git 백업 설정을 따릅니다. 내부 추론·도구 출력·첨부파일은 가져오지 않습니다.</p>
  <div className="settings-actions"><button className="primary-button" disabled={busy||!personal} onClick={()=>run(()=>onSave(preferences))}>설정 적용</button></div>
  {importBlocked&&<div role="status">
   <p>개인 노트에 미확정 Copilot 변경이 있어 대화 저장을 기다립니다. 해당 문서에서 변경 유지 또는 변경 되돌리기를 선택한 뒤 선택한 프로젝트 가져오기를 눌러 주세요.</p>
   {pendingEdits.map(edit=><button key={edit.path} disabled={busy} aria-label={`미확정 변경 검토: ${edit.path}`} onClick={()=>onReviewEdit(edit.path)}>{edit.path} · 변경 검토</button>)}
  </div>}
  <div className="settings-actions"><button disabled={busy||!personal||importBlocked||!projectIds.length} onClick={()=>run(async()=>{
    await onSave(preferences);
    await onImport(projectIds);
   })}>선택한 프로젝트 가져오기</button></div>
  {(error||state?.error)&&<p className="error-banner" role="alert">{error||state.error}</p>}
  {onResolve&&<button disabled={busy} onClick={onResolve}>남은 충돌 해결</button>}
  {importNotice&&<p className="muted" role="status">{importNotice}</p>}
  </>}
 </section>;
}
