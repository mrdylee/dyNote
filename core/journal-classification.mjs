import {createHash} from 'node:crypto';
import MarkdownIt from 'markdown-it';
import {validNotePath} from './vault.mjs';
import {relocate} from './note-composer.mjs';
import {journalSections} from './journal-sections.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fold=value=>value.normalize('NFC').toLowerCase();
const parser=new MarkdownIt({html:false});
function plan(capture,input) {
  if(!Array.isArray(input?.items)||!input.items.length||input.items.length>100)throw new Error('분류할 항목을 선택해 주세요.');
  const files=[...capture.notes,...capture.documents,...capture.attachments],changes=new Map(),items=[],sources=new Set(input.items.map(i=>i.sourcePath));
  for(const item of input.items){
    const source=capture.notes.find(n=>n.path===item.sourcePath);
    if(!source||source.revision!==item.sourceRevision)throw new Error('원본 기록이 변경되었습니다. 다시 확인해 주세요.');
    const targetPath=item.targetPath;
    if(!validNotePath(targetPath))throw new Error('올바른 Markdown 경로를 지정해 주세요.');
    if([...sources].some(p=>fold(p)===fold(targetPath)))throw new Error('원본 저널은 분류 대상으로 사용할 수 없습니다.');
    const collision=files.find(f=>fold(f.path)===fold(targetPath));
    if(collision&&collision.path!==targetPath)throw new Error('같은 이름의 다른 경로가 있습니다.');
    const section=journalSections(source).find(s=>s.from===item.from&&s.to===item.to);
    if(!section)throw new Error('원본 제목 범위가 변경되었습니다. 다시 확인해 주세요.');
    const sourceId=hash(source.path),marker=`<!-- dynote-journal:${sourceId}:${hash(section.excerpt)} -->`;
    const previous=changes.get(targetPath)??capture.notes.find(n=>n.path===targetPath)?.content??'';
    items.push({sourcePath:source.path,sourceRevision:source.revision,from:section.from,to:section.to,targetPath});
    if(previous.includes(marker))continue;
    // Reference definitions may live outside the selected heading. Include them
    // with the excerpt so relocation also handles their relative destinations.
    const env={};parser.parse(source.content,env);
    let excerpt=section.excerpt;
    for(const [label,ref] of Object.entries(env.references??{})){
      if(!excerpt.includes(`[${label}]:`))excerpt+=`\n[${label}]: <${ref.href}>${ref.title?' '+JSON.stringify(ref.title):''}\n`;
    }
    excerpt=relocate(excerpt,source.path,targetPath,files);
    const existingRefs={},copiedRefs={};parser.parse(previous,existingRefs);parser.parse(excerpt,copiedRefs);
    for(const [label,ref] of Object.entries(copiedRefs.references??{}))if(existingRefs.references?.[label]&&existingRefs.references[label].href!==ref.href)throw new Error('대상 문서에 다른 주소의 참조 링크가 있습니다. 새 문서 경로를 선택해 주세요.');
    const sourceLink=`[[${source.path.replace(/\.md$/i,'').split('/').map(encodeURIComponent).join('/')}]]`;
    const repeated=previous.includes(`<!-- dynote-journal:${sourceId}:`);
    const block=`${marker}\n> 출처: ${sourceLink}${repeated?' · 추가 발췌 (기존 내용 유지)':''}\n\n${excerpt}`;
    const result=previous+(previous.trim()?'\n\n':'')+block;
    if(Buffer.byteLength(result)>8*1024*1024)throw new Error('분류 문서는 8MB 이하여야 합니다.');
    changes.set(targetPath,result);
  }
  return {input:{items},edits:[...changes].map(([path,content])=>({path,content})),changes:[...changes].map(([path,after])=>({path,before:capture.notes.find(n=>n.path===path)?.content??'',after}))};
}
export class JournalClassifier {
  constructor(vault){this.vault=vault;}
  async preview(input){const capture=await this.vault.documentSnapshot(),result=plan(capture,input);return {input:result.input,revision:capture.revision,changes:result.changes};}
  async apply(input,revision){const capture=await this.vault.documentSnapshot();if(capture.revision!==revision)throw new Error('미리보기 이후 파일이 변경되었습니다. 다시 확인해 주세요.');const result=plan(capture,input);if(!result.edits.length)return {snapshot:capture};return this.vault.applyDocumentChanges(result.edits,revision);}
}
