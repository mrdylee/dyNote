import { validTextColor, colorOpening, readColorSpan, rewriteTextColors } from "../core/text-color.mjs";
import { EditorSelection, Transaction, countColumn, findColumn } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, unfoldEffect, foldService, ensureSyntaxTree, language } from '@codemirror/language';
import { outlineEdit, outlineRange } from '../core/outliner.mjs';
import { parseMetadata } from '../core/metadata.mjs';

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

const taskLikeText = /^\[[xX ]\](?:[ \t]|$)/;

export function runBulletFormat(view, format, position) {
  if (!view || view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
  const { state } = view, { doc } = state;
  const selection = state.selection.main;
  const range = position == null || (selection.from <= position && position <= selection.to)
    ? selection : EditorSelection.cursor(position);
  const first = doc.lineAt(range.from), last = doc.lineAt(range.empty ? range.to : range.to - 1);
  const source = doc.toString();
  const metadataEnd = source.length - parseMetadata(source).body.length;
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const tree = bom ? state.facet(language)?.parser.parse(source.slice(1)) : ensureSyntaxTree(state, last.to, 100);
  if (!tree) return false;

  const edits = [], breaks = new Set(), dedent = new Map();
  const markdownTabSize = 4;
  tree.iterate({ from: Math.max(0, first.from - bom), to: Math.max(0, last.to - bom), enter(ref) {
    const start = ref.from + bom;
    if (start < metadataEnd) return;
    const node = ref.node;
    if (format === "bullet-list" && ref.name === "Paragraph") {
      const nestedProse = node.parent?.name === "ListItem" && node.prevSibling?.name !== "ListMark";
      if (node.parent?.name !== "Document" && !nestedProse) return;
      const startLine = doc.lineAt(start), endLine = doc.lineAt(ref.to + bom - 1);
      const escapeTask = taskLikeText.test(doc.sliceString(start, startLine.to));
      edits.push({ from: start, insert: escapeTask ? "- \\" : "- " });
      for (let number = startLine.number + 1; number <= endLine.number; number++)
        edits.push({ from: doc.line(number).from, insert: "  " });
    }
    if (format !== "paragraph" || ref.name !== "ListItem" || node.parent?.name !== "BulletList") return;
    const mark = node.getChild("ListMark"), body = mark?.nextSibling;
    if (!mark || (body && body.name !== "Paragraph")) return;
    const startLine = doc.lineAt(start), endLine = doc.lineAt(ref.to + bom - 1);
    const bodyEnd = body ? doc.lineAt(body.to + bom - 1) : startLine;
    if (first.number > bodyEnd.number || last.number < startLine.number) return;
    const indent = doc.sliceString(Math.max(startLine.from, bom), start);
    if (!/^[\t ]*$/.test(indent)) return;
    const bodyStart = body ? body.from + bom : startLine.to;
    const unescapeTask = bodyStart < startLine.to && doc.sliceString(bodyStart, bodyStart + 1) === "\\"
      && taskLikeText.test(doc.sliceString(bodyStart + 1, startLine.to));
    edits.push({ from: start, to: Math.min(bodyStart + Number(unescapeTask), startLine.to) });
    const baseColumn = countColumn(indent, markdownTabSize);
    const bodyColumn = bodyStart > startLine.to ? baseColumn + 2
      : countColumn(doc.sliceString(Math.max(startLine.from, bom), bodyStart), markdownTabSize);
    for (let number = startLine.number + 1; number <= endLine.number; number++) {
      const line = doc.line(number), prefix = /^[\t ]*/.exec(line.text)[0];
      if (countColumn(prefix, markdownTabSize) < bodyColumn) continue;
      const previous = dedent.get(number);
      // Ancestor and child edits share continuation lines, so remove their indentation together.
      dedent.set(number, {
        line, prefix,
        width: (previous?.width ?? 0) + bodyColumn - baseColumn,
        through: Math.max(previous?.through ?? 0, bodyColumn),
      });
    }
    if (startLine.number > 1 && doc.line(startLine.number - 1).text.trim()) breaks.add(startLine.from - 1);
    if (bodyEnd.number < doc.lines && doc.line(bodyEnd.number + 1).text.trim()) breaks.add(bodyEnd.to);
  } });
  for (const { line, prefix, width, through } of dedent.values()) {
    const cut = findColumn(prefix, through, markdownTabSize);
    const remaining = countColumn(prefix, markdownTabSize, cut) - width;
    edits.push({ from: line.from, to: line.from + cut, insert: " ".repeat(remaining) });
  }
  for (const from of breaks) edits.push({ from, insert: "\n" });

  if (!edits.length && format === "bullet-list" && range.empty && !first.text.trim()
    && range.head >= metadataEnd && tree.resolveInner(Math.max(0, range.head - bom)).name === "Document") {
    const separator = first.number > 1 && doc.line(first.number - 1).text.trim() ? "\n" : "";
    edits.push({ from: Math.max(first.from, bom), to: first.to, insert: separator + "- " });
  }
  if (!edits.length) return false;
  const changes = state.changes(edits);
  view.dispatch({ changes, selection: EditorSelection.create([range.map(changes, 1)]),
    annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")], scrollIntoView: true });
  view.focus();
  return true;
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
