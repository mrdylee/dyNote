import {useState} from 'react';
export default function UpdateSettings({currentVersion,onCheck,onOpen}) {
  const [beta,setBeta]=useState(()=>localStorage.getItem('dynote.updates.beta')==='true');
  const [ignored,setIgnored]=useState(()=>{try{const value=JSON.parse(localStorage.getItem('dynote.updates.ignored'));return Array.isArray(value)?value.filter(v=>typeof v==='string'):[];}catch{return [];}});
  const [result,setResult]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const check=async()=>{setPending(true);setError('');setResult(null);try{setResult(await onCheck(beta));}catch(e){setError(e.message);}finally{setPending(false);}};
  const ignore=value=>{setIgnored(value);try{localStorage.setItem('dynote.updates.ignored',JSON.stringify(value));}catch{}};
  const skipped=result?.latest&&ignored.includes(result.latest.tag);
  return <section className="settings-section update-settings" aria-label="Dynote 업데이트">
    <h3>Dynote 업데이트</h3><p>현재 버전 {currentVersion}</p>
    <label><input type="checkbox" aria-label="시험 버전 포함" checked={beta} disabled={pending} onChange={e=>{setBeta(e.target.checked);setResult(null);try{localStorage.setItem('dynote.updates.beta',String(e.target.checked));}catch{}}}/>시험 버전도 확인</label>
    <div className="update-actions"><button className="primary-button" disabled={pending} onClick={check}>{pending?'확인 중…':'업데이트 확인'}</button>
      {!!ignored.length&&<button disabled={pending} onClick={()=>ignore([])}>무시한 버전 다시 표시</button>}</div>
    {error&&<p role="alert" className="settings-message error">{error}</p>}
    {result&&<div aria-label="업데이트 확인 결과" role="status"><p>{!result.latest?'이 채널의 공개 배포를 찾지 못했습니다.':result.available?(skipped?'이 버전의 알림을 무시했습니다.':'새 버전을 사용할 수 있습니다.'):'확인한 공개 배포에 현재보다 새 버전이 없습니다.'}</p>
      {result.latest&&<><h4>{result.latest.name} · {result.latest.tag}</h4><div className="update-actions"><button onClick={()=>onOpen(result.latest.url)}>공식 릴리스 열기</button>
        {result.available&&!skipped&&<button onClick={()=>ignore([...new Set([...ignored,result.latest.tag])])}>이 버전 무시</button>}</div>
        <pre className="release-notes">{result.latest.body||'릴리스 설명이 없습니다.'}</pre>
        <div className="release-assets">{result.latest.assets.map(asset=><button key={asset.url} onClick={()=>onOpen(asset.url)}>{asset.name}</button>)}</div></>}
      <small>{new Date(result.checkedAt).toLocaleString()} 확인</small>
    </div>}
    <p className="muted">확인 버튼을 누르면 공식 공개 배포를 조회합니다. 배포 파일의 설치는 직접 진행합니다.</p>
  </section>;
}
