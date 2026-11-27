import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {parsePdfFragment,pdfWikiLink} from '../core/pdf-links.mjs';
import {markerLines,markerOpacity,markerOutline} from '../core/pdf-marker.mjs';
import PdfPenColors from './PdfPenColors.jsx';
import PdfAnnotationTools from './PdfAnnotationTools.jsx';
GlobalWorkerOptions.workerSrc=workerUrl;

const wheelStep=40,gestureGap=160;
const minScale=0.5,maxScale=3,scaleStep=0.25;

export default function PdfViewer({bytes,path,fragment='',backlinks=[],onCopy,onOpenNote,onPreviewEdit,onApplyEdit,onBeginHighlighting}) {
  const canvas=useRef(null),textHost=useRef(null),textLayer=useRef(null);
  const scrollArea=useRef(null),entryEdge=useRef(null);
  const wheelGesture=useRef(null);
  const zoomAnchor=useRef(null),annotationMarker=useRef(null);
  const [pdf,setPdf]=useState(null),[page,setPage]=useState(1),[scale,setScale]=useState(1.25);
  const [target,setTarget]=useState(null),[selection,setSelection]=useState(null),[annotationRect,setAnnotationRect]=useState(null);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[ready,setReady]=useState(false);
  const [annotations,setAnnotations]=useState([]),viewportRef=useRef(null);
  const [pen,setPen]=useState(null),[penColor,setPenColor]=useState('#ffff00'),[strokes,setStrokes]=useState([]);
  const resumeView=useRef(null),strokeId=useRef(0);
  // Keep the text layer stable while successive strokes are written to the PDF.
  const displayBytes=pen?.bytes??bytes;
  const saving=strokes.some(stroke=>stroke.pending);
  const togglePen=()=>{
    setMessage('');setSelection(null);window.getSelection()?.removeAllRanges();
    if(!pen){setPen({bytes,save:onBeginHighlighting()});return;}
    if(bytes!==pen.bytes){
      const area=scrollArea.current;
      resumeView.current={bytes,fragment,left:area.scrollLeft,top:area.scrollTop};
    }
    setPen(null);setStrokes([]);
  };
  const pdfRects=(start,end,joinSpans=false)=>{
    const viewport=viewportRef.current,host=textHost.current?.getBoundingClientRect();
    if(!viewport||!host)return [];
    // Fully selected PDF.js spans can include layout boxes and spacing between columns.
    const rects=[],range=document.createRange();
    for(let i=start[0];i<=end[0];i++){
      const node=textLayer.current.textDivs[i]?.firstChild;
      if(!node?.length)continue;
      const from=i===start[0]?start[1]:0,to=i===end[0]?end[1]:node.length;
      const text=node.data.slice(from,to);
      if(!text.trim())continue;
      const leadingSpaces=text.length-text.trimStart().length;
      range.setStart(node,from+leadingSpaces);
      range.setEnd(node,from+text.trimEnd().length);
      for(const rect of range.getClientRects())if(rect.width>0&&rect.height>0)rects.push(rect);
    }
    return (joinSpans?markerLines(rects):rects).map(r=>{
      const a=viewport.convertToPdfPoint(r.left-host.left,r.top-host.top),b=viewport.convertToPdfPoint(r.right-host.left,r.bottom-host.top);
      return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
    });
  };
  useEffect(()=>{
    let disposed=false;const job=getDocument({data:new Uint8Array(displayBytes),isEvalSupported:false,enableXfa:false,useSystemFonts:true});
    setPdf(null);setError('');setReady(false);setAnnotations([]);setSelection(null);setAnnotationRect(null);viewportRef.current=null;
    job.promise.then(value=>{if(!disposed)setPdf(value);}).catch(e=>{if(!disposed)setError(e.message);});
    return()=>{disposed=true;job.destroy();};
  },[displayBytes]);
  const followFragment=useCallback(fragment=>{
    entryEdge.current='target';
    wheelGesture.current=null;
    try{const value=parsePdfFragment(fragment);setTarget(value);setPage(pdf?Math.min(value.page,pdf.numPages):value.page);setMessage(pdf&&value.page>pdf.numPages?'요청한 PDF 페이지가 없습니다.':'');}
    catch(e){setTarget(null);setPage(1);setMessage(e.message);}
  },[pdf]);
  useEffect(()=>{
    if(!pdf)return;
    const resume=resumeView.current;
    if(resume?.bytes===displayBytes && resume.fragment===fragment){
      entryEdge.current=resume;
      resumeView.current=null;
    }else followFragment(fragment);
  },[fragment,followFragment]);
  useLayoutEffect(()=>{
    if(annotationRect?.reveal)annotationMarker.current?.scrollIntoView({block:'center',inline:'nearest'});
  },[annotationRect]);
  const zoom=(direction,event)=>{
    zoomAnchor.current=null;
    if(event && viewportRef.current){
      const {clientX,clientY}=event,box=canvas.current.getBoundingClientRect();
      if(clientX>=box.left && clientX<box.right && clientY>=box.top && clientY<box.bottom){
        zoomAnchor.current={clientX,clientY,x:(clientX-box.left)/box.width,y:(clientY-box.top)/box.height};
      }
    }
    setScale(s=>Math.min(maxScale,Math.max(minScale,s+direction*scaleStep)));
  };
  const goToPage=(number,edge='top')=>{
    entryEdge.current=edge;
    setPage(number);
  };
  useEffect(()=>{
    const area=scrollArea.current;
    if(!area)return;
    const onWheel=event=>{
      if(event.metaKey||event.shiftKey||Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
      const forward=event.deltaY>0;
      let gesture=wheelGesture.current;
      if(!gesture||event.timeStamp-gesture.last>gestureGap||gesture.forward!==forward||gesture.zoom!==event.ctrlKey){
        gesture=wheelGesture.current={forward,zoom:event.ctrlKey,distance:0,turned:false};
      }
      gesture.last=event.timeStamp;
      // A line/page wheel tick is discrete. Pixel deltas may be tiny trackpad movements.
      const distance=event.deltaMode===WheelEvent.DOM_DELTA_PIXEL?Math.abs(event.deltaY):wheelStep;
      const decaying=distance<gesture.lastDistance;
      gesture.lastDistance=distance;
      if(event.ctrlKey){
        event.preventDefault();
        gesture.distance+=distance;
        if(gesture.distance>=wheelStep||!gesture.zoomed){
          zoom(forward?-1:1,event);
          gesture.distance=0;
          gesture.zoomed=true;
        }
        return;
      }
      const atEdge=forward?area.scrollHeight-area.clientHeight-area.scrollTop<=1:area.scrollTop<=1;
      const next=page+(forward?1:-1);
      if(!atEdge){gesture.distance=0;gesture.turned=false;return;}
      if(!pdf||next<1||next>pdf.numPages)return;
      event.preventDefault();
      if(entryEdge.current)return;
      if(gesture.turned && decaying)return;
      gesture.distance+=distance;
      // For a sustained precision scroll, travel one visible page between turns.
      const threshold=gesture.turned && distance<wheelStep
        ? Math.max(wheelStep,Math.min(area.clientHeight,canvas.current.clientHeight))
        : wheelStep;
      if(gesture.distance<threshold)return;
      gesture.turned=true;
      gesture.distance=0;
      goToPage(next,forward?'top':'bottom');
    };
    area.addEventListener('wheel',onWheel,{passive:false});
    return()=>area.removeEventListener('wheel',onWheel);
  },[pdf,page]);
  useEffect(()=>{
    if(!pdf || page>pdf.numPages)return;
    let cancelled=false,render,layer;
    setReady(false);setSelection(null);setAnnotationRect(null);setAnnotations([]);
    const run=async()=>{
      const p=await pdf.getPage(page);if(cancelled)return;
      const viewport=p.getViewport({scale}),targetCanvas=canvas.current,host=textHost.current;
      viewportRef.current=viewport;
      targetCanvas.width=viewport.width;targetCanvas.height=viewport.height;
      host.parentElement.style.width=`${viewport.width}px`;host.parentElement.style.height=`${viewport.height}px`;
      const edge=entryEdge.current;
      const anchor=zoomAnchor.current;
      zoomAnchor.current=null;
      if(edge){
        const area=scrollArea.current;
        if(typeof edge==='object')area.scrollTo(edge.left,edge.top);
        else area.scrollTop=edge==='bottom'?area.scrollHeight:0;
        entryEdge.current=null;
      }else if(anchor){
        const box=targetCanvas.getBoundingClientRect();
        scrollArea.current.scrollBy(box.left+anchor.x*box.width-anchor.clientX,box.top+anchor.y*box.height-anchor.clientY);
      }
      host.style.setProperty('--total-scale-factor',String(scale));host.replaceChildren();
      const content=await p.getTextContent();if(cancelled)return;
      render=p.render({canvasContext:targetCanvas.getContext('2d'),viewport});
      layer=new TextLayer({textContentSource:content,container:host,viewport});textLayer.current=layer;
      await Promise.all([render.promise,layer.render()]);if(cancelled)return;
      for(const span of layer.textDivs){
        if(span.textContent && !span.textContent.trim())span.classList.add('pdf-spacing');
      }
      setReady(true);
      const annotations=await p.getAnnotations();if(cancelled)return;setAnnotations(annotations);
      if(target?.page===page && target.selection) {
        const [a,ao,b,bo]=target.selection,first=layer.textDivs[a],last=layer.textDivs[b];
        if(first?.firstChild&&last?.firstChild&&ao<=first.textContent.length&&bo<=last.textContent.length) {
          const range=window.document.createRange();range.setStart(first.firstChild,ao);range.setEnd(last.firstChild,bo);
          const browserSelection=window.getSelection();browserSelection.removeAllRanges();browserSelection.addRange(range);
          setSelection({range:target.selection,text:browserSelection.toString(),rects:pdfRects([a,ao],[b,bo])});
          if(edge==='target')first.scrollIntoView({block:'center',inline:'nearest'});
        } else setMessage('이 문서에서 링크의 선택 영역을 찾을 수 없습니다.');
      }
      if(target?.page===page && target.annotation) {
        const annotation=annotations.find(a=>a.id===target.annotation || a.annotationName===target.annotation);
        if(annotation?.rect){
          const [left,top]=viewport.convertToViewportPoint(annotation.rect[0],annotation.rect[1]);
          const [right,bottom]=viewport.convertToViewportPoint(annotation.rect[2],annotation.rect[3]);
          const rect={left:Math.min(left,right),top:Math.min(top,bottom),width:Math.abs(right-left),height:Math.abs(bottom-top)};
          setAnnotationRect({style:rect,reveal:edge==='target'});
        }
        else setMessage('이 페이지에서 링크의 PDF 주석을 찾을 수 없습니다.');
      }
    };
    run().catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException'&&e.name!=='AbortException')setError(e.message);});
    return()=>{cancelled=true;render?.cancel();layer?.cancel();if(textLayer.current===layer)textLayer.current=null;};
  },[pdf,page,scale,target]);
  const captureSelection=event=>{
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
    if(pen){
      if(event.type!=='mouseup'||event.button!==0||!ready||!start||!end||!selected.toString().trim())return;
      const rects=pdfRects(start,end,true);
      if(!rects.length)return;
      const viewport=viewportRef.current;
      const styleRects=rects.map(rect=>{
        const [x1,y1]=viewport.convertToViewportPoint(rect[0],rect[1]),[x2,y2]=viewport.convertToViewportPoint(rect[2],rect[3]);
        const left=Math.min(x1,x2),top=Math.min(y1,y2),width=Math.abs(x2-x1),height=Math.abs(y2-y1);
        const outline=markerOutline(rect).map(([x,y])=>{
          const [vx,vy]=viewport.convertToViewportPoint(x,y);
          return `${100*(vx-left)/width}% ${100*(vy-top)/height}%`;
        });
        return {left:`${100*left/viewport.width}%`,top:`${100*top/viewport.height}%`,
          width:`${100*width/viewport.width}%`,height:`${100*height/viewport.height}%`,clipPath:`polygon(${outline.join(',')})`};
      });
      const id=++strokeId.current;
      setStrokes(old=>[...old,{id,page,color:penColor,styleRects,pending:true}]);
      selected.removeAllRanges();
      pen.save({page,color:penColor,rects,penStroke:true}).then(()=>{
        setStrokes(old=>old.map(stroke=>stroke.id===id?{...stroke,pending:false}:stroke));
      }).catch(e=>{
        setStrokes(old=>old.filter(stroke=>stroke.id!==id));
        setMessage(`형광펜 저장 실패 · ${e.message}`);
      });
      return;
    }
    setSelection(start&&end?{range:[...start,...end],text:selected.toString(),rects:pdfRects(start,end)}:null);
  };
  const copy=async withSelection=>{
    try{await onCopy(pdfWikiLink(path,page,withSelection?selection?.range:null));setMessage('PDF 링크를 복사했습니다.');}
    catch(e){setMessage(e.message);}
  };
  return <div className="pdf-viewer">
    {error?<p role="alert">PDF를 열 수 없습니다: {error}</p>:<>
      <div className="pdf-toolbar">
        {onBeginHighlighting&&<button aria-pressed={!!pen} disabled={!ready||saving} onClick={togglePen}>형광펜</button>}
        {pen&&<><PdfPenColors value={penColor} onChange={setPenColor}/><span role="status">{saving?'저장 중…':strokes.length?'저장됨':'문장을 드래그하세요'}</span></>}
        <button disabled={!pdf||page===1} onClick={()=>goToPage(page-1)}>이전 페이지</button>
        <label>PDF 페이지<input aria-label="PDF 페이지" type="number" min="1" max={pdf?.numPages||1} value={page} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=1&&n<=pdf?.numPages&&n!==page)goToPage(n);}}/></label>
        <span>{pdf?`/ ${pdf.numPages}`:'PDF 불러오는 중…'}</span>
        <button disabled={!pdf||page===pdf.numPages} onClick={()=>goToPage(page+1)}>다음 페이지</button>
        <button aria-label="PDF 축소" title="PDF 축소 (Ctrl + 휠 아래)" disabled={scale<=minScale} onClick={()=>zoom(-1)}>−</button><span>{Math.round(scale*100)}%</span><button aria-label="PDF 확대" title="PDF 확대 (Ctrl + 휠 위)" disabled={scale>=maxScale} onClick={()=>zoom(1)}>+</button>
        {onCopy&&<><button disabled={!ready} onClick={()=>copy(false)}>페이지 링크 복사</button><button disabled={!ready||!selection?.text} onClick={()=>copy(true)}>선택 영역 링크 복사</button></>}
      </div>
      {message&&<p role="status" className="pdf-message">{message}</p>}
      {selection?.text&&<p className="pdf-selected-text">선택: {selection.text}</p>}
      {onPreviewEdit&&!pen&&<PdfAnnotationTools penColor={penColor} onPenColor={setPenColor} path={path} page={page} selection={selection} annotations={annotations} onPreview={onPreviewEdit} onApply={onApplyEdit} onFollow={followFragment} onCopy={onCopy}/>}
      <div ref={scrollArea} className="pdf-scroll-area">
        <div className="pdf-page" aria-busy={!ready}><canvas ref={canvas} aria-label={`PDF ${page}페이지`}/><div ref={textHost} className="native-pdf-text" style={pen?{'--pdf-selection-color':penColor}:undefined} onMouseUp={captureSelection} onKeyUp={captureSelection} tabIndex={0} aria-label="PDF 텍스트"/>
          {strokes.filter(stroke=>stroke.page===page).map(stroke=>stroke.styleRects.map((rect,i)=><div key={`${stroke.id}-${i}`} className="pdf-pen-stroke" style={{...rect,backgroundColor:stroke.color,opacity:markerOpacity}}/>))}
          {annotationRect&&<div ref={annotationMarker} className="pdf-annotation-target" aria-label="PDF 링크 주석" style={annotationRect.style}/>}</div>
      </div>
      {onOpenNote&&<section className="pdf-backlinks" aria-label="PDF 백링크"><h3>이 PDF를 연결한 기록 · {backlinks.length}</h3>{backlinks.map((link,i)=><div key={`${link.notePath}:${i}`}><button onClick={()=>onOpenNote(link.notePath)}>{link.notePath}</button><button onClick={()=>followFragment(link.fragment)}>{link.fragment||'첫 페이지'}</button></div>)}</section>}
    </>}
  </div>;
}
