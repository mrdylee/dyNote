import { validTextColor, colorOpening, readColorSpan, rewriteTextColors } from "../core/text-color.mjs";
import { EditorSelection, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, unfoldEffect, foldService, ensureSyntaxTree } from '@codemirror/language';
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

const markdownMarkers = { bold: "**", italic: "*", strike: "~~", code: "`" };
export function runMarkdownFormat(view, format) {
  if (!view || view.state.readOnly || !Object.hasOwn(markdownMarkers, format)) return false;
  const state = view.state;
  const changes = state.changeByRange(range => {
    let { from, to } = range;
    let text = state.sliceDoc(from, to);
    if (format !== "code" && /\S/.test(text)) {
      from += /^\s*/.exec(text)[0].length;
      to -= /\s*$/.exec(text)[0].length;
      text = state.sliceDoc(from, to);
    }
    let marker = markdownMarkers[format], insert, anchor, head;
    const codeWrapper = format === "code" && /^(`+)([\s\S]*?)\1$/.exec(text);
    if (codeWrapper) {
      insert = codeWrapper[2];
      if (/^ .* $/.test(insert) && /\S/.test(insert)) insert = insert.slice(1, -1);
      return { changes: { from, to, insert }, range: EditorSelection.range(from, from + insert.length) };
    }
    if (format === "code") {
      const ticks = text.match(/`+/g) ?? [];
      marker = "`".repeat(Math.max(0, ...ticks.map(value => value.length)) + 1);
      const before = /(`+)( ?)$/.exec(state.sliceDoc(0, from));
      const after = /^( ?)(`+)/.exec(state.sliceDoc(to));
      if (before && after && before[1] === after[2] && before[1].length >= marker.length && before[2] === after[1]) {
        from -= before[0].length; to += after[0].length;
        return { changes: { from, to, insert: text }, range: EditorSelection.range(from, from + text.length) };
      }
    }
    const selectedWrapper = text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)
      && (format !== "italic" || (/^\*+/.exec(text)[0].length % 2 === 1 && /\*+$/.exec(text)[0].length % 2 === 1));
    const surroundingWrapper = from >= marker.length && state.sliceDoc(from - marker.length, from) === marker
      && state.sliceDoc(to, to + marker.length) === marker
      && (format !== "italic" || (/\*+$/.exec(state.sliceDoc(0, from))[0].length % 2 === 1 && /^\*+/.exec(state.sliceDoc(to))[0].length % 2 === 1));
    if (selectedWrapper) {
      insert = text.slice(marker.length, -marker.length); anchor = from; head = from + insert.length;
    } else if (surroundingWrapper) {
      from -= marker.length; to += marker.length; insert = text; anchor = from; head = from + text.length;
    } else {
      const pad = format === "code" && (/^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text))) ? " " : "";
      insert = marker + pad + text + pad + marker;
      anchor = from + marker.length + pad.length; head = anchor + text.length;
    }
    return { changes: { from, to, insert }, range: EditorSelection.range(anchor, head) };
  });
  view.dispatch({ ...changes, annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")], scrollIntoView: true });
  view.focus(); return true;
}

export function runTextColor(view, color) {
  if (!view || view.state.readOnly || (color !== null && !validTextColor(color))) return false;
  const state = view.state, source = state.doc.toString(), ranges = state.selection.ranges;
  const tree = ensureSyntaxTree(state, Math.max(...ranges.map(range => range.to)), 100);
  if (!tree) return false;
  const targets = ranges.map(range => {
    if (!range.empty) return {from: range.from, to: range.to};
    for (let node = tree.resolveInner(range.from, 1); node; node = node.parent) {
      if (node.name === "TextColor") { const span = readColorSpan(source, node.from); return {from:span.contentFrom,to:span.contentTo}; }
    }
    return {from:range.from,to:range.to};
  });
  if (ranges.length === 1 && ranges[0].empty && targets[0].from === targets[0].to) {
    if (color === null) return false;
    const open = colorOpening(color), from = ranges[0].from;
    view.dispatch({ changes: {from, insert:open + "</span>"}, selection:{anchor:from+open.length},
      annotations:[Transaction.userEvent.of("input.color"),isolateHistory.of("full")] });
    view.focus(); return true;
  }
  const result = rewriteTextColors(source, tree, targets, ranges, color);
  if (result.content === source) return false;
  let from = 0, oldTo = source.length, newTo = result.content.length;
  while (from < oldTo && from < newTo && source[from] === result.content[from]) from++;
  while (oldTo > from && newTo > from && source[oldTo - 1] === result.content[newTo - 1]) { oldTo--; newTo--; }
  view.dispatch({changes:{from,to:oldTo,insert:result.content.slice(from,newTo)},selection:EditorSelection.create(result.ranges.map(range=>EditorSelection.range(range.anchor,range.head)),state.selection.mainIndex),
    annotations:[Transaction.userEvent.of("input.color"),isolateHistory.of("full")],scrollIntoView:true});
  view.focus(); return true;
}
