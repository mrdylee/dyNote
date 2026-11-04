import {Prec,Transaction} from '@codemirror/state';
import {EditorView,ViewPlugin,Decoration,RectangleMarker,layer,keymap} from '@codemirror/view';
import {syntaxTree,foldedRanges} from '@codemirror/language';
import {insertNewlineContinueMarkup} from '@codemirror/lang-markdown';
import {isolateHistory} from '@codemirror/commands';
import {runOutlineCommand} from './editorCommands.mjs';
import {outlineEdit} from '../core/outliner.mjs';
import {outlineDefaults,outlineRegionState,outlineOptionsAt} from './outline-regions.mjs';

function metadataEnd(doc){
 if(doc.line(1).text.replace(/^\uFEFF/,'')!=='---')return 0;
 for(let number=2;number<=doc.lines;number++)if(/^(?:---|\.\.\.)\s*$/.test(doc.line(number).text))return doc.line(number).to;
 return doc.length;
}
function block(view){
 if(view.state.readOnly||view.composing||view.state.selection.ranges.length!==1||!view.state.selection.main.empty)return null;
 const {state}=view,pos=state.selection.main.head;
 if(outlineOptionsAt(state,pos).mode!=='journal')return null;
 if(pos<metadataEnd(state.doc))return null;
 let node=syntaxTree(state).resolveInner(pos,-1);
 while(node&&node.name!=='ListItem'){
  if(['FencedCode','CodeBlock','HTMLBlock'].includes(node.name))return null;
  node=node.parent;
 }
 const marker=node?.getChild('ListMark');
 if(!marker)return null;
 const first=state.doc.lineAt(node.from),line=state.doc.lineAt(pos);
 return {node,marker,first,line,pos};
}
function insert(view,from,text){
 view.dispatch({changes:{from,insert:text},selection:{anchor:from+text.length},scrollIntoView:true,
  annotations:[Transaction.userEvent.of('input.journal'),isolateHistory.of('full')]});
 return true;
}
export function journalEnter(view){
 const current=block(view);if(!current)return false;
 const {node,line,pos,first}=current,children=node.getChild('BulletList')??node.getChild('OrderedList');
 if(pos>current.marker.to&&children&&children.from>pos){
  const indent=view.state.doc.lineAt(children.from).text.match(/^[\t ]*/)[0];
  return insert(view,pos,'\n'+indent+'- ');
 }
 if(pos===line.to&&line.number>first.number&&line.text.trim())return insert(view,pos,'\n'+first.text.match(/^[\t ]*/)[0]+'- ');
 return insertNewlineContinueMarkup(view);
}
export function journalSoftBreak(view){
 const current=block(view);if(!current)return false;
 const prefix=view.state.doc.sliceString(current.first.from,current.marker.to+1).replace(/\S/g,' ');
 return insert(view,current.pos,'\n'+prefix);
}
export function journalIndent(view,action){
 const current=block(view);if(!current)return false;
 if(action==='outdent'){
  let parent=current.node.parent;while(parent&&parent.name!=='ListItem')parent=parent.parent;
  const marker=parent?.getChild('ListMark');
  if(!marker||marker.from<outlineOptionsAt(view.state,current.pos).from)return true;
 }
 if(current.line.number!==current.first.number){
  const edit=outlineEdit(view.state.doc.toString(),current.marker.from,action);if(!edit)return true;
  const changes=view.state.changes({from:0,to:view.state.doc.length,insert:edit.content});
  const next=changes.apply(view.state.doc).line(current.line.number);
  const indent=line=>line.text.match(/^[\t ]*/)[0].length;
  const column=current.pos-current.line.from+indent(next)-indent(current.line);
  view.dispatch({changes,selection:{anchor:next.from+Math.max(0,Math.min(next.length,column))},scrollIntoView:true,
   annotations:[Transaction.userEvent.of('input.journal'),isolateHistory.of('full')]});
  view.focus();return true;
 }
 runOutlineCommand(view,action);return true;
}
export function addJournalBlock(view){
 if(!view||view.state.readOnly||view.composing)return false;
 const end=view.state.doc.length,last=view.state.doc.lineAt(end);
 insert(view,end,(last.text?'\n':'')+'- ');view.focus();return true;
}
function threadPath(view){
 if(!view.hasFocus||!view.dom.classList.contains('cm-live-preview'))return [];
 const current=block(view),path=[],scope=outlineOptionsAt(view.state,view.state.selection.main.head);
 for(let node=current?.node;node;node=node.parent)if(node.name==='ListItem'){const marker=node.getChild('ListMark');if(marker&&marker.from>=scope.from&&marker.to<=scope.to)path.push(marker);}
 return path.reverse().filter(Boolean);
}
function listLevel(marker){
 let level=0;for(let node=marker.parent.parent;node;node=node.parent)if(node.name==='ListItem')level++;
 return level;
}
function threadMarkers(view){
 const path=threadPath(view);if(path.length<2)return [];
 let hidden=false;
 for(const marker of path)foldedRanges(view.state).between(marker.from,marker.to,(from,to)=>{if(from<marker.from&&marker.from<to)hidden=true;});
 if(hidden)return [];
 const points=path.map(marker=>{
  if(!view.visibleRanges.some(range=>range.from<=marker.from&&range.to>=marker.to))return null;
  const {node}=view.domAtPos(marker.from),element=node.nodeType===1?node:node.parentElement;
  const bullet=element.closest('.cm-line')?.querySelector('.cm-live-bullet,.cm-live-checkbox');if(!bullet)return null;
  const rect=bullet.getBoundingClientRect();
  return {x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2,level:listLevel(marker)};
 });
 const reference=points.find(Boolean);if(!reference)return [];
 // An ancestor above the viewport still owns the visible branch. Only its
 // offscreen endpoint is estimated; visible endpoints use the actual circles.
 for(let index=0;index<points.length;index++)if(!points[index]){
  const marker=path[index];
  points[index]={x:reference.x+(listLevel(marker)-reference.level)*30,y:view.documentTop+view.lineBlockAt(marker.from).top};
 }
 const rect=view.scrollDOM.getBoundingClientRect(),left=rect.left-view.scrollDOM.scrollLeft*view.scaleX,top=rect.top-view.scrollDOM.scrollTop*view.scaleY,markers=[];
 for(let index=1;index<points.length;index++){
  const parent=points[index-1],child=points[index];
  if(child.x>parent.x&&child.y>parent.y+3)markers.push(new RectangleMarker('cm-journal-thread',parent.x-left,parent.y+3-top,child.x-parent.x,child.y-parent.y-3));
 }
 return markers;
}
const threading=journal=>layer({
 above:true,class:journal?'cm-journal-threading':'cm-outline-threading',markers:threadMarkers,
 update:update=>update.docChanged||update.selectionSet||update.viewportChanged||update.focusChanged,
});
function decorations(view){
 const ranges=[],seen=new Set(),header=metadataEnd(view.state.doc),tree=syntaxTree(view.state),path=threadPath(view);
 const active=path.at(-1)?.from,ancestors=new Set(path.slice(0,-1).map(marker=>marker.from));
 for(const {from,to}of view.visibleRanges)tree.iterate({from,to,enter(node){
  if(node.name==='Paragraph'&&node.from>=header&&node.node.parent?.name==='ListItem'){
   const marker=node.node.parent.getChild('ListMark'),first=marker&&view.state.doc.lineAt(marker.from);
   const prefix=first&&view.state.doc.sliceString(first.from,marker.from);
   if(prefix&&/^[\t ]+$/.test(prefix)&&outlineOptionsAt(view.state,marker.from).mode==='journal'){
    const last=view.state.doc.lineAt(Math.min(to,node.to-1)).number;
    for(let number=Math.max(first.number+1,view.state.doc.lineAt(node.from).number,view.state.doc.lineAt(from).number);number<=last;number++){
     const line=view.state.doc.line(number);
     if(line.from>=from&&line.text.startsWith(prefix)){
      const width=listLevel(marker)*30;
      ranges.push(Decoration.line({class:'cm-outline-enabled',attributes:{style:`--journal-prefix-width:${width}px`}}).range(line.from));
      ranges.push(Decoration.mark({class:'cm-journal-indent',attributes:{style:`--journal-prefix-width:${width}px`}}).range(line.from,line.from+prefix.length));
     }
    }
   }
  }
  if(node.name!=='ListMark'||node.from<header)return;
  const options=outlineOptionsAt(view.state,node.from);if(options.mode!=='journal')return;
  const line=view.state.doc.lineAt(node.from);if(seen.has(line.from))return;seen.add(line.from);
  const prefix=view.state.doc.sliceString(line.from,node.from);if(!/^[\t ]*$/.test(prefix))return;
  const indent=prefix.replaceAll('\t','    ').length,level=listLevel(node.node);
  const status=node.from===active?' cm-journal-active':ancestors.has(node.from)?' cm-journal-ancestor':'';
  ranges.push(Decoration.line({class:'cm-journal-block cm-outline-enabled'+status,attributes:{'data-level':String(level),style:`--journal-indent:${indent}ch;--journal-prefix-width:${level*30}px`}}).range(line.from));
  if(indent)ranges.push(Decoration.mark({class:'cm-journal-indent',attributes:{style:`--journal-prefix-width:${level*30}px`}}).range(line.from,node.from));
 }});
 return Decoration.set(ranges,true);
}
const guides=ViewPlugin.fromClass(class{
 constructor(view){this.decorations=decorations(view);}
 update(update){if(update.docChanged||update.selectionSet||update.focusChanged||update.viewportChanged||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=decorations(update.view);}
},{decorations:value=>value.decorations});
export function journalOutline({journal=true,live=false}={}){
 return [outlineDefaults.of({journal,live}),outlineRegionState,EditorView.editorAttributes.of({class:journal?'cm-journal':'cm-outline-regions'}),guides,threading(journal),Prec.highest(keymap.of([
  {key:'Enter',run:journalEnter},{key:'Shift-Enter',run:journalSoftBreak},
  {key:'Tab',run:view=>journalIndent(view,'indent')},{key:'Shift-Tab',run:view=>journalIndent(view,'outdent')},
 ]))];
}
