import {useEffect,useMemo,useState} from 'react';
import DOMPurify from 'dompurify';
import {localDate,periodicNote,periodicEntries} from '../core/periodic-notes.mjs';
import {renderMarkdown} from '../core/knowledge.mjs';
import DiagramPreview from './DiagramPreview.jsx';
export default function JournalFeed({notes,preferences,vault,onOpen,onCreate,disabled}) {
  const [today,setToday]=useState(localDate),[count,setCount]=useState(14);
  useEffect(()=>{const id=setInterval(()=>setToday(localDate()),30000);return()=>clearInterval(id);},[]);
  const daily={...preferences.daily,locale:preferences.locale};
  const entries=useMemo(()=>periodicEntries(notes,'daily',daily).filter(n=>n.date<=today).reverse(),[notes,preferences,today]);
  let target,error;try{target=periodicNote('daily',today,daily);}catch(e){error=e.message;}
  return <section className="journal-feed" aria-label="저널 피드"><header><h1>저널</h1><p>오늘의 기록을 남기고, 나중에 폴더별로 정리하세요.</p></header>
    {error?<p role="alert">{error}</p>:!entries.some(n=>n.path===target.path)&&<article className="journal-entry"><h2>{today}</h2><p>아직 오늘의 기록이 없습니다.</p><button className="primary-button" disabled={disabled} onClick={()=>onCreate(target)}>오늘 기록 시작</button></article>}
    {entries.slice(0,count).map(note=><article className="journal-entry" key={note.path} data-document-path={note.path}><header><h2>{note.date}</h2><button disabled={disabled} onClick={()=>onOpen(note.path)}>이 기록 편집</button></header>
      <DiagramPreview renderDiagrams={false} html={DOMPurify.sanitize(renderMarkdown(note.content,notes,note.path,{vaultId:vault.id,attachments:vault.attachments??[]}),{FORBID_TAGS:['input','iframe','form','style'],ADD_ATTR:['data-note'],ADD_URI_SAFE_ATTR:['src']})} onClick={e=>{if(e.target.closest('a'))e.preventDefault();}}/>
    </article>)}
    {entries.length>count&&<button onClick={()=>setCount(count+14)}>이전 기록 더 보기</button>}
  </section>;
}
