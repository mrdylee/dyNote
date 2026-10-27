import {scanLinks,resolvePath} from './links.mjs';
export function parsePdfFragment(fragment='') {
  const params=new URLSearchParams(fragment.replace(/^#/,''));
  const rawPage=params.get('page') || '1';
  if(!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)))throw new Error('PDF 페이지 번호가 올바르지 않습니다.');
  let selection=null;
  if(params.has('selection')) {
    const raw=params.get('selection').split(',');
    if(raw.length!==4 || raw.some(n=>!/^\d+$/.test(n) || !Number.isSafeInteger(Number(n))))throw new Error('PDF 선택 영역이 올바르지 않습니다.');
    selection=raw.map(Number);
    if(selection[0]>selection[2] || (selection[0]===selection[2] && selection[1]>selection[3]))throw new Error('PDF 선택 영역 순서가 올바르지 않습니다.');
  }
  return {page:Number(rawPage),selection,annotation:params.get('annotation') || null};
}
export function pdfWikiLink(path,page,selection=null) {
  const fragment=`page=${page}`+(selection?`&selection=${selection.join(',')}`:'');
  parsePdfFragment(fragment);
  return `[[${path.split('/').map(encodeURIComponent).join('/')}#${fragment}]]`;
}
export function pdfBacklinks(notes,path,attachments) {
  return notes.flatMap(note=>scanLinks(note.content).flatMap(link=>{
    const resolved=resolvePath(link.target,note.path,attachments,{kind:link.kind});
    return resolved.status==='resolved' && resolved.path===path ? [{notePath:note.path,label:link.label,fragment:link.target.split('#').slice(1).join('#')}] : [];
  }));
}
