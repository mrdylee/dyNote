import {Facet,StateField,Transaction} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';
import {ensureSyntaxTree} from '@codemirror/language';
import {isolateHistory} from '@codemirror/commands';
import {outlineRegions,outlineRegionAt,outlineRegionEdit} from '../core/outline-regions.mjs';

export const outlineDefaults=Facet.define({combine:values=>values[0]??{journal:true,live:false}});
function regionState(state){
 const regions=outlineRegions(state.doc.toString()),ranges=[];
 if(state.facet(outlineDefaults).live)for(const region of regions){
  ranges.push(Decoration.replace({block:true,inclusive:false}).range(region.openFrom,region.openTo));
  ranges.push(Decoration.replace({block:true,inclusive:false}).range(region.closeFrom,region.closeTo));
 }
 return {regions,boundaries:Decoration.set(ranges,true)};
}
export const outlineRegionState=StateField.define({
 create:regionState,
 update:(value,tr)=>tr.docChanged||tr.startState.facet(outlineDefaults)!==tr.state.facet(outlineDefaults)?regionState(tr.state):value,
 provide:field=>[EditorView.decorations.from(field,value=>value.boundaries),EditorView.atomicRanges.of(view=>view.state.field(field).boundaries)],
});
export function outlineOptionsAt(state,pos){
 const region=outlineRegionAt(state.field(outlineRegionState,false)?.regions??[],pos);
 return region??{from:0,to:state.doc.length,mode:state.facet(outlineDefaults).journal?'journal':'normal'};
}
export function selectedOutlineRegion(state){
 const regions=state.field(outlineRegionState,false)?.regions??[],{from,to}=state.selection.main;
 return regions.find(region=>region.openFrom<=from&&to<=region.closeTo)??null;
}
export function applyOutlineRegion(view,mode){
 if(!view||view.state.readOnly||view.composing||view.state.selection.ranges.length!==1)return false;
 const state=view.state,selection=state.selection.main;let {from,to}=selection;
 if(!selectedOutlineRegion(state)&&!selection.empty){
  const tree=ensureSyntaxTree(state,to,100);if(!tree)return false;
  let node=tree.resolveInner(from,1);while(node&&node.name!=='ListItem')node=node.parent;
  if(node)from=state.doc.lineAt(node.from).from;
  let end=to;
  tree.iterate({from,to,enter(ref){if(ref.name==='ListItem'&&ref.from>=from&&ref.from<to)end=Math.max(end,ref.to);}});
  to=end;
 }
 const edit=outlineRegionEdit(state.doc.toString(),from,to,mode);if(!edit)return false;
 view.dispatch({...edit,scrollIntoView:true,annotations:[Transaction.userEvent.of('input.outline-region'),isolateHistory.of('full')]});
 view.focus();return true;
}
