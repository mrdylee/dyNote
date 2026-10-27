import {useEffect,useState} from 'react';
export default function GitWorkspace({onStatus,onDiff,onAction,backupEnabled,busy,onOpen}) {
  const [state,setState]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[diff,setDiff]=useState(''),[selected,setSelected]=useState('');
  const [message,setMessage]=useState(''),[branch,setBranch]=useState(''),[confirmed,setConfirmed]=useState(false);
  const locked=pending||busy;
  const refresh=async()=>{setPending(true);setError('');try{setState(await onStatus());}catch(e){setError(e.message);}finally{setPending(false);}};
  useEffect(()=>{let mounted=true;setPending(true);onStatus().then(value=>{if(mounted)setState(value);}).catch(e=>{if(mounted)setError(e.message);}).finally(()=>{if(mounted)setPending(false);});return()=>{mounted=false;};},[]);
  const action=async(kind,extra={})=>{
    setPending(true);setError('');
    try{setState(await onAction({kind,...extra}));setDiff('');setSelected('');setConfirmed(false);if(kind==='commit')setMessage('');}
    catch(e){setError(e.message);}finally{setPending(false);}
  };
  const showDiff=async(file,staged)=>{
    setSelected(file.path);setPending(true);setError('');
    try{setDiff(file.index==='?'?'새 파일입니다. 문서 열기로 내용을 확인해 주세요.':(await onDiff(file.path,staged))||'선택한 영역의 차이가 없습니다.');}catch(e){setError(e.message);}finally{setPending(false);}
  };
  return <section className="settings-section git-workspace" aria-label="Git 변경 관리">
    <h3>Git 변경 관리</h3><p>변경 파일을 검토하고 스테이징한 내용만 커밋합니다. 원격 작업은 버튼을 눌렀을 때 실행합니다.</p>
    {error&&<p role="alert" className="settings-message error">{error}</p>}
    <div className="git-workspace-actions"><button disabled={locked} onClick={refresh}>Git 상태 새로고침</button><strong>{state?.branch}</strong>
      {state?.available&&<><button disabled={locked||!state.remotes.length} onClick={()=>action('fetch')}>원격 정보 확인</button><button disabled={locked||!state.remotes.length} onClick={()=>action('pull')}>변경 가져오기 · FF만</button></>}
    </div>
    {state?.available===false&&<button disabled={locked} className="primary-button" onClick={()=>action('init')}>이 보관함에 Git 초기화</button>}
    {state?.available&&<>
      {!!state.excluded&&<p className="muted">노트 이외의 변경 {state.excluded}개는 이 화면에서 다루지 않습니다. 스테이징된 경우 커밋을 중단합니다.</p>}
      <div className="git-file-list">{state.files.map(file=><div key={file.path} className={selected===file.path?'selected':''}>
        <code>{file.index}{file.worktree}</code><button disabled={locked} onClick={()=>showDiff(file,file.index!==' '&&file.index!=='?')}>{file.path}</button>
        <button disabled={locked} onClick={()=>onOpen(file.path)}>문서 열기</button>
        {file.index!==' '&&file.index!=='?'&&<button disabled={locked} aria-label={`${file.path} 스테이징 해제`} onClick={()=>action('unstage',{path:file.path})}>해제</button>}
        {(file.worktree!==' '||file.index==='?')&&<button disabled={locked} aria-label={`${file.path} 스테이징`} onClick={()=>action('stage',{path:file.path})}>스테이징</button>}
      </div>)}</div>
      {!state.files.length&&<p className="muted">노트 변경사항이 없습니다.</p>}
      {diff&&<pre className="git-diff" aria-label="Git 파일 차이">{diff}</pre>}
      <form onSubmit={e=>{e.preventDefault();action('commit',{message});}}><label>커밋 메시지<input aria-label="Git 커밋 메시지" value={message} disabled={locked} onChange={e=>setMessage(e.target.value)}/></label><button className="primary-button" disabled={locked||!message.trim()||!state.files.some(f=>f.index!==' '&&f.index!=='?')}>스테이징한 변경 커밋</button></form>
      <h4>로컬 브랜치</h4>{backupEnabled&&<p className="muted">브랜치 변경 전 Git 백업 탭에서 자동 백업을 꺼 주세요.</p>}
      <div className="git-workspace-actions"><select aria-label="전환할 Git 브랜치" value={state.branches.includes(state.branch)?state.branch:''} disabled={locked||backupEnabled} onChange={e=>action('switch-branch',{branch:e.target.value})}>
        {!state.branches.includes(state.branch)&&<option value="">브랜치 선택</option>}{state.branches.map(b=><option key={b}>{b}</option>)}
      </select></div>
      <label>브랜치 이름<input aria-label="새 Git 브랜치 이름" value={branch} disabled={locked||backupEnabled} onChange={e=>{setBranch(e.target.value);setConfirmed(false);}}/></label>
      <div className="git-workspace-actions"><button disabled={locked||backupEnabled||!branch.trim()} onClick={()=>action('create-branch',{branch})}>브랜치 만들고 전환</button>
        <label><input type="checkbox" checked={confirmed} disabled={locked||backupEnabled} onChange={e=>setConfirmed(e.target.checked)}/>위 이름의 병합된 브랜치 삭제 확인</label>
        <button disabled={locked||backupEnabled||!branch.trim()||!confirmed} onClick={()=>action('delete-branch',{branch})}>병합된 브랜치 삭제</button></div>
    </>}
    {pending&&<p role="status">Git 작업 중…</p>}
  </section>;
}
