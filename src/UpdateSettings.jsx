import {useState} from 'react';
export default function UpdateSettings({currentVersion,state,onCheck,onSettings,onDownload,onShow,onOpen}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const run=async action=>{setPending(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setPending(false);}};
  if(!state)return <p>업데이트 설정을 불러오는 중…</p>;
  const {preferences,result,phase,message,lastCheckedAt}=state;
  const busy=pending||['checking','downloading'].includes(phase),latest=result?.latest,skipped=latest&&preferences.ignored.includes(latest.tag);
  return <section className="settings-section update-settings" aria-label="Dynote 업데이트">
    <h3>Dynote 업데이트</h3><p>현재 버전 {currentVersion}</p>
    <label><input type="checkbox" aria-label="매주 업데이트 자동 확인" checked={preferences.enabled} disabled={busy} onChange={e=>run(()=>onSettings({enabled:e.target.checked}))}/>매주 업데이트 자동 확인</label>
    <label><input type="checkbox" aria-label="백그라운드 다운로드" checked={preferences.backgroundDownload} disabled={busy} onChange={e=>run(()=>onSettings({backgroundDownload:e.target.checked}))}/>새 버전을 백그라운드에서 다운로드</label>
    <label><input type="checkbox" aria-label="시험 버전 포함" checked={preferences.includePrerelease} disabled={busy} onChange={e=>run(()=>onSettings({includePrerelease:e.target.checked}))}/>시험 버전도 확인</label>
    <p className="muted">마지막 확인으로부터 7일 뒤에 확인합니다. 앱을 꺼 두었다면 다음 실행 때 확인합니다.</p>
    <p>마지막 확인: {lastCheckedAt?new Date(lastCheckedAt).toLocaleString():'아직 확인하지 않음'}</p>
    <div className="update-actions"><button className="primary-button" disabled={busy} onClick={()=>run(onCheck)}>{phase==='checking'?'확인 중…':'지금 업데이트 확인'}</button>
      {!!preferences.ignored.length&&<button disabled={busy} onClick={()=>run(()=>onSettings({ignored:[]}))}>무시한 버전 다시 표시</button>}</div>
    {(error||phase==='error')&&<p role="alert" className="settings-message error">{error||message}</p>}
    {phase==='downloading'&&<p role="status">백그라운드 다운로드 중 · {state.progress}%</p>}
    {phase==='ready'&&<div role="status"><p>다운로드 검증 완료 · 설치 준비가 되었습니다.</p><p>ZIP 파일 전체를 풀고 앱을 종료한 다음 기존 앱을 교체해 주세요.</p><button onClick={()=>run(onShow)}>설치 파일 위치 열기</button></div>}
    {result&&phase!=='error'&&<div aria-label="업데이트 확인 결과" role="status">
      <p>{!latest?'이 기기에 맞는 공개 배포 파일을 찾지 못했습니다.':result.available?(skipped?'이 버전의 알림을 무시했습니다.':'새 버전을 사용할 수 있습니다.'):'이 기기에 맞는 공개 배포에 현재보다 새 버전이 없습니다.'}</p>
      {latest&&<><h4>{latest.name} · {latest.tag}</h4><div className="update-actions"><button onClick={()=>onOpen(latest.url)}>공식 릴리스 열기</button>
        {result.available&&!skipped&&<button disabled={busy} onClick={()=>run(()=>onSettings({ignored:[...preferences.ignored,latest.tag]}))}>이 버전 무시</button>}
        {result.available&&phase!=='ready'&&<button disabled={busy||!latest.assets[0]?.digest} onClick={()=>run(onDownload)}>백그라운드 다운로드</button>}</div>
        <pre className="release-notes">{latest.body||'릴리스 설명이 없습니다.'}</pre></>}
      {phase==='available'&&message&&<p>{message}</p>}
    </div>}
    <p className="muted">다운로드한 파일은 검증 후 안내합니다. 현재 ZIP 배포는 설치를 직접 진행합니다.</p>
  </section>;
}
