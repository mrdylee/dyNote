import { highlightColor, validTextColor, validTextSize, styleOpening, readStyleSpan, rewriteTextStyle } from "../core/text-color.mjs";
import { EditorSelection, Transaction, countColumn, findColumn } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { foldEffect, unfoldEffect, foldService, ensureSyntaxTree, language } from '@codemirror/language';
import { outlineEdit, outlineRange } from '../core/outliner.mjs';
import { frontmatterEnd, lineContent } from './format-line.mjs';
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
  const marks = { bold: "StrongEmphasis", italic: "Emphasis", strike: "Strikethrough" };
  const formatRange = range => {
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
    // Merge complete runs of the requested style when a selection also contains plain text.
    // Two different runs can start and end with the same marker without enclosing the selection.
    if (format !== "code" && /[*_~]/.test(text)) {
      const delimiters = [];
      let whole;
      tree?.iterate({ from, to, enter(ref) {
        if (ref.name !== marks[format] || ref.from < from || ref.to > to) return;
        const node = ref.node;
        if (ref.from === from && ref.to === to) whole = node;
        // In ***text*** the strong run can sit just inside the emphasis markers.
        if (format === "bold" && ref.from === from + 1 && ref.to === to - 1 && node.parent?.name === "Emphasis"
          && node.parent.from === from && node.parent.to === to) whole = node;
        delimiters.push(node.firstChild, node.lastChild);
      } });
      if (whole) {
        const body = state.sliceDoc(from, whole.firstChild.from) + state.sliceDoc(whole.firstChild.to, whole.lastChild.from)
          + state.sliceDoc(whole.lastChild.to, to);
        return { changes: { from, to, insert: body }, range: EditorSelection.range(from, from + body.length), addsStyle: false };
      }
      if (delimiters.length) {
        let body = "", pos = from;
        for (const mark of delimiters.sort((a, b) => a.from - b.from)) {
          body += state.sliceDoc(pos, mark.from);
          pos = mark.to;
        }
        body += state.sliceDoc(pos, to);
        return { changes: { from, to, insert: marker + body + marker },
          range: EditorSelection.range(from + marker.length, from + marker.length + body.length), addsStyle: true };
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
    return { changes: { from, to, insert }, range: EditorSelection.range(anchor, head), addsStyle: !selectedWrapper && !surroundingWrapper };
  };
  const multiline = range => format !== "code" && state.doc.lineAt(range.from).number !== state.doc.lineAt(range.to).number;
  const multilineRanges = state.selection.ranges.filter(multiline);
  const needsTree = multilineRanges.length || (format !== "code" && state.selection.ranges.some(r => /[*_~]/.test(state.sliceDoc(r.from, r.to))));
  const tree = needsTree ? ensureSyntaxTree(state, state.doc.lineAt(state.selection.ranges.at(-1).to).to, 100) : null;
  if (multilineRanges.length && !tree) return false;
  const startOfBody = multilineRanges.length ? frontmatterEnd(state.doc) : 0;
  const changes = state.changeByRange(range => {
    if (!multiline(range)) return formatRange(range);
    const edits = [];
    const first = state.doc.lineAt(range.from).number, last = state.doc.lineAt(range.to - 1).number;
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n);
      if (line.from < startOfBody) continue;
      const body = lineContent(state, line, tree);
      if (!body) continue;
      const from = Math.max(range.from, body.from), to = Math.min(range.to, body.to);
      if (from < to && /\S/.test(state.sliceDoc(from, to))) edits.push(formatRange({ from, to }));
    }
    // A mixed selection gains the style on its plain lines; a fully styled selection removes it.
    const additions = edits.filter(edit => edit.addsStyle);
    const combined = state.changes((additions.length ? additions : edits).map(edit => edit.changes));
    return { changes: combined, range: range.map(combined) };
  });
  if (changes.changes.empty) return false;
  view.dispatch({ ...changes, annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")], scrollIntoView: true });
  view.focus(); return true;
}

const taskLikeText = /^\[[xX ]\](?:[ \t]|$)/;

export function contextSelectionContains(doc, range, position) {
  if (position < range.from || position > range.to) return false;
  // A selection ending at column zero excludes the following line.
  return range.empty || position < range.to || position !== doc.lineAt(position).from;
}

function bulletFormatPlan(view, format, position) {
  if (!view || view.state.readOnly || view.composing || view.state.selection.ranges.length !== 1) return false;
  const { state } = view, { doc } = state;
  const selection = state.selection.main;
  const range = position == null || contextSelectionContains(doc, selection, position)
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
  return edits.length ? { edits, range } : null;
}

export function availableBulletFormats(view, position) {
  return ["bullet-list", "paragraph"].filter(format => bulletFormatPlan(view, format, position));
}

export function runBulletFormat(view, format, position) {
  const plan = bulletFormatPlan(view, format, position);
  if (!plan) return false;
  const { edits, range } = plan;
  const changes = view.state.changes(edits);
  view.dispatch({ changes, selection: EditorSelection.create([range.map(changes, 1)]),
    annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")], scrollIntoView: true });
  view.focus();
  return true;
}

export function runTextColor(view, color) {
  if (color !== null && !validTextColor(color)) return false;
  return runInlineStyle(view, "color", color);
}

export function runTextSize(view, size) {
  if (size !== null && !validTextSize(size)) return false;
  return runInlineStyle(view, "font-size", size);
}

export function runHighlight(view, enabled) {
  return runInlineStyle(view, "background-color", enabled ? highlightColor : null);
}

function runInlineStyle(view, property, value) {
  if (!view || view.state.readOnly || view.composing) return false;
  const state = view.state, source = state.doc.toString(), ranges = state.selection.ranges;
  const tree = ensureSyntaxTree(state, Math.max(...ranges.map(range => range.to)), 100);
  if (!tree) return false;
  const targets = ranges.map(range => {
    if (!range.empty) return {from: range.from, to: range.to};
    for (let node = tree.resolveInner(range.from, 1); node; node = node.parent) {
      if (node.name === "TextStyle") {
        const span = readStyleSpan(source, node.from);
        if (span.property === property) return {from:span.contentFrom,to:span.contentTo, span};
      }
    }
    return {from:range.from,to:range.to};
  });
  if (ranges.length === 1 && ranges[0].empty && targets[0].from === targets[0].to) {
    const existing = targets[0].span;
    if (!existing && value === null) return false;
    const open = value === null ? "" : styleOpening(property, value);
    const from = existing?.from ?? ranges[0].from, to = existing?.to ?? from;
    const insert = open ? open + "</span>" : "";
    if (state.sliceDoc(from, to) === insert) return false;
    view.dispatch({ changes: {from, to, insert}, selection:{anchor:from+open.length},
      annotations:[Transaction.userEvent.of("input.format"),isolateHistory.of("full")] });
    view.focus(); return true;
  }
  const result = rewriteTextStyle(source, tree, targets, ranges, property, value);
  if (result.content === source) return false;
  let from = 0, oldTo = source.length, newTo = result.content.length;
  while (from < oldTo && from < newTo && source[from] === result.content[from]) from++;
  while (oldTo > from && newTo > from && source[oldTo - 1] === result.content[newTo - 1]) { oldTo--; newTo--; }
  view.dispatch({changes:{from,to:oldTo,insert:result.content.slice(from,newTo)},selection:EditorSelection.create(result.ranges.map(range=>EditorSelection.range(range.anchor,range.head)),state.selection.mainIndex),
    annotations:[Transaction.userEvent.of("input.format"),isolateHistory.of("full")],scrollIntoView:true});
  view.focus(); return true;
}
