import {Fragment, useEffect, useMemo, useRef, useState} from 'react';
import DOMPurify from 'dompurify';
import {renderMarkdown} from '../core/knowledge.mjs';
import {DOCUMENT_DRAG} from '../core/document-workspace.mjs';
import Editor from './Editor.jsx';
import DiagramPreview from './DiagramPreview.jsx';

function Pane({note, docKey, vault, scopeLabel, active, mode, onFocus, onClose, onDrop, limited, disabled, children}) {
  const [edge,setEdge]=useState(null);
  useEffect(()=>{const clear=()=>setEdge(null);window.addEventListener('dragend',clear);window.addEventListener('drop',clear);return()=>{window.removeEventListener('dragend',clear);window.removeEventListener('drop',clear);};},[]);
  const side=e=>e.clientX < e.currentTarget.getBoundingClientRect().x + e.currentTarget.clientWidth / 2 ? 'left' : 'right';
  return <section className={`document-pane ${active?'focused':''}`} role="region" aria-label={`문서 ${note.path}`} aria-description={scopeLabel} data-document-path={note.path} data-vault-id={vault.id}
    onFocusCapture={onFocus} onPointerDownCapture={onFocus}
    onDragOverCapture={e=>{if(disabled || !e.dataTransfer.types.includes(DOCUMENT_DRAG))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=limited?'none':'copy';setEdge(side(e));}}
    onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setEdge(null);}}
    onDropCapture={e=>{if(!e.dataTransfer.types.includes(DOCUMENT_DRAG))return;e.preventDefault();e.stopPropagation();setEdge(null);if(!disabled)onDrop(e.dataTransfer.getData(DOCUMENT_DRAG),side(e));}}>
    <div className="pane-heading"><span className="pane-title" draggable={!disabled} onDragStart={e=>{e.dataTransfer.setData(DOCUMENT_DRAG,docKey);e.dataTransfer.effectAllowed='copy';}}>
      {scopeLabel && <small className="pane-space" title={scopeLabel}>{scopeLabel}</small>}
      <span title={note.path}>{note.path}</span>
    </span><button aria-label={`${note.path} 영역 닫기`} disabled={disabled} onClick={onClose}>×</button></div>
    <div className={`document-content ${mode}`}>{children}</div>
    {edge&&<div className={`pane-drop-target ${edge}`} aria-live="polite">{limited?'최대 3개 문서까지 비교할 수 있습니다':`${edge==='left'?'왼쪽':'오른쪽'}에 문서 열기`}</div>}
  </section>;
}

