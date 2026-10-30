import {useState} from 'react';
export default function ClassificationReview({suggestions,onPreview,onApply}) {
  const [items,setItems]=useState(()=>suggestions.map(s=>({...s,selected:true})));
  const [preview,setPreview]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const update=(index,change)=>{setItems(old=>old.map((item,i)=>i===index?{...item,...change}:item));setPreview(null);setError('');};
  const run=async action=>{setPending(true);setError('');try{await action();}catch(e){setError(e.message);}finally{setPending(false);}};
  return <section className="classification-review">
    <p>원본 저널은 남겨두고 선택한 내용을 별도 문서에 복사합니다. 같은 발췌는 중복 추가하지 않으며, 수정한 발췌는 새 버전으로 덧붙입니다.</p>
    <p className="muted">제목·내용과 기존 폴더 이름을 기기 안에서 비교한 제안입니다. 저장 위치를 확인해 주세요.</p>
    {items.map((item,index)=><fieldset key={`${item.from}:${item.to}`} disabled={pending}>
      <label><input type="checkbox" aria-label={`${item.title} 분류`} checked={item.selected} onChange={e=>update(index,{selected:e.target.checked})}/>{item.title}</label>
      <p>{item.reason}</p><label>저장할 문서 <input aria-label={`${item.title} 저장 경로`} value={item.targetPath} placeholder="폴더/문서.md" onChange={e=>update(index,{targetPath:e.target.value})}/></label>
      <details><summary>복사할 원문 보기</summary><pre>{item.excerpt}</pre></details>
    </fieldset>)}
    {error&&<p role="alert">{error}</p>}
    <button disabled={pending||!items.some(i=>i.selected)||items.some(i=>i.selected&&!i.targetPath.trim())} onClick={()=>run(async()=>setPreview(await onPreview({items:items.filter(i=>i.selected)})))}>분류 미리보기</button>
    {preview&&<section aria-label="분류 변경 미리보기"><p>{preview.changes.length?'아래 문서에 추가합니다. 원본 저널은 변경하지 않습니다.':'선택한 발췌는 이미 분류되어 있습니다.'}</p>
      {preview.changes.map(change=><details key={change.path} open><summary>{change.path} · {change.before?'기존 문서에 추가':'새 문서'}</summary><pre>{change.after}</pre></details>)}
      <button className="primary-button" disabled={pending||!preview.changes.length} onClick={()=>run(()=>onApply(preview))}>확정하여 분류</button>
    </section>}
  </section>;
}
