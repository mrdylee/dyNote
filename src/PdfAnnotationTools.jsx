import {useEffect,useState} from 'react';
export default function PdfAnnotationTools({path,page,selection,annotations,onPreview,onApply,onFollow,onCopy}){
 const [kind,setKind]=useState('highlight'),[annotationId,setAnnotationId]=useState(''),[color,setColor]=useState('#ffff00'),[comment,setComment]=useState('');
 const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const supported=annotations.filter(a=>['Highlight','Text','Underline','StrikeOut','Squiggly'].includes(a.subtype));
 useEffect(()=>{setPreview(null);setNotice('');},[page,path,selection,annotations]);
 const change=(setter,value)=>{setter(value);setPreview(null);setError('');};
 const choose=id=>{change(setAnnotationId,id);const item=supported.find(a=>a.id===id);setComment(item?.contentsObj?.str||'');setColor(item?.color?'#'+Array.from(item.color).map(v=>v.toString(16).padStart(2,'0')).join(''):'#ffff00');};
 const run=async apply=>{
   setBusy(true);setError('');setNotice('');
   try{
     if(apply){const result=await onApply(preview);setPreview(null);setNotice('PDF를 저장했습니다. 이전 파일은 복구 사본에 남아 있습니다.');if(result.annotationId)setAnnotationId(result.annotationId);}
     else setPreview(await onPreview({path,page,kind,annotationId,color,comment,rects:selection?.rects}));
   }catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const enabled=kind==='highlight'?!!selection?.rects?.length:!!annotationId;
 return <details className="pdf-annotation-tools"><summary>PDF 주석 편집 · 이 페이지 {supported.length}개</summary>
   <p>저장하면 PDF 파일을 수정합니다. 이전 파일은 복구 사본으로 보관합니다.</p>
   <label>주석 작업<select aria-label="PDF 주석 작업" disabled={busy} value={kind} onChange={e=>change(setKind,e.target.value)}><option value="highlight">선택한 텍스트 강조</option><option value="edit">기존 주석 메모·색상 변경</option><option value="delete">기존 주석 제거</option></select></label>
   <label>기존 주석<select aria-label="PDF 기존 주석" disabled={busy} value={annotationId} onChange={e=>choose(e.target.value)}><option value="">주석 선택</option>{supported.map(a=><option key={a.id} value={a.id}>{a.subtype} · {a.contentsObj?.str?.slice(0,70)||a.id}</option>)}</select></label>
   {annotationId&&<><button disabled={busy} onClick={()=>onFollow(`page=${page}&annotation=${encodeURIComponent(annotationId)}`)}>주석 위치 보기</button><button disabled={busy} onClick={()=>onCopy(`[[${path.split('/').map(encodeURIComponent).join('/')}#page=${page}&annotation=${encodeURIComponent(annotationId)}]]`)}>주석 링크 복사</button></>}
   {kind!=='delete'&&<><label>강조 색상<input aria-label="PDF 주석 색상" type="color" value={color} disabled={busy} onChange={e=>change(setColor,e.target.value)}/></label><label>주석 메모<textarea aria-label="PDF 주석 메모" maxLength={10000} value={comment} disabled={busy} onChange={e=>change(setComment,e.target.value)}/></label></>}
   {kind==='highlight'&&!selection?.rects?.length&&<p className="muted">먼저 PDF 텍스트를 드래그해 선택해 주세요.</p>}
   {kind==='delete'&&<p>이 주석으로 연결한 기존 링크의 대상도 제거됩니다.</p>}
   <button disabled={busy||!enabled} onClick={()=>run(false)}>PDF 변경 미리보기</button>
   {preview&&<section aria-label="PDF 변경 미리보기"><p>{preview.input.path} · {preview.input.page}페이지 · {kind==='delete'?'주석 제거':kind==='edit'?'주석 변경':'강조 추가'}</p><p>{preview.beforeBytes.toLocaleString()} → {preview.afterBytes.toLocaleString()} 바이트 · 복구 사본 생성 후 저장</p><button disabled={busy} onClick={()=>run(true)}>미리본 PDF 변경 저장</button></section>}
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
 </details>;
}
