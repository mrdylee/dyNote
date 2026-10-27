import {useMemo} from 'react';
import DOMPurify from 'dompurify';
import {renderMarkdown,parseMetadata} from '../core/knowledge.mjs';
export default function NoteHover({note,notes,vault,position,onOpen,onEnter,onLeave}) {
  const html=useMemo(()=>DOMPurify.sanitize(renderMarkdown('\n'+parseMetadata(note.content).body.slice(0,4000),notes,note.path,{vaultId:vault.id,attachments:vault.attachments||[],readonly:true,compactPreview:true}),{FORBID_TAGS:['iframe','style','form','svg','math'],ADD_ATTR:['data-note','data-attachment','data-task-line']}),[note.content,note.path,notes,vault]);
  return <aside className="note-hover" role="dialog" aria-label="링크 문서 미리보기" style={position} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <strong>{note.title}</strong><article className="markdown-preview note-hover-body" dangerouslySetInnerHTML={{__html:html}}/><button onClick={onOpen}>이 문서 열기</button>
  </aside>;
}
