import MarkdownIt from 'markdown-it';
import {parseMetadata} from './metadata.mjs';

const parser=new MarkdownIt({html:true});
const endMarker='<!-- /dynote:journal -->';
function boundary(text){
 const match=/^([\t ]*)<!-- dynote:journal( newline=added)? -->[\t ]*$/.exec(text);
 if(match)return {kind:'start',prefix:match[1],mode:'journal',addedNewline:!!match[2]};
 return /^[\t ]*<!-- \/dynote:journal -->[\t ]*$/.test(text)?{kind:'end'}:null;
}
function opening(prefix='',addedNewline=false){return `${prefix}<!-- dynote:journal${addedNewline?' newline=added':''} -->`;}
function lines(source,base=0){
 const result=[];let from=0;
 for(const match of source.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)){
  if(match.index===source.length&&result.length)break;
  result.push({from:base+from,to:base+match.index+match[0].length,text:match[1],eol:match[2]});
  from=match.index+match[0].length;
 }
 return result;
}
function document(source){
 let body=parseMetadata(source).body,base=source.length-body.length;
 if(body.startsWith('\uFEFF')){body=body.slice(1);base++;}
 return {base,records:lines(body,base),tokens:parser.parse(body,{})};
}
export function outlineRegions(source){
 if(!source.includes('<!-- dynote:journal'))return [];
 const {records,tokens}=document(source),regions=[];let open=null,nested=false,depth=0;
 for(const token of tokens){
  if(token.type!=='html_block'||!token.map||token.map[1]!==token.map[0]+1)continue;
  const line=records[token.map[0]],mark=boundary(line.text);if(!mark)continue;
  if(mark.kind==='start'){
   if(depth++)nested=true;
   else open={...mark,openFrom:line.from,openTo:line.to,from:line.to};
  }else if(depth&&!--depth){
   if(!nested)regions.push({...open,to:line.from,closeFrom:line.from,closeTo:line.to});
   open=null;nested=false;
  }
 }
 return regions;
}
export function outlineRegionAt(regions,pos){return regions.find(region=>region.from<=pos&&pos<=region.to)??null;}
export function outlineRegionEdit(source,from,to,mode){
 const regions=outlineRegions(source),existing=outlineRegionAt(regions,from)??regions.find(region=>region.openFrom<=from&&to<=region.closeTo);
 if(existing&&to<=existing.closeTo){
  if(mode==='normal'){
   const newline=source.slice(existing.to-2,existing.to)==='\r\n'?'\r\n':source[existing.to-1];
   return {changes:[{from:existing.openFrom,to:existing.openTo,insert:''},{from:existing.closeFrom-(existing.addedNewline?newline.length:0),to:existing.closeTo,insert:''}]};
  }
  return null;
 }
 if(mode!=='journal'||from===to)return null;
 const records=lines(source),context=document(source);
 const first=records.findLast(line=>line.from<=from),last=records.findLast(line=>line.from<to);
 from=Math.max(first.from,source.startsWith('\uFEFF')?1:0);to=last.to;
 for(const token of context.tokens){
  if(token.type!=='paragraph_open'||token.level!==0||!token.map)continue;
  const start=context.records[token.map[0]].from,end=context.records[token.map[1]]?.from??source.length;
  if(from<end&&to>start){from=Math.min(from,start);to=Math.max(to,end);}
 }
 if(from<context.base||regions.some(region=>from<region.closeTo&&to>region.openFrom))return null;
 for(const token of context.tokens){
  if(!['fence','code_block','html_block'].includes(token.type)||!token.map)continue;
  const start=context.records[token.map[0]]?.from,end=context.records[token.map[1]]?.from??source.length;
  if(from<end&&to>start&&(from>start||to<end))return null;
 }
 const selected=source.slice(from,to),prefix=selected.split(/\r\n|\r|\n/).filter(line=>line.trim()).map(line=>line.match(/^[\t ]*/)[0]).sort((a,b)=>a.replaceAll('\t','    ').length-b.replaceAll('\t','    ').length)[0]??'';
 const eol=source.match(/\r\n|\r|\n/)?.[0]??'\n',addedNewline=!/[\r\n]$/.test(selected);
 const contentChanges=[];
 for(const token of context.tokens){
  if(token.type!=='paragraph_open'||token.level!==0||!token.map)continue;
  const start=context.records[token.map[0]].from,end=context.records[token.map[1]]?.from??source.length;
  if(start<from||end>to)continue;
  for(let index=token.map[0];index<token.map[1];index++)contentChanges.push({from:context.records[index].from,insert:index===token.map[0]?'- ':'  '});
 }
 let startInsert=opening(prefix,addedNewline)+eol;
 if(contentChanges[0]?.from===from)startInsert+=contentChanges.shift().insert;
 return {changes:[{from,insert:startInsert},...contentChanges,{from:to,insert:(addedNewline?eol:'')+prefix+endMarker+(to<source.length?eol:'')}]};
}
export function installOutlineRegions(md){
 md.block.ruler.before('paragraph','dynote_outline_region',(state,startLine,_endLine,silent)=>{
  const text=state.src.slice(state.bMarks[startLine],state.eMarks[startLine]);if(!boundary(text))return false;
  const markers=state.dynoteOutlineMarkers??=new Set(outlineRegions(state.src).flatMap(region=>[region.openFrom,region.closeFrom]));
  if(!markers.has(state.bMarks[startLine]))return false;
  if(!silent)state.line=startLine+1;
  return true;
 },{alt:['paragraph','reference','blockquote','list']});
}
