import {useState} from 'react';
const names={merge:'문서 합치기',extract:'선택 영역 추출','extract-heading':'제목 단위 추출'};
export default function ComposerDialog({kind,source,notes,selection,onPreview,onApply,busy}) {
  const others=notes.filter(n=>n.path!==source.path),folder=source.path.includes('/')?source.path.slice(0,source.path.lastIndexOf('/')+1):'';
  const [target,setTarget]=useState(kind==='merge'?others[0]?.path||'':folder+'새 문서.md');
  const [headingLine,setHeadingLine]=useState(source.headings[0]?.line??0),[replacement,setReplacement]=useState('link'),[position,setPosition]=useState('append');
  const [preview,setPreview]=useState(null),[pending,setPending]=useState(false),[error,setError]=useState('');
  const locked=busy||pending;
  const change=(setter,value)=>{setter(value);setPreview(null);setError('');};
  const prepare=async()=>{
    setPending(true);setError('');
    try{const input={kind,sourcePath:source.path,targetPath:/\.md$/i.test(target.trim())?target.trim():target.trim()+'.md',replacement,position,headingLine,...(kind==='extract'?{from:selection?.from,to:selection?.to}:{})};setPreview(await onPreview(input));}
    catch(e){setError(e.message);}finally{setPending(false);}
  };
  const apply=async()=>{if(!preview)return;setPending(true);setError('');try{await onApply(preview);}catch(e){setError(e.message);}finally{setPending(false);}};
  return <section className="composer-dialog" aria-label={names[kind]}>
    <p>원본: {source.path}</p>
    {kind==='merge'?<label>합칠 문서<select aria-label="합칠 대상 문서" disabled={locked} value={target} onChange={e=>change(setTarget,e.target.value)}>{!others.length&&<option value="">다른 문서를 먼저 만들어 주세요</option>}{others.map(n=><option key={n.path} value={n.path}>{n.path}</option>)}</select></label>
      :<label>새 문서 경로<input aria-label="추출할 새 문서 경로" disabled={locked} value={target} onChange={e=>change(setTarget,e.target.value)}/></label>}
    {kind==='extract'&&<p>선택 영역 {selection?selection.to-selection.from:0}자 · 속성 구역은 제외해 주세요.</p>}
    {kind==='extract-heading'&&<label>추출할 제목<select aria-label="추출할 제목" disabled={locked} value={headingLine} onChange={e=>change(setHeadingLine,Number(e.target.value))}>{source.headings.map(h=><option key={h.line} value={h.line}>{'#'.repeat(h.level)} {h.plainText||h.text} · {h.line+1}줄</option>)}</select></label>}
    {kind==='merge'?<label>합칠 위치<select aria-label="문서 합칠 위치" disabled={locked} value={position} onChange={e=>change(setPosition,e.target.value)}><option value="append">대상 내용 뒤에</option><option value="prepend">대상 내용 앞에</option></select></label>
      :<label>원본에 남길 내용<select aria-label="추출 후 원본 내용" disabled={locked} value={replacement} onChange={e=>change(setReplacement,e.target.value)}><option value="link">새 문서 링크</option><option value="embed">새 문서 삽입 링크</option><option value="none">선택 영역 제거</option></select></label>}
    {kind==='merge'&&<p className="muted">같은 속성은 원본 값이 우선하고 목록은 합칩니다. 원본 문서는 복구 사본을 남긴 뒤 보관함에서 제거합니다.</p>}
    <button disabled={locked||!target.trim()||(kind==='extract'&&!selection)||(kind==='extract-heading'&&!source.headings.length)} onClick={prepare}>변경 미리보기</button>
    {error&&<p role="alert">{error}</p>}
    {preview&&<section className="composition-preview" aria-label="문서 변경 미리보기"><h3>변경될 문서 {preview.changes.length}개</h3>
      {preview.changes.map(change=><details key={change.path}><summary>{change.kind==='create'?'새 문서':change.kind==='remove'?'보관함에서 제거':'내용 변경'} · {change.path}</summary><div className="composition-content"><div><strong>이전 내용</strong><pre>{change.before||'(없음)'}</pre></div><div><strong>이후 내용</strong><pre>{change.after||(change.kind==='remove'?'복구 사본에 보관합니다.':'(없음)')}</pre></div></div></details>)}
      <p className="muted">긴 내용은 앞부분만 표시합니다. 외부에서 파일을 바꾸면 적용을 중단합니다.</p><button className="primary-button" disabled={locked} onClick={apply}>미리본 변경 적용</button>
    </section>}
    {pending&&<p role="status">문서를 확인하고 있습니다…</p>}
  </section>;
}
