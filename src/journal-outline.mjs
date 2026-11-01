import {Prec,Transaction} from '@codemirror/state';
import {EditorView,ViewPlugin,Decoration,keymap} from '@codemirror/view';
import {syntaxTree} from '@codemirror/language';
import {insertNewlineContinueMarkup} from '@codemirror/lang-markdown';
import {isolateHistory} from '@codemirror/commands';
import {runOutlineCommand} from './editorCommands.mjs';
import {outlineEdit} from '../core/outliner.mjs';

function metadataEnd(doc){
 if(doc.line(1).text.replace(/^\uFEFF/,'')!=='---')return 0;
 for(let number=2;number<=doc.lines;number++)if(/^(?:---|\.\.\.)\s*$/.test(doc.line(number).text))return doc.line(number).to;
 return doc.length;
}
function block(view){
 if(view.state.readOnly||view.composing||view.state.selection.ranges.length!==1||!view.state.selection.main.empty)return null;
 const {state}=view,pos=state.selection.main.head;
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
 if(pos===line.to&&children&&children.from>pos){
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
function decorations(view){
 const ranges=[],seen=new Set(),header=metadataEnd(view.state.doc),tree=syntaxTree(view.state);
 for(const {from,to}of view.visibleRanges)tree.iterate({from,to,enter(node){
  if(node.name!=='ListMark'||node.from<header)return;
  const line=view.state.doc.lineAt(node.from);if(seen.has(line.from))return;seen.add(line.from);
  const prefix=view.state.doc.sliceString(line.from,node.from);if(!/^[\t ]*$/.test(prefix))return;
  const indent=prefix.replaceAll('\t','    ').length;
  ranges.push(Decoration.line({class:'cm-journal-block',attributes:{'data-level':String(indent/2),style:`--journal-indent:${indent}ch`}}).range(line.from));
 }});
 return Decoration.set(ranges,true);
}
const guides=ViewPlugin.fromClass(class{
 constructor(view){this.decorations=decorations(view);}
 update(update){if(update.docChanged||update.viewportChanged||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=decorations(update.view);}
},{decorations:value=>value.decorations});
export function journalOutline(){
 return [EditorView.editorAttributes.of({class:'cm-journal'}),guides,Prec.highest(keymap.of([
  {key:'Enter',run:journalEnter},{key:'Shift-Enter',run:journalSoftBreak},
  {key:'Tab',run:view=>journalIndent(view,'indent')},{key:'Shift-Tab',run:view=>journalIndent(view,'outdent')},
 ]))];
}
