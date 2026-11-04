import MarkdownIt from 'markdown-it';
import {parseMetadata} from './metadata.mjs';
const parser=new MarkdownIt({html:true});
export function captureLinkRanges(source){
 if(!source.includes('<!-- dynote:copilot '))return [];
 const body=parseMetadata(source).body,base=source.length-body.length,lines=[],groups=[];
 for(const match of body.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)){
  if(match.index===body.length)break;
  lines.push({from:base+match.index,to:base+match.index+match[0].length,text:match[1]});
 }
 const tokens=parser.parse(body,{}),literalRanges=tokens.filter(token=>['fence','code_block'].includes(token.type)&&token.map).map(token=>token.map);
 let opening=null;
 for(const token of tokens){
  if(token.type!=='html_block'||token.level!==0||!token.map||token.map[1]!==token.map[0]+1)continue;
  const line=lines[token.map[0]],match=/^<!-- (\/?)dynote:copilot ([a-f0-9]{20}) -->$/.exec(line.text);
  if(!match)continue;
  if(!match[1]){opening=opening?null:{id:match[2],line,index:token.map[0]};continue;}
  if(opening?.id!==match[2]){opening=null;continue;}
  const links=lines.slice(opening.index+1,token.map[0]).filter((item,index)=>!literalRanges.some(([from,to])=>opening.index+1+index>=from&&opening.index+1+index<to)&&/^- \[\[AI Conversations\/[a-f0-9]{20}\/\d{4}-\d{2}-\d{2}\.md\|[^\]\r\n]+\]\]$/.test(item.text));
  if(links.length===1)groups.push({id:opening.id,markers:[opening.line,line],link:links[0]});
  opening=null;
 }
 return groups;
}
function removeRanges(source,ranges){for(const range of ranges.sort((a,b)=>b.from-a.from))source=source.slice(0,range.from)+source.slice(range.to);return source;}
export function removeCaptureLink(source,id){
 if(!/^[a-f0-9]{20}$/.test(id))throw new Error('잘못된 기록입니다.');
 return removeRanges(source,captureLinkRanges(source).filter(group=>group.id===id).flatMap(group=>[...group.markers,group.link]));
}
export function withoutCaptureLinks(source){return removeRanges(source,captureLinkRanges(source).flatMap(group=>[...group.markers,group.link]));}
export function installCaptureMarkers(md){
 md.block.ruler.before('paragraph','dynote_capture_marker',(state,startLine,_endLine,silent)=>{
  if(!/^<!-- \/?dynote:copilot /.test(state.src.slice(state.bMarks[startLine],state.eMarks[startLine])))return false;
  const markers=state.dynoteCaptureMarkers??=new Set(captureLinkRanges(state.src).flatMap(group=>group.markers.map(line=>line.from)));
  if(!markers.has(state.bMarks[startLine]))return false;
  if(!silent)state.line=startLine+1;
  return true;
 },{alt:['paragraph','reference','blockquote','list']});
}
