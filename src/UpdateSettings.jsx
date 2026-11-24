import {useState} from 'react';
export default function UpdateSettings({currentVersion,state,onCheck,onSettings,onDirectory,onDownload,onShow,onInstall,onOpen}) {
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  const [feedDraft,setFeedDraft]=useState(null);
  const run=async action=>{setPending(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setPending(false);}};
  if(!state)return <p>업데이트 설정을 불러오는 중…</p>;
  const {preferences,result,phase,message,lastCheckedAt}=state;
  const busy=pending||['checking','downloading','installing'].includes(phase),latest=result?.latest,skipped=latest&&preferences.ignored.includes(latest.tag);
  const internal = preferences.source === 'internal';
  const savedFeed = preferences.internalFeedUrl || '';
  const feed = feedDraft ?? savedFeed;
  const feedChanged = feed.trim() !== savedFeed;
  const frequency = internal ? '매일' : '매주';
  const isSetup = /-Setup\.exe$/i.test(state.downloadedPath || '');
  return <section className="settings-section update-settings" aria-label="Dynote 업데이트">
    <h3>Dynote 업데이트</h3><p>현재 버전 {currentVersion}</p>
    <label>업데이트 배포처<select value={preferences.source || 'github'} disabled={busy} onChange={e=>run(async()=>{
      await onSettings({source:e.target.value}); setFeedDraft(null);
    })}><option value="github">GitHub</option><option value="internal">회사 내부</option></select></label>
    {internal && <>
      <label>사내 Git 또는 latest.json 주소<input type="url" value={feed} disabled={busy} onChange={e=>setFeedDraft(e.target.value)}/></label>
      <button disabled={busy || !feedChanged} onClick={()=>run(async()=>{
        await onSettings({internalFeedUrl:feed.trim()}); setFeedDraft(null);
      })}>주소 저장</button>
      {!savedFeed && <p className="muted">HTTPS 저장소 주소(.git)를 저장하면 기본 브랜치의 dynote/latest.json을 확인합니다. Windows 설치 파일 다운로드에는 Git LFS가 필요합니다.</p>}
    </>}
    <label><input type="checkbox" aria-label={frequency+' 업데이트 자동 확인'} checked={preferences.enabled} disabled={busy} onChange={e=>run(()=>onSettings({enabled:e.target.checked}))}/>{frequency} 업데이트 자동 확인</label>
    <label><input type="checkbox" aria-label="백그라운드 다운로드" checked={preferences.backgroundDownload} disabled={busy} onChange={e=>run(()=>onSettings({backgroundDownload:e.target.checked}))}/>새 버전을 백그라운드에서 다운로드</label>
    {state.installSupported && <><label><input type="checkbox" aria-label="자동 설치 및 다시 시작" checked={preferences.autoInstall} disabled={busy} onChange={e=>run(()=>onSettings({autoInstall:e.target.checked}))}/>다운로드 후 자동 설치하고 다시 시작</label><p className="muted">작업을 마치고 1분간 입력이 없으면 문서와 임시 초안을 저장한 뒤 업데이트합니다. 설정 창을 닫으면 대기를 시작합니다. ‘나중에’를 누르면 이번 실행에서는 자동 설치하지 않습니다.</p></>}
    <label><input type="checkbox" aria-label="시험 버전 포함" checked={preferences.includePrerelease} disabled={busy} onChange={e=>run(()=>onSettings({includePrerelease:e.target.checked}))}/>시험 버전도 확인</label>
    <label>다운로드 폴더<input aria-label="업데이트 다운로드 폴더" value={preferences.downloadDirectory||''} readOnly/></label>
    <button disabled={busy} onClick={()=>run(onDirectory)}>다운로드 폴더 선택</button>
    <p className="muted">새 다운로드에 적용됩니다. 이미 받은 파일은 아래 저장 위치에서 확인할 수 있습니다.</p>
    <p className="muted">마지막 확인으로부터 {internal ? '하루' : '7일'} 뒤에 확인합니다. 앱을 꺼 두었다면 다음 실행 때 확인합니다.</p>
    <p>마지막 확인: {lastCheckedAt?new Date(lastCheckedAt).toLocaleString():'아직 확인하지 않음'}</p>
    <div className="update-actions"><button className="primary-button" disabled={busy || (internal && (!savedFeed || feedChanged))} onClick={()=>run(onCheck)}>{phase==='checking'?'확인 중…':'지금 업데이트 확인'}</button>
      {!!preferences.ignored.length&&<button disabled={busy} onClick={()=>run(()=>onSettings({ignored:[]}))}>무시한 버전 다시 표시</button>}</div>
    {(error||phase==='error')&&<p role="alert" className="settings-message error">{error||message}</p>}
    {phase==='downloading'&&<p role="status">백그라운드 다운로드 중 · {state.progress}%</p>}
    {phase==='installing'&&<p role="status">작업을 저장한 뒤 업데이트하고 다시 시작합니다…</p>}
    {state.downloadedPath&&<div role="status"><p>다운로드 검증이 완료된 설치 파일입니다.</p><label>받은 파일<input aria-label="다운로드된 업데이트 파일" value={state.downloadedPath} readOnly/></label><p>{state.installSupported ? '설치하면 Dynote가 자동으로 종료되고 다시 열립니다.' : isSetup ? 'Dynote를 종료한 다음 받은 Setup.exe를 실행해 업데이트하세요.' : 'ZIP 파일 전체를 풀고 앱을 종료한 다음 기존 앱을 교체해 주세요.'}</p>{state.installSupported&&<button disabled={busy||phase!=='ready'} onClick={()=>run(onInstall)}>지금 설치하고 다시 시작</button>}<button disabled={busy} onClick={()=>run(onShow)}>설치 파일 위치 열기</button></div>}
    {latest?.tag&&state.installation?.tag===latest.tag&&phase!=='error'&&phase!=='installing'&&message&&<p role="alert">{state.installation.error||message}</p>}
    {result&&phase!=='error'&&<div aria-label="업데이트 확인 결과" role="status">
      <p>{!latest?'이 기기에 맞는 배포 파일을 찾지 못했습니다.':result.available?(skipped?'이 버전의 알림을 무시했습니다.':'새 버전을 사용할 수 있습니다.'):'선택한 배포처에 이 기기용 새 버전이 없습니다.'}</p>
      {latest&&<><h4>{latest.name} · {latest.tag}</h4><div className="update-actions">{latest.url && <button onClick={()=>onOpen(latest.url)}>공식 릴리스 열기</button>}
        {result.available&&!skipped&&<button disabled={busy} onClick={()=>run(()=>onSettings({ignored:[...preferences.ignored,latest.tag]}))}>이 버전 무시</button>}
        {result.available&&phase!=='ready'&&phase!=='installing'&&<button disabled={busy||!latest.assets[0]?.digest} onClick={()=>run(onDownload)}>백그라운드 다운로드</button>}</div>
        {(!internal || latest.body) && <pre className="release-notes">{latest.body||'릴리스 설명이 없습니다.'}</pre>}</>}
      {phase==='available'&&message&&<p>{message}</p>}
    </div>}
    <p className="muted">{state.installSupported ? '공식 배포 파일을 검증한 뒤 설치합니다. Windows를 자동으로 재부팅하지 않습니다.' : '다운로드한 파일은 검증 후 안내합니다. 설치는 직접 진행합니다.'}</p>
  </section>;
}
