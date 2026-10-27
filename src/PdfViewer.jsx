import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {parsePdfFragment,pdfWikiLink} from '../core/pdf-links.mjs';
GlobalWorkerOptions.workerSrc=workerUrl;

export default function PdfViewer({bytes,path,fragment='',backlinks=[],onCopy,onOpenNote,onFollow}) {
  const canvas=useRef(null),textHost=useRef(null),textLayer=useRef(null);
  const [pdf,setPdf]=useState(null),[page,setPage]=useState(1),[scale,setScale]=useState(1.25);
  const [target,setTarget]=useState(null),[selection,setSelection]=useState(null),[annotationRect,setAnnotationRect]=useState(null);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[ready,setReady]=useState(false);
  useEffect(()=>{
    let disposed=false;const job=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false,useSystemFonts:true});
    setPdf(null);setError('');
    job.promise.then(value=>{if(!disposed)setPdf(value);}).catch(e=>{if(!disposed)setError(e.message);});
    return()=>{disposed=true;job.destroy();};
  },[bytes]);
  useEffect(()=>{
    try{const value=parsePdfFragment(fragment);setTarget(value);setPage(pdf?Math.min(value.page,pdf.numPages):value.page);setMessage(pdf&&value.page>pdf.numPages?'요청한 PDF 페이지가 없습니다.':'');}
    catch(e){setTarget(null);setPage(1);setMessage(e.message);}
  },[fragment,pdf]);
  useEffect(()=>{
    if(!pdf || page>pdf.numPages)return;
    let cancelled=false,render,layer;
    setReady(false);setSelection(null);setAnnotationRect(null);
    const run=async()=>{
      const p=await pdf.getPage(page);if(cancelled)return;
      const viewport=p.getViewport({scale}),targetCanvas=canvas.current,host=textHost.current;
      targetCanvas.width=viewport.width;targetCanvas.height=viewport.height;
      host.parentElement.style.width=`${viewport.width}px`;host.parentElement.style.height=`${viewport.height}px`;
      host.style.setProperty('--total-scale-factor',String(scale));host.replaceChildren();
      const content=await p.getTextContent();if(cancelled)return;
      render=p.render({canvasContext:targetCanvas.getContext('2d'),viewport});
      layer=new TextLayer({textContentSource:content,container:host,viewport});textLayer.current=layer;
      await Promise.all([render.promise,layer.render()]);if(cancelled)return;
      setReady(true);
      if(target?.page===page && target.selection) {
        const [a,ao,b,bo]=target.selection,first=layer.textDivs[a],last=layer.textDivs[b];
        if(first?.firstChild&&last?.firstChild&&ao<=first.textContent.length&&bo<=last.textContent.length) {
          const range=window.document.createRange();range.setStart(first.firstChild,ao);range.setEnd(last.firstChild,bo);
          const browserSelection=window.getSelection();browserSelection.removeAllRanges();browserSelection.addRange(range);
          setSelection({range:target.selection,text:browserSelection.toString()});first.scrollIntoView({block:'center',inline:'nearest'});
        } else setMessage('이 문서에서 링크의 선택 영역을 찾을 수 없습니다.');
      }
      if(target?.page===page && target.annotation) {
        const annotations=await p.getAnnotations();if(cancelled)return;
        const annotation=annotations.find(a=>a.id===target.annotation || a.annotationName===target.annotation);
        if(annotation?.rect){const [x1,y1]=viewport.convertToViewportPoint(annotation.rect[0],annotation.rect[1]),[x2,y2]=viewport.convertToViewportPoint(annotation.rect[2],annotation.rect[3]);setAnnotationRect({left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)});}
        else setMessage('이 페이지에서 링크의 PDF 주석을 찾을 수 없습니다.');
      }
    };
    run().catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException'&&e.name!=='AbortException')setError(e.message);});
    return()=>{cancelled=true;render?.cancel();layer?.cancel();if(textLayer.current===layer)textLayer.current=null;};
  },[pdf,page,scale,target]);
  const captureSelection=()=>{
    const selected=window.getSelection(),layer=textLayer.current;
    if(!layer || !selected?.rangeCount || selected.isCollapsed){setSelection(null);return;}
    const range=selected.getRangeAt(0);
    const locate=(node,offset)=>{
      const index=layer.textDivs.findIndex(span=>span===node || span.contains(node));
      if(index<0)return null;
      const before=window.document.createRange();before.selectNodeContents(layer.textDivs[index]);before.setEnd(node,offset);
      return [index,before.toString().length];
    };
    const start=locate(range.startContainer,range.startOffset),end=locate(range.endContainer,range.endOffset);
    setSelection(start&&end?{range:[...start,...end],text:selected.toString()}:null);
  };
  const copy=async withSelection=>{
    try{await onCopy(pdfWikiLink(path,page,withSelection?selection?.range:null));setMessage('PDF 링크를 복사했습니다.');}
    catch(e){setMessage(e.message);}
  };
  return <div className="pdf-viewer">
    {error?<p role="alert">PDF를 열 수 없습니다: {error}</p>:<>
      <div className="pdf-toolbar">
        <button disabled={!pdf||page===1} onClick={()=>setPage(p=>p-1)}>이전 페이지</button>
        <label>PDF 페이지<input aria-label="PDF 페이지" type="number" min="1" max={pdf?.numPages||1} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=pdf?.numPages)setPage(n);}}/></label>
        <span>{pdf?`/ ${pdf.numPages}`:'PDF 불러오는 중…'}</span>
        <button disabled={!pdf||page===pdf.numPages} onClick={()=>setPage(p=>p+1)}>다음 페이지</button>
        <button aria-label="PDF 축소" disabled={scale<=0.5} onClick={()=>setScale(s=>s-0.25)}>−</button><span>{Math.round(scale*100)}%</span><button aria-label="PDF 확대" disabled={scale>=3} onClick={()=>setScale(s=>s+0.25)}>+</button>
        <button disabled={!ready} onClick={()=>copy(false)}>페이지 링크 복사</button><button disabled={!ready||!selection?.text} onClick={()=>copy(true)}>선택 영역 링크 복사</button>
      </div>
      {message&&<p role="status" className="pdf-message">{message}</p>}
      {selection?.text&&<p className="pdf-selected-text">선택: {selection.text}</p>}
      <div className="pdf-page" aria-busy={!ready}><canvas ref={canvas} aria-label={`PDF ${page}페이지`}/><div ref={textHost} className="native-pdf-text" onMouseUp={captureSelection} onKeyUp={captureSelection} tabIndex={0} aria-label="PDF 텍스트"/>{annotationRect&&<div className="pdf-annotation-target" aria-label="PDF 링크 주석" style={annotationRect}/>}</div>
      <section className="pdf-backlinks" aria-label="PDF 백링크"><h3>이 PDF를 연결한 기록 · {backlinks.length}</h3>{backlinks.map((link,i)=><div key={`${link.notePath}:${i}`}><button onClick={()=>onOpenNote(link.notePath)}>{link.notePath}</button><button onClick={()=>onFollow(link.fragment)}>{link.fragment||'첫 페이지'}</button></div>)}</section>
    </>}
  </div>;
}
