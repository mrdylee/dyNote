import MarkdownIt from 'markdown-it';
import {parseMetadata} from './metadata.mjs';
const parser=new MarkdownIt({html:false});
const fold=value=>value.normalize('NFC').toLowerCase();
export function journalSections(note) {
  const body=parseMetadata(note.content).body,base=note.content.length-body.length,offsets=[0];
  for(let i=0;i<body.length;i++)if(body[i]==='\n')offsets.push(i+1);
  const tokens=parser.parse(body,{}),headings=tokens.flatMap((t,i)=>t.type==='heading_open'?[{from:base+offsets[t.map[0]],end:base+(offsets[t.map[1]]??body.length),level:Number(t.tag.slice(1)),title:tokens[i+1].content}]:[]);
  const candidates=headings.filter(h=>h.level>1),root=headings.filter(h=>h.level===1);
  const level=root.length===1&&candidates.length?Math.min(...candidates.map(h=>h.level)):Math.min(...headings.map(h=>h.level));
  const top=headings.filter(h=>h.level===level),start=root.length===1&&level>1?root[0].end:base;
  const chunks=top.map((h,i)=>({from:h.from,to:top[i+1]?.from??note.content.length,title:h.title}));
  if(!top.length||note.content.slice(start,top[0].from).trim())chunks.unshift({from:start,to:top[0]?.from??note.content.length,title:'기록'});
  return chunks.filter(s=>note.content.slice(s.from,s.to).trim()).map(s=>({...s,excerpt:note.content.slice(s.from,s.to)}));
}
export function classificationSuggestions(note,notes) {
  const sourceFolder=note.path.split('/').slice(0,-1).join('/');
  const folders=[...new Set(notes.map(n=>n.path.split('/').slice(0,-1).join('/')).filter(p=>p&&p!==sourceFolder))];
  return journalSections(note).map(section=>{
    const text=fold(section.excerpt),title=fold(section.title);
    const ranked=folders.map(folder=>{
      const terms=fold(folder).split(/[\s/_.-]+/).filter(t=>t.length>1);
      const score=terms.reduce((n,term)=>n+(title.includes(term)?3:text.includes(term)?1:0),0);
      return {folder,score};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.folder.localeCompare(b.folder));
    const folder=ranked[0]?.folder;
    const name=section.title.replace(/[\\/\0<>:"|?*]/g,' ').replace(/^\.+|[. ]+$/g,'').trim().slice(0,100)||'기록';
    return {...section,sourcePath:note.path,sourceRevision:note.revision,targetPath:folder?`${folder}/${name}.md`:'',reason:folder?`내용과 “${folder}” 폴더 이름이 일치합니다.`:'일치하는 폴더가 없습니다. 저장 위치를 선택해 주세요.'};
  });
}
