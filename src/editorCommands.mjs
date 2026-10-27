import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, unfoldEffect, foldService } from '@codemirror/language';
import { outlineEdit, outlineRange } from '../core/outliner.mjs';

export const outlineFolding = foldService.of((state, lineStart) => {
  const range=outlineRange(state.doc.toString(),lineStart);
  return range && range.foldTo>range.foldFrom ? {from:range.foldFrom,to:range.foldTo} : null;
});
export function runOutlineCommand(view, action) {
  if (!view || view.state.readOnly) return false;
  const content=view.state.doc.toString(), offset=view.state.selection.main.head;
  if(action==='fold' || action==='unfold') {
    const range=outlineRange(content,offset);
    if(!range || range.foldTo<=range.foldFrom)return false;
    view.dispatch({effects:(action==='fold'?foldEffect:unfoldEffect).of({from:range.foldFrom,to:range.foldTo})});
  } else {
    const edit=outlineEdit(content,offset,action);
    if(!edit)return false;
    view.dispatch({changes:{from:0,to:view.state.doc.length,insert:edit.content},selection:{anchor:edit.offset},
      annotations:[Transaction.userEvent.of('input.outliner'),isolateHistory.of('full')],scrollIntoView:true});
  }
  view.focus();return true;
}
