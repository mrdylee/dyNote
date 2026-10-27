import path from 'node:path';
import MarkdownIt from 'markdown-it';
import {parseDocument} from 'yaml';
import {validNotePath} from './vault.mjs';
import {buildKnowledge} from './knowledge.mjs';
import {parseMetadata,updateMetadata} from './metadata.mjs';
import {scanLinks,resolvePath} from './links.mjs';
import {parseCanvas} from './canvas.mjs';
import {headingId} from './headings.mjs';
const parser=new MarkdownIt({html:false});
const limit=8*1024*1024;
const fold=value=>value.normalize('NFC').toLowerCase();
function offsets(content){const result=[0];for(let i=0;i<content.length;i++)if(content[i]==='\n')result.push(i+1);return result;}
function subpaths(source,from,to){
  const lines=offsets(source.content),headings=new Set(),blocks=new Set();
  for(const heading of source.headings)if(lines[heading.line]>=from&&lines[heading.line]<to){headings.add(headingId(heading.text));headings.add(headingId(heading.plainText));headings.add(heading.id);}
  const metadata=parseMetadata(source.content),excluded=new Set();
  for(const token of parser.parse(metadata.body,{}))if(['fence','code_block'].includes(token.type)&&token.map)for(let i=token.map[0];i<token.map[1];i++)excluded.add(i+metadata.offset);
  const textLines=source.content.split('\n');
  for(let i=0;i<textLines.length;i++)if(!excluded.has(i)&&lines[i]>=from&&lines[i]+textLines[i].length<=to){const match=textLines[i].match(/(?:^|\s)\^([\w-]+)\s*$/);if(match)blocks.add(match[1]);}
  return fragment=>{let decoded;try{decoded=decodeURIComponent(fragment.replace(/^#/,''));}catch{return false;}return decoded.startsWith('^')?blocks.has(decoded.slice(1)):!!decoded&&headings.has(headingId(decoded));};
}
function relocate(content,from,to,files,redirect){
  let result=content;
  for(const link of scanLinks(content).reverse()){
    const resolved=resolvePath(link.target,from,files,{kind:link.kind});if(resolved.status!=='resolved')continue;
    const fragment=link.target.match(/[#^].*$/)?.[0] || '',destination=redirect(resolved.path,fragment);
    if(destination===resolved.path&&from===to)continue;
    const name=link.kind==='wiki'?destination.replace(/\.md$/i,''):path.posix.relative(path.posix.dirname(to),destination);
    const target=name.split('/').map(encodeURIComponent).join('/')+fragment,start=link.targetStart??link.raw.indexOf(link.target),end=link.targetEnd??start+link.target.length;
    result=result.slice(0,link.start)+link.raw.slice(0,start)+target+link.raw.slice(end)+result.slice(link.end);
  }
  return result;
}
function combineMetadata(target,source,body){
  const a=parseMetadata(target),b=parseMetadata(source);if(a.error||b.error)throw new Error(a.error||b.error);
  const doc=parseDocument(a.yaml||'');
  for(const [key,value]of Object.entries(b.properties)){
    const previous=a.properties[key];
    const merged=Array.isArray(previous)&&Array.isArray(value)?[...previous,...value].filter((item,index,list)=>list.findIndex(other=>JSON.stringify(other)===JSON.stringify(item))===index):value;
    doc.set(key,merged);
  }
  if(!Object.keys(a.properties).length&&!Object.keys(b.properties).length&&!a.yaml&&!b.yaml)return (target.startsWith('\uFEFF')?'\uFEFF':'')+body;
  const header=updateMetadata(target,doc.toString()),oldBody=parseMetadata(header).body;
  return header.slice(0,header.length-oldBody.length)+body;
}
function joinBody(first,second,eol){if(!first)return second;if(!second)return first;return first+(first.endsWith(eol+eol)?'':first.endsWith(eol)?eol:eol+eol)+second;}
function plan(capture,input){
  if(!input||!['merge','extract','extract-heading'].includes(input.kind))throw new Error('문서 작업을 선택해 주세요.');
  if(!validNotePath(input.sourcePath)||!validNotePath(input.targetPath)||fold(input.sourcePath)===fold(input.targetPath))throw new Error('서로 다른 올바른 Markdown 경로를 입력해 주세요.');
  if(capture.warnings.length)throw new Error(`읽을 수 없는 문서를 먼저 확인해 주세요: ${capture.warnings[0]}`);
  const notes=capture.notes;
  const model=buildKnowledge(notes),files=[...model.notes,...capture.documents,...capture.attachments];
  const source=model.notes.find(n=>n.path===input.sourcePath),target=model.notes.find(n=>n.path===input.targetPath);
  if(!source)throw new Error('원본 문서를 찾을 수 없습니다.');
  if(input.sourceRevision&&input.sourceRevision!==source.revision)throw new Error('원본 문서가 변경되었습니다. 새로고침해 주세요.');
  const changes=new Map(),eol=source.content.includes('\r\n')?'\r\n':'\n';let normalized;
  if(input.kind==='merge'){
    if(!target)throw new Error('합칠 대상 문서를 선택해 주세요.');
    if(input.position!==undefined&&!['append','prepend'].includes(input.position))throw new Error('합칠 위치를 선택해 주세요.');
    const redirect=value=>value===source.path?target.path:value,targetEol=target.content.includes('\r\n')?'\r\n':'\n';
    const sourceBody=relocate(parseMetadata(source.content).body.replace(/^\uFEFF/,''),source.path,target.path,files,redirect).replace(/\r\n|\r|\n/g,targetEol),targetBody=parseMetadata(target.content).body.replace(/^\uFEFF/,'');
    const body=input.position==='prepend'?joinBody(sourceBody,targetBody,targetEol):joinBody(targetBody,sourceBody,targetEol);
    changes.set(target.path,relocate(combineMetadata(target.content,source.content,body),target.path,target.path,files,redirect));changes.set(source.path,null);
    for(const note of model.notes)if(note.path!==source.path&&note.path!==target.path){const content=relocate(note.content,note.path,note.path,files,redirect);if(content!==note.content)changes.set(note.path,content);}
    normalized={kind:'merge',sourcePath:source.path,targetPath:target.path,position:input.position||'append',sourceRevision:source.revision};
  }else{
    if(files.some(f=>fold(f.path)===fold(input.targetPath)))throw new Error('같은 이름의 문서가 이미 있습니다.');
    let {from,to}=input;
    if(input.kind==='extract-heading'){
      if(!Number.isInteger(input.headingLine)||input.headingLine<0)throw new Error('추출할 제목을 선택해 주세요.');
      const heading=source.headings.findLast(h=>h.line<=input.headingLine);if(!heading)throw new Error('추출할 제목이 없습니다.');
      const lineOffsets=offsets(source.content),index=source.headings.indexOf(heading),next=source.headings.slice(index+1).find(h=>h.level<=heading.level);
      from=lineOffsets[heading.line];to=next?lineOffsets[next.line]:source.content.length;
    }
    const bodyStart=source.content.length-parseMetadata(source.content).body.length;
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<bodyStart||from<0||to>source.content.length||from>=to)throw new Error('속성을 제외한 올바른 선택 영역을 지정해 주세요.');
    if(source.content.startsWith('\uFEFF')&&from===0)from=1;
    for(const offset of [from,to])if(offset>0&&/[\uD800-\uDBFF]/.test(source.content[offset-1])&&/[\uDC00-\uDFFF]/.test(source.content[offset]||''))throw new Error('문자 경계에 맞는 선택 영역을 지정해 주세요.');
    const selected=source.content.slice(from,to);if(!selected.trim())throw new Error('비어 있지 않은 선택 영역을 지정해 주세요.');
    const replacement=input.replacement||'link';if(!['link','embed','none'].includes(replacement))throw new Error('원본에 남길 형식을 선택해 주세요.');
    const moved=subpaths(source,from,to),redirect=(value,fragment)=>value===source.path&&moved(fragment)?input.targetPath:value;
    changes.set(input.targetPath,relocate(selected,source.path,input.targetPath,files,redirect));
    const link=(replacement==='embed'?'!':'')+`[[${input.targetPath.replace(/\.md$/i,'').split('/').map(encodeURIComponent).join('/')}]]`,text=replacement==='none'?'':link+(selected.endsWith(eol)?eol:'');
    const remaining=source.content.slice(0,from)+text+source.content.slice(to);
    changes.set(source.path,relocate(remaining,source.path,source.path,files,redirect));
    for(const note of model.notes)if(note.path!==source.path){const content=relocate(note.content,note.path,note.path,files,redirect);if(content!==note.content)changes.set(note.path,content);}
    normalized={kind:input.kind,sourcePath:source.path,targetPath:input.targetPath,from,to,headingLine:input.headingLine,replacement,sourceRevision:source.revision};
  }
  for(const document of capture.documents)if(document.kind==='canvas'){
    const {data}=parseCanvas(document.content);let changed=false;
    const moved=input.kind==='merge'?()=>true:subpaths(source,normalized.from,normalized.to);
    const nodes=(data.nodes||[]).map(node=>{
      const next={...node};
      if(node.type==='file' && node.file===source.path && (input.kind==='merge'||moved(node.subpath||''))){next.file=input.targetPath;changed=true;}
      if(node.type==='text'){
        const redirect=(value,fragment)=>value===source.path&&(input.kind==='merge'||moved(fragment))?input.targetPath:value;
        next.text=relocate(node.text,document.path,document.path,files,redirect);changed ||= next.text!==node.text;
      }
      return next;
    });
    if(changed)changes.set(document.path,JSON.stringify({...data,nodes},null,2)+'\n');
  }
  for(const content of changes.values())if(content!==null&&Buffer.byteLength(content)>limit)throw new Error('작업 결과 문서는 8MB 이하여야 합니다.');
  const previous=[...notes,...capture.documents];
  for(const [path,content]of changes)if(content!==null && content===previous.find(n=>n.path===path)?.content)changes.delete(path);
  return {input:normalized,edits:[...changes].map(([path,content])=>({path,content})),changes:[...changes].map(([path,content])=>{const before=previous.find(n=>n.path===path)?.content??null;return {path,kind:content===null?'remove':before===null?'create':'edit',before:before?.slice(0,1800)||'',after:content?.slice(0,1800)||'',beforeLength:before?.length||0,afterLength:content?.length||0};})};
}
export class NoteComposer {
  constructor(vault){this.vault=vault;}
  async preview(input){const capture=await this.vault.documentSnapshot(),result=plan(capture,input);return {input:result.input,revision:capture.revision,changes:result.changes};}
  async apply(input,revision){const capture=await this.vault.documentSnapshot();if(capture.revision!==revision)throw new Error('미리보기 이후 파일이 변경되었습니다. 다시 확인해 주세요.');const result=plan(capture,input);return this.vault.applyDocumentChanges(result.edits,revision);}
}
