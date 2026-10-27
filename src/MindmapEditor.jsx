import {useEffect,useMemo,useRef,useState} from 'react';
import {ReactFlow,Background,Controls,Handle,Position,applyNodeChanges} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {parseMindmap,editMindmap} from '../core/mindmap.mjs';
function MindNode({data}) {
  return <div className="mindmap-node"><Handle type="target" position={Position.Left}/><span>{data.text.replace(/<br\s*\/?\s*>/g,'\n')}</span><Handle type="source" position={Position.Right}/></div>;
}
const nodeTypes={mind:MindNode};
function graph(model,collapsed) {
  const byId=new Map(model.nodes.map(n=>[n.id,n])),children=new Map();
  for(const node of model.nodes){const parent=byId.has(node.parent)?node.parent:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(node);}
  const positions=new Map(),visible=new Set(),stack=(children.get(null)||[]).slice().reverse().map(n=>({node:n,depth:0,after:false}));
  let row=0;
  while(stack.length) {
    const {node,depth,after}=stack.pop();const list=node.expanded&&!collapsed.has(node.id)?children.get(node.id)||[]:[];
    if(after){const ys=list.map(n=>positions.get(n.id)?.y).filter(y=>y!==undefined);positions.set(node.id,{x:depth*240,y:ys.length?ys.reduce((a,b)=>a+b)/ys.length:row++*90});continue;}
    visible.add(node.id);stack.push({node,depth,after:true});for(const child of list.slice().reverse())stack.push({node:child,depth:depth+1,after:false});
  }
  const nodes=model.nodes.filter(n=>visible.has(n.id)).map(n=>({id:n.id,type:'mind',position:model.kind==='rich'&&Number.isFinite(n.x)&&Number.isFinite(n.y)?{x:n.x,y:n.y}:positions.get(n.id),data:{text:n.text}}));
  const edges=model.nodes.filter(n=>visible.has(n.id)&&visible.has(n.parent)).map(n=>({id:`edge-${n.id}`,source:n.parent,target:n.id,type:'smoothstep'}));
  return {nodes,edges};
}
export default function MindmapEditor({note,onChange,onConvert,onMarkdown,readOnly,onError}) {
  const parsed=useMemo(()=>{try{return {model:parseMindmap(note.content)};}catch(e){return {error:e.message};}},[note.content]);
  const [selected,setSelected]=useState(null),[label,setLabel]=useState(''),[collapsed,setCollapsed]=useState(new Set());
  const [history,setHistory]=useState({past:[],future:[]});
  const ownContent=useRef(note.content);
  useEffect(()=>{if(ownContent.current!==note.content)setHistory({past:[],future:[]});ownContent.current=note.content;},[note.content]);
  const selectedNode=parsed.model?.nodes.find(n=>n.id===selected)||parsed.model?.nodes[0];
  useEffect(()=>setLabel(selectedNode?.text || ''),[selectedNode?.id,selectedNode?.text]);
  const visual=useMemo(()=>parsed.model?graph(parsed.model,collapsed):{nodes:[],edges:[]},[parsed,collapsed]);
  const [flowNodes,setFlowNodes]=useState(visual.nodes);
  useEffect(()=>setFlowNodes(visual.nodes),[visual]);
  const commit=(action,value,id=selectedNode?.id)=>{
    if(readOnly || !id)return;
    try{const result=editMindmap(note.content,id,action,value);if(result.content===note.content)return;setHistory(h=>({past:[...h.past,note.content].slice(-50),future:[]}));ownContent.current=result.content;onChange(result.content);setSelected(result.id);}
    catch(e){onError(e.message);}
  };
  const travel=(undo)=>{
    const list=undo?history.past:history.future;if(readOnly||!list.length)return;
    const content=list.at(-1);
    ownContent.current=content;
    setHistory(undo?{past:history.past.slice(0,-1),future:[...history.future,note.content]}:{past:[...history.past,note.content],future:history.future.slice(0,-1)});onChange(content);
  };
  if(parsed.error)return <section className="mindmap-error"><p role="alert">마인드맵을 읽을 수 없습니다: {parsed.error}</p><button onClick={onMarkdown}>Markdown으로 열기</button></section>;
  const model=parsed.model;
  return <section className="mindmap-editor" aria-label="마인드맵 편집기">
    <div className="mindmap-toolbar">
      <button disabled={readOnly||!history.past.length} onClick={()=>travel(true)}>실행 취소</button><button disabled={readOnly||!history.future.length} onClick={()=>travel(false)}>다시 실행</button>
      <button disabled={readOnly||!selectedNode} onClick={()=>commit('add-child','새 생각')}>자식 노드 추가</button><button disabled={readOnly||!selectedNode} onClick={()=>commit('add-sibling','새 생각')}>형제 노드 추가</button>
      <button disabled={readOnly||!selectedNode?.parent} onClick={()=>commit('delete')}>하위 트리 삭제</button>
      <button disabled={!selectedNode} onClick={()=>{if(model.kind==='rich')commit('fold');else setCollapsed(old=>{const next=new Set(old);if(next.has(selectedNode.id))next.delete(selectedNode.id);else next.add(selectedNode.id);return next;});}}>접기·펼치기</button>
      <button disabled={readOnly} onClick={()=>onConvert(model.kind==='rich'?'basic':'rich')}>{model.kind==='rich'?'기본 형식으로 복사':'rich 형식으로 복사'}</button>
      <button onClick={onMarkdown}>Markdown으로 열기</button>
    </div>
    <form className="mindmap-label" onSubmit={e=>{e.preventDefault();commit('rename',label);}}><label>노드 이름<input aria-label="마인드맵 노드 이름" value={label} disabled={readOnly||!selectedNode} onChange={e=>setLabel(e.target.value)}/></label><button disabled={readOnly||!selectedNode}>이름 적용</button><small>{model.kind==='rich'?'rich · 점을 끌면 위치를 저장합니다.':'기본 Markdown · 제목과 목록으로 저장합니다.'}</small></form>
    <div className="mindmap-stage"><ReactFlow nodes={flowNodes.map(n=>({...n,selected:n.id===selectedNode?.id}))} edges={visual.edges} nodeTypes={nodeTypes}
      onNodesChange={changes=>setFlowNodes(old=>applyNodeChanges(changes,old))} onNodeClick={(_event,node)=>setSelected(node.id)}
      onNodeDragStop={(_event,node)=>commit('move',node.position,node.id)} nodesDraggable={model.kind==='rich'&&!readOnly} nodesConnectable={false} fitView minZoom={0.1} maxZoom={2}>
      <Background/><Controls showInteractive={false}/>
    </ReactFlow></div>
    <p className="mindmap-note">형식 변환은 별도 파일을 만듭니다. rich 장식·주석은 기본 Markdown으로 옮겨지지 않으며 원본에 남습니다.</p>
  </section>;
}
