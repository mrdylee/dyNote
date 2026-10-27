import {parseDocument} from 'yaml';
import {parseMetadata, updateMetadata} from './metadata.mjs';

export function parseMindmap(source) {
  const metadata=parseMetadata(source);
  if(metadata.error)throw new Error(metadata.error);
  const eol=source.includes('\r\n')?'\r\n':'\n';
  if(metadata.properties['mindmap-plugin']==='rich') {
    const block=/^(`{3,}|~{3,})[ \t]*json[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/m.exec(source);
    if(!block)throw new Error('rich 마인드맵 JSON을 찾을 수 없습니다.');
    let data;try{data=JSON.parse(block[2]);}catch{throw new Error('마인드맵 JSON을 읽을 수 없습니다.');}
    if(!Array.isArray(data?.mindData) || data.mindData.some(sheet=>!Array.isArray(sheet)))throw new Error('mindData 형식이 올바르지 않습니다.');
    const nodes=data.mindData.flatMap((sheet,sheetIndex)=>sheet.map(raw=>{
      if(!raw || typeof raw.id!=='string' || !raw.id || typeof raw.text!=='string' || (raw.pid!=null && typeof raw.pid!=='string'))throw new Error('마인드맵 노드 형식이 올바르지 않습니다.');
      return {id:raw.id,text:raw.text,parent:raw.pid || null,x:raw.x,y:raw.y,expanded:raw.isExpand!==false,sheet:sheetIndex,raw};
    }));
    const byId=new Map(nodes.map(n=>[n.id,n]));
    if(byId.size!==nodes.length)throw new Error('중복된 마인드맵 노드 ID입니다.');
    const done=new Set();
    for(const node of nodes){const chain=new Set();let current=node;while(current && !done.has(current.id)){if(chain.has(current.id))throw new Error('마인드맵 부모에 순환 연결이 있습니다.');chain.add(current.id);current=byId.get(current.parent);}for(const id of chain)done.add(id);}
    const jsonFrom=block.index+block[0].indexOf(block[2]);
    return {kind:'rich',nodes,data,jsonFrom,jsonTo:jsonFrom+block[2].length,metadata,eol};
  }
  const bodyStart=source.length-metadata.body.length;
  let start=0,fence=null,headingDepth=-1;
  const stack=[],nodes=[];
  for(const rawLine of source.match(/[^\n]*(?:\n|$)/g) || []) {
    if(!rawLine)continue;
    const line=rawLine.replace(/\r?\n$/,'');
    const lineStart=start;start+=rawLine.length;
    if(lineStart<bodyStart)continue;
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}
    if(fence)continue;
    const heading=line.match(/^( {0,3}#{1,6}\s+)(.*)$/);
    const list=!heading && line.match(/^([\t ]*(?:[-+*]|\d+[.)])\s+)(.*)$/);
    if(!heading&&!list)continue;
    const match=heading||list,prefix=match[1];
    const depth=heading?prefix.trim().length-1:headingDepth+1+(prefix.match(/^[\t ]*/)[0].replaceAll('\t','    ').length/2);
    if(heading)headingDepth=depth;
    while(stack.length && stack.at(-1).depth>=depth)stack.pop().end=lineStart;
    const suffix=match[2].match(/\s+\^[\w-]+\s*$/)?.[0] || '';
    const text=match[2].slice(0,match[2].length-suffix.length);
    const node={id:`line-${lineStart}`,text,parent:stack.at(-1)?.id || null,depth,start:lineStart,lineEnd:lineStart+line.length,end:source.length,prefix,suffix,kind:heading?'heading':'list',expanded:true};
    nodes.push(node);stack.push(node);
  }
  return {kind:'basic',nodes,metadata,eol};
}
function writeRich(source,model){return source.slice(0,model.jsonFrom)+JSON.stringify(model.data)+source.slice(model.jsonTo);}
export function editMindmap(source,id,action,value) {
  const model=parseMindmap(source),node=model.nodes.find(n=>n.id===id);
  if(!node)throw new Error('마인드맵 노드를 다시 선택해 주세요.');
  if(['rename','add-child','add-sibling'].includes(action) && (typeof value!=='string' || !value.trim() || /[\r\n]/.test(value)))throw new Error('노드 이름은 한 줄로 입력해 주세요.');
  if(model.kind==='rich') {
    const sheet=model.data.mindData[node.sheet];
    if(action==='rename')node.raw.text=value;
    else if(action==='move'){
      if(!Number.isFinite(value?.x)||!Number.isFinite(value?.y))throw new Error('노드 위치가 올바르지 않습니다.');
      node.raw.x=value.x;node.raw.y=value.y;
    } else if(action==='fold')node.raw.isExpand=!node.expanded;
    else if(action==='add-child'||action==='add-sibling') {
      const parent=action==='add-child'?id:node.parent;
      const added={id:crypto.randomUUID(),pid:parent,text:value,isExpand:true,x:(Number(node.x)||0)+220,y:(Number(node.y)||0)+80,style:{}};
      sheet.push(added);if(action==='add-child')node.raw.isExpand=true;
      return {content:writeRich(source,model),id:added.id};
    } else if(action==='delete') {
      if (['induceData','wireFrameData','relateLinkData','calloutData'].some(key=>Array.isArray(model.data[key]) && model.data[key].length))
        throw new Error('장식·관계가 있는 rich 문서의 하위 트리 삭제는 아직 지원하지 않습니다. 원본을 보존했습니다.');
      if(!node.parent && model.nodes.filter(n=>!n.parent).length===1)throw new Error('마지막 루트 노드는 삭제할 수 없습니다.');
      const removed=new Set([id]);let changed=true;
      while(changed){changed=false;for(const n of model.nodes)if(removed.has(n.parent)&&!removed.has(n.id)){removed.add(n.id);changed=true;}}
      model.data.mindData=model.data.mindData.map(s=>s.filter(n=>!removed.has(n.id)));
      return {content:writeRich(source,model),id:node.parent};
    } else throw new Error('지원하지 않는 마인드맵 동작입니다.');
    return {content:writeRich(source,model),id};
  }
  if(action==='rename')return {content:source.slice(0,node.start)+node.prefix+value+node.suffix+source.slice(node.lineEnd),id};
  if(action==='delete') {
    if(!node.parent && model.nodes.filter(n=>!n.parent).length===1)throw new Error('마지막 루트 노드는 삭제할 수 없습니다.');
    return {content:source.slice(0,node.start)+source.slice(node.end),id:node.parent};
  }
  if(action!=='add-child'&&action!=='add-sibling')throw new Error('지원하지 않는 마인드맵 동작입니다.');
  let prefix=node.prefix;
  if(action==='add-child')prefix=node.kind==='heading' && node.prefix.trim().length<6?'#'.repeat(node.prefix.trim().length+1)+' ':node.kind==='list'?'  '+node.prefix:'- ';
  const before=source.slice(0,node.end),separator=before.endsWith('\n')?'':model.eol;
  const added=prefix+value+model.eol;
  return {content:before+separator+added+source.slice(node.end),id:`line-${before.length+separator.length}`};
}
function metadataFor(source,kind) {
  const metadata=parseMetadata(source),doc=parseDocument(metadata.yaml || '');
  doc.set('mindmap-plugin',kind);
  return updateMetadata(source,doc.toString());
}
export function convertMindmap(source,kind) {
  const model=parseMindmap(source);
  if(kind===model.kind)return source;
  if(kind==='rich') {
    const ids=new Map(model.nodes.map(n=>[n.id,crypto.randomUUID()]));
    const nodes=model.nodes.map((n,i)=>({id:ids.get(n.id),pid:n.parent?ids.get(n.parent):undefined,text:n.text,isExpand:true,x:(n.depth||0)*240,y:i*90,...(!n.parent?{isRoot:true,main:true,layout:{layoutName:'mindmap2',direct:'right'}}:{}),style:{}}));
    const data={mindData:[nodes],induceData:[],wireFrameData:[],relateLinkData:[],calloutData:[]};
    const header=metadataFor(source,'rich');const body=parseMetadata(header).body;
    return header.slice(0,header.length-body.length)+`\n# ${model.nodes[0]?.text || 'Mindmap'}\n\`\`\` json\n${JSON.stringify(data)}\n\`\`\`\n`;
  }
  if(kind!=='basic')throw new Error('지원하지 않는 마인드맵 형식입니다.');
  const children=new Map(), ids=new Set(model.nodes.map(n=>n.id));
  for(const node of model.nodes){const parent=ids.has(node.parent)?node.parent:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(node);}
  const lines=[],stack=(children.get(null)||[]).slice().reverse().map(node=>({node,depth:0}));
  while(stack.length){const {node,depth}=stack.pop();lines.push((depth<6?'#'.repeat(depth+1)+' ':'  '.repeat(depth-6)+'- ')+node.text.replace(/<br\s*\/?\s*>|[\r\n]/g,' '));for(const child of (children.get(node.id)||[]).slice().reverse())stack.push({node:child,depth:depth+1});}
  const header=metadataFor(source,'basic');const body=parseMetadata(header).body;
  return header.slice(0,header.length-body.length)+lines.join(model.eol)+model.eol;
}
