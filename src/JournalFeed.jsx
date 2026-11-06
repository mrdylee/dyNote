import {useEffect,useMemo,useRef,useState} from 'react';
import DOMPurify from 'dompurify';
import {localDate,periodicNote,periodicContent,periodicEntries} from '../core/periodic-notes.mjs';
import {renderMarkdown} from '../core/knowledge.mjs';
import DiagramPreview from './DiagramPreview.jsx';
import Editor from './Editor.jsx';
import CopilotJournalEntries,{CopilotJournalToolbar} from './CopilotJournalEntries.jsx';
import {withoutCaptureLinks} from '../core/copilot-journal-links.mjs';
export default function JournalFeed({notes,preferences,vault,onOpen,onChange,onImportFiles,onLink,jump,fonts,onFontSettings,disabled,capture}) {
  const [today,setToday]=useState(localDate),[count,setCount]=useState(14);
  const editor=useRef(null);
  useEffect(()=>{
    const view=editor.current;
    if(view&&!disabled){
      view.dispatch({selection:{anchor:view.state.doc.length},scrollIntoView:true});
      view.focus();
    }
    const timer=setInterval(()=>{if(!editor.current?.hasFocus)setToday(localDate());},30000);
    return()=>clearInterval(timer);
  },[]);
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
  const entries=useMemo(()=>periodicEntries(notes,'daily',{...preferences.daily,locale:preferences.locale})
    .filter(note=>note.date<=today&&note.path!==target?.path).reverse(),[notes,preferences,today,target]);
  return <section className="journal-feed" aria-label="저널 피드"><header><h1>저널</h1><p>오늘의 기록을 남기고, 나중에 폴더별로 정리하세요.</p></header>
    {capture&&<CopilotJournalToolbar {...capture} disabled={disabled}/>}
    {(error||templateError)&&<p role="alert">{error||templateError}</p>}
    {current&&<article className="journal-entry" data-document-path={current.path} data-vault-id={vault.id}>
      <header><h2>{today}</h2></header>
      {capture&&<CopilotJournalEntries records={capture.state?.records?.filter(record=>record.journalPath===current.path)} disabled={disabled} onOpen={onOpen} onTrash={capture.onTrash}/>}
      <Editor key={current.path} note={current} notes={notes} journal live editorRef={editor}
        onChange={content=>onChange(current.path,content)} vaultId={vault.id} attachments={vault.attachments}
        onImportFiles={onImportFiles} onLink={(target,kind)=>onLink(target,kind,current.path,vault.id)}
        jump={jump} fontSettings={fonts} onFontSettings={onFontSettings} readOnly={disabled}/>
    </article>}
    {entries.slice(0,count).map(note=><article className="journal-entry" key={note.path} data-document-path={note.path} data-vault-id={vault.id}>
      <header><h2><button className="journal-date" disabled={disabled} onClick={()=>onOpen(note.path)}>{note.date}</button></h2></header>
      {capture&&<CopilotJournalEntries records={capture.state?.records?.filter(record=>record.journalPath===note.path)} disabled={disabled} onOpen={onOpen} onTrash={capture.onTrash}/>}
      <DiagramPreview html={DOMPurify.sanitize(renderMarkdown(withoutCaptureLinks(note.content),notes,note.path,{vaultId:vault.id,attachments:vault.attachments??[]}),{FORBID_TAGS:['input','iframe','form','style'],ADD_ATTR:['data-note'],ADD_URI_SAFE_ATTR:['src']})} onClick={e=>{if(e.target.closest('a'))e.preventDefault();}}/>
    </article>)}
    {entries.length>count&&<button onClick={()=>setCount(count+14)}>이전 기록 더 보기</button>}
  </section>;
}