function DocumentPane(props) {
  const {note,notes,vault,mode,active,onFocus,onContext,fonts,onFontSettings,onChange,onImportFiles,onLink,onPreviewLink,jump,disabled,pending,edits}=props;
  const editor=useRef(null),preview=useRef(null),selection=useRef(null);
  const [compare,setCompare]=useState(false);
  const context=()=>onContext(editor.current,preview.current,selection.current);
  const focus=()=>{if(!disabled){onFocus();context();}};
  useEffect(()=>{if(active)context();});
  const html=useMemo(()=>!["read","split"].includes(mode)?"":DOMPurify.sanitize(renderMarkdown(note.content,notes,note.path,{vaultId:vault.id,attachments:vault.attachments??[]}),{
    FORBID_TAGS:['iframe','style','form','svg','math'],ADD_ATTR:['data-note','data-external','data-anchor','data-attachment','data-attachment-fragment','data-task-line','data-embed'],ADD_URI_SAFE_ATTR:['src'],
  }),[note.content,note.path,notes,vault.id,vault.attachments,mode]);
  return <Pane {...props} onFocus={focus}>
    {pending&&<section className="copilot-live-banner" aria-label="AI 실시간 변경">
      <strong>AI · {edits.running?'작성 중':'미확정 변경'}</strong><p>노트 파일은 유지할 때 저장됩니다.</p>
      {pending.userEdited&&<p>직접 편집하여 AI 추가 반영을 멈췄습니다.</p>}{pending.conflict&&<p role="alert">{pending.conflict}</p>}
      <div className="copilot-live-actions"><button disabled={edits.running||edits.working} onClick={()=>edits.resolve(note.path,'keep')}>변경 유지</button><button disabled={edits.running||edits.working||pending.userEdited} onClick={()=>edits.resolve(note.path,'undo')}>변경 되돌리기</button>{edits.running&&<button onClick={edits.stop}>작성 중지</button>}<button onClick={()=>setCompare(!compare)}>원본·초안 비교</button>{(pending.userEdited||pending.conflict)&&<button disabled={edits.running||edits.working} onClick={()=>edits.resolve(note.path,'recover')}>복구본 저장</button>}</div>
      {compare&&<div className="copilot-live-comparison"><pre>{pending.original||'(새 문서)'}</pre><pre>{pending.aiContent}</pre></div>}
    </section>}
    <div className="editor-preview">
      {mode!=='read'&&<Editor note={note} notes={notes} journal={props.journalPaths?.has(note.path)} editorRef={editor} onSelection={value=>{selection.current=value;if(active)context();}} onChange={content=>onChange(note.path,content,vault.id)} pendingOriginal={pending?.original} fontSettings={fonts} onFontSettings={onFontSettings} onImportFiles={files=>onImportFiles(files,vault.id)} live={mode==='live'} vaultId={vault.id} attachments={vault.attachments} onLink={(target,kind)=>{if(!disabled){focus();onLink(target,kind,note.path,vault.id);}}} jump={active?jump:null} readOnly={disabled||props.captureLocked||edits.working}/>}
      {(mode==='read'||mode==='split')&&<DiagramPreview previewRef={preview} html={html} onClick={event=>{event.preventDefault();if(!disabled){focus();onPreviewLink(event,note.path,preview.current,vault.id);}}}/>}
    </div>
    {mode==='read'&&<div className="document-bottom"><button onClick={()=>{focus();props.onEdit();}}>이 문서 편집</button></div>}
  </Pane>;
}

export default function DocumentWorkspace({workspace,resolveDocument,onOpen,onAdd,onContext,...props}) {
  const [widths,setWidths]=useState({});
  const drag=useRef(null);
  const visible=workspace.paths.flatMap(key=>{
    const doc=resolveDocument(key);
    return doc ? [{...doc,key}] : [];
  });
  return <div className="document-workspace">
    {visible.map(({key,...doc},index)=><Fragment key={key}>
      {index>0&&<div className="document-separator" role="separator" aria-label="문서 영역 너비" aria-orientation="vertical" tabIndex={0}
        onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const previous=e.currentTarget.previousElementSibling;drag.current={x:e.clientX,width:previous.getBoundingClientRect().width,key:visible[index-1].key};}}
        onPointerMove={e=>{const start=drag.current;if(start)setWidths(old=>({...old,[start.key]:Math.max(180,Math.min(900,start.width+e.clientX-start.x))}));}}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
        onKeyDown={e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const key=visible[index-1].key;setWidths(old=>({...old,[key]:Math.max(180,Math.min(900,(old[key]??300)+(e.key==='ArrowRight'?30:-30)))}));}}/>}
      <div className="pane-slot" style={{flexBasis:widths[key]??0,flexGrow:widths[key]?0:1}}>
        <DocumentPane {...props} {...doc} docKey={key} mode={workspace.modes[key]??'live'} active={workspace.active===key} limited={visible.length>=3}
          onFocus={()=>{if(workspace.active!==key)onOpen(key);}} onContext={onContext}
          onClose={()=>workspace.dispatch({type:'close',path:key})} onDrop={(path,side)=>onAdd(path,side,key)}
          onEdit={()=>workspace.dispatch({type:'mode',path:key,mode:'live'})} pending={doc.edits.drafts.find(d=>d.path===doc.note.path)}/>
      </div>
    </Fragment>)}
  </div>;
}
