import { fileLocationRef } from "./file-location.mjs";
import {useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {periodicNote,periodicContent,periodicEntries} from '../core/periodic-notes.mjs';
import {renderMarkdown} from '../core/knowledge.mjs';
import {documentKey} from '../core/document-workspace.mjs';
import DiagramPreview from './DiagramPreview.jsx';
import Editor from './Editor.jsx';
import CopilotJournalEntries,{CopilotJournalToolbar} from './CopilotJournalEntries.jsx';
import {captureLinkRanges,withoutCaptureLinks} from '../core/copilot-journal-links.mjs';

function ReceivedLinks({note,records,notes,onOpen}) {
  const known=new Set((records ?? []).filter(r=>r.journalPath===note.path).flatMap(r=>r.sessions.map(s=>s.path)));
  const links=new Map();
  for(const {link} of captureLinkRanges(note.content)){
    const match=/^- \[\[([^|]+)\|([^\]]+)\]\]$/.exec(link.text);
    if(match && !known.has(match[1]))links.set(match[1],match[2]);
  }
  return [...links].map(([name,title])=>notes.some(n=>n.path===name)
    ? <button className="capture-record-title" key={name} onClick={()=>onOpen(name)}>{title}</button>
    : <p key={name}>연결된 대화 파일 확인 필요 · {title}</p>);
}
export default function JournalFeed({notes,preferences,vault,currentDate,pendingDate,conflicts,onReview,onOpen,onChange,onImportFiles,onLink,jump,fonts,onFontSettings,disabled,isPathLocked,capture}) {
  const [editingDate,setEditingDate]=useState(null),[count,setCount]=useState(14);
  const today=editingDate??currentDate;
  const editor=useRef(null),focused=useRef(false);
  const {target,error}=useMemo(()=>{
    try{return {target:periodicNote('daily',today,{...preferences.daily,locale:preferences.locale})};}
    catch(e){return {error:e.message};}
  },[preferences,today]);
  const todayNote=notes.find(note=>note.path===target?.path);
  const {draft,templateError}=useMemo(()=>{
    if(!target||todayNote)return {};
    try{return {draft:{...target,content:periodicContent(target,preferences,notes)}};}
    catch(e){return {templateError:e.message};}
  },[target,todayNote,preferences,notes]);
  const current=todayNote??draft;
  const readOnly=disabled||isPathLocked?.(current?.path)||(!todayNote&&today===pendingDate);
  useEffect(()=>{
    const view=editor.current;
    if(!view||readOnly||focused.current)return;
    focused.current=true;
    view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});
    view.focus();
  },[current?.path,readOnly]);
  const entries=useMemo(()=>periodicEntries(notes,'daily',{...preferences.daily,locale:preferences.locale})
    .filter(note=>note.date<=today&&note.path!==target?.path).reverse(),[notes,preferences,today,target]);
  function conflictNotice(path) {
    const conflict=conflicts?.find(file=>file.name===path);
    return conflict&&<div className="classification-notice" role="status">
      <span>이 날짜의 편집 내용이 겹쳤습니다. 버전을 선택할 때까지 공유 중인 본문이 표시되고, 추가 편집은 동기화할 때 별도 버전으로 보관됩니다.</span>
      <button onClick={()=>onReview(path)}>버전 확인 · {conflict.count}개</button>
    </div>;
  }
  return <section className="journal-feed" aria-label="저널 피드"><header><h1>저널</h1><p>오늘의 기록을 남기고, 나중에 폴더별로 정리하세요.</p></header>
    {capture&&<CopilotJournalToolbar {...capture} disabled={disabled}/>}
    {(error||templateError)&&<p role="alert">{error||templateError}</p>}
    {current&&<article className="journal-entry" ref={fileLocationRef(todayNote?.revision ? documentKey(vault.id,current.path) : undefined)} data-document-path={current.path} data-vault-id={vault.id}
      onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setEditingDate(null);}}>
      <header><h2>{today}</h2></header>
      {conflictNotice(current.path)}
      <ReceivedLinks note={current} notes={notes} records={capture?.state?.records} onOpen={onOpen}/>
      {capture&&<CopilotJournalEntries records={capture.state?.records?.filter(record=>record.journalPath===current.path)} disabled={disabled} onOpen={onOpen} onTrash={capture.onTrash}/>}
      <Editor key={current.path} note={current} notes={notes} journal live editorRef={editor}
        onChange={content=>{setEditingDate(today);onChange(current.path,content);}} vaultId={vault.id} attachments={vault.attachments}
        onImportFiles={onImportFiles} onLink={(target,kind)=>onLink(target,kind,current.path,vault.id)}
        jump={jump} fontSettings={fonts} onFontSettings={onFontSettings} readOnly={readOnly}/>
    </article>}
    {entries.slice(0,count).map(note=><article className="journal-entry" key={note.path} ref={fileLocationRef(note.revision ? documentKey(vault.id,note.path) : undefined)} data-document-path={note.path} data-vault-id={vault.id}>
      <header><h2><button className="journal-date" disabled={disabled} onClick={()=>onOpen(note.path)}>{note.date}</button></h2></header>
      {conflictNotice(note.path)}
      <ReceivedLinks note={note} notes={notes} records={capture?.state?.records} onOpen={onOpen}/>
      {capture&&<CopilotJournalEntries records={capture.state?.records?.filter(record=>record.journalPath===note.path)} disabled={disabled} onOpen={onOpen} onTrash={capture.onTrash}/>}
      <DiagramPreview html={DOMPurify.sanitize(renderMarkdown(withoutCaptureLinks(note.content),notes,note.path,{vaultId:vault.id,attachments:vault.attachments??[]}),{FORBID_TAGS:['input','iframe','form','style'],ADD_ATTR:['data-note'],ADD_URI_SAFE_ATTR:['src']})} onClick={e=>{if(e.target.closest('a'))e.preventDefault();}}/>
    </article>)}
    {entries.length>count&&<button onClick={()=>setCount(count+14)}>이전 기록 더 보기</button>}
  </section>;
}
