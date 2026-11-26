import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";

export function lineContent(state, line, tree) {
  let from, to;
  const styles = [];
  tree.iterate({ from: line.from, to: line.to, enter(node) {
    if (node.to <= line.from || node.from >= line.to) return false;
    if (/^(FencedCode|CodeBlock|HTMLBlock|Table)$/.test(node.name)) return false;
    if (/^(Paragraph|Task|ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)) {
      from = Math.max(line.from, node.from);
      to = Math.min(line.to, node.to);
    } else if (from != null) {
      if (/^(HeaderMark|QuoteMark|TaskMarker)$/.test(node.name)) {
        if (!state.sliceDoc(from, node.from).trim()) from = node.to;
        else to = Math.min(to, node.from);
      } else if (node.name === "HardBreak") to = Math.min(to, node.from);
      else if (node.name === "TextStyle") styles.push(node.node);
    }
  } });
  if (from == null || from >= to) return null;
  const content = state.sliceDoc(from, to);
  from += /^\s*/.exec(content)[0].length;
  to -= /\s*$/.exec(content)[0].length;
  // With a whole-line style, toggle formatting on its contents, inside the stored span.
  for (const style of styles) {
    if (style.from === from && style.to === to) {
      from = style.firstChild.to;
      to = style.lastChild.from;
    }
  }
  return from < to ? EditorSelection.range(from, to) : null;
}

export function frontmatterEnd(doc) {
  return /^\uFEFF?---$/.test(doc.line(1).text)
    ? /^\uFEFF?---\n[\s\S]*?\n(?:---|\.\.\.)(?:\n|$)/.exec(doc.toString())?.[0].length ?? 0 : 0;
}

export function runSelectionOrLine(view, command) {
  if (!view || view.composing || view.state.readOnly) return false;
  const { state } = view;
  const { doc, selection } = state;
  const cursors = selection.ranges.filter(range => range.empty);
  if (!cursors.length) return command(view);
  const max = doc.lineAt(cursors.at(-1).head).to;
  const tree = ensureSyntaxTree(state, max, 100);
  if (!tree) return false;
  const metadataEnd = frontmatterEnd(doc);
  const ranges = selection.ranges.map(range => {
    if (!range.empty) return range;
    if (range.head < metadataEnd) return null;
    const line = doc.lineAt(range.head);
    // On an empty prose line the original inline commands prepare formatting for typing.
    if (!line.length && tree.resolveInner(range.head).name === "Document") return range;
    return lineContent(state, line, tree);
  });
  if (ranges.some(range => !range)) return false;

  // Give the command its target selection without dispatching a separate selection event.
  // The single edit on the real view remembers the original caret for Undo.
  const targeted = state.update({ selection: EditorSelection.create(ranges, selection.mainIndex) }).state;
  return command({ state: targeted, dispatch: spec => view.dispatch(spec), focus: () => view.focus() });
}
