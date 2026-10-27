function listDocument(content) {
  const eol = content.match(/\r\n|\r|\n/)?.[0] || '\n';
  const lines = content.split(/\r\n|\r|\n/), trailing = lines.at(-1) === '';
  if (trailing) lines.pop();
  let offset = 0, fence = null, yaml = lines[0] === '---';
  const records = lines.map((text, index) => {
    const start = offset; offset += text.length + eol.length;
    let excluded = yaml || !!fence;
    if (yaml && index > 0 && /^(---|\.\.\.)\s*$/.test(text)) yaml = false;
    if (!yaml) {
      const marker = text.match(/^\s*(`{3,}|~{3,})/);
      if (marker) {
        excluded = true;
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      }
    }
    const match = !excluded && text.match(/^([\t ]*)(?:[-+*]|\d+[.)])\s+/);
    return { text, start, indent: (text.match(/^[\t ]*/)[0].replaceAll('\t','    ')).length, list: !!match };
  });
  return { eol, lines, trailing, records };
}
function endOf(records, index) {
  let end = index + 1;
  while (end < records.length && (!records[end].text.trim() || records[end].indent > records[index].indent)) end++;
  return end;
}
export function outlineRange(content, offset) {
  const doc = listDocument(content), {records,eol} = doc;
  let index = records.findLastIndex(r => r.start <= offset);
  if (index < 0 || !records[index].list) return null;
  const end = endOf(records,index);
  const from = records[index].start, to = end < records.length ? records[end].start : content.length;
  let last = end - 1;
  while (last > index && !records[last].text.trim()) last--;
  return { from, to, index, end, foldFrom: from + records[index].text.length, foldTo: records[last].start + records[last].text.length, eol };
}
export function outlineEdit(content, offset, action) {
  const range = outlineRange(content,offset);
  if (!range) return null;
  const {records,lines,eol,trailing} = listDocument(content), {index,end}=range;
  const base=records[index].indent;
  let previous=index-1;
  while(previous>=0 && (!records[previous].text.trim() || records[previous].indent>base)) previous--;
  if(previous<0 || !records[previous].list || records[previous].indent!==base) previous=-1;
  let nextOffset=offset;
  if(action==='up') {
    if(previous<0)return null;
    const block=lines.slice(index,end), before=lines.slice(previous,index);
    lines.splice(previous,end-previous,...block,...before);
    nextOffset=records[previous].start+(offset-range.from);
  } else if(action==='down') {
    if(end>=records.length || !records[end].list || records[end].indent!==base)return null;
    const nextEnd=endOf(records,end), block=lines.slice(index,end), after=lines.slice(end,nextEnd);
    lines.splice(index,nextEnd-index,...after,...block);
    nextOffset=range.from+after.join(eol).length+eol.length+(offset-range.from);
  } else if(action==='indent' || action==='outdent') {
    if(action==='indent' && previous<0)return null;
    if(action==='outdent' && base===0)return null;
    let amount=2;
    if(action==='indent') {
      const child=records.slice(previous+1,index).find(r=>r.list && r.indent>base);
      if(child)amount=child.indent-base;
    } else {
      let parent=index-1;
      while(parent>=0 && (!records[parent].list || records[parent].indent>=base))parent--;
      amount=parent>=0 ? base-records[parent].indent : Math.min(2,base);
    }
    for(let i=index;i<end;i++) {
      if(!lines[i].trim())continue;
      if(action==='indent')lines[i]=' '.repeat(amount)+lines[i];
      else {
        let count=0, chars=0;
        while(chars<lines[i].length && count<amount && /[\t ]/.test(lines[i][chars])){count+=lines[i][chars]==='\t'?4:1;chars++;}
        lines[i]=lines[i].slice(chars);
      }
    }
    nextOffset=Math.max(range.from,offset+(action==='indent'?amount:-Math.min(amount,base)));
  } else return null;
  const result=lines.join(eol)+(trailing?eol:'');
  return {content:result,offset:Math.min(result.length,nextOffset)};
}
