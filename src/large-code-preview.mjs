import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { classHighlighter, highlightTree } from "@lezer/highlight";

// Keep the actual text nodes stable for native selection and document search.
// Only intersecting chunks own paint ranges, even after scrolling through the entire note.
export function highlightLargeFence(block, source, language) {
  const doc = block.ownerDocument, win = doc.defaultView;
  const offsets = new Map(), pending = new Set(), painted = new Map();
  let state, idle, disposed = false;

  function clear(chunk) {
    pending.delete(chunk);
    for (const [name, range] of painted.get(chunk) ?? []) {
      const highlight = win.CSS.highlights.get(name);
      highlight.delete(range);
      if (!highlight.size) win.CSS.highlights.delete(name);
    }
    painted.delete(chunk);
  }

  function paint() {
    idle = undefined;
    const chunk = pending.values().next().value;
    if (!chunk) return;
    state ??= EditorState.create({ doc: source, extensions: [language] });
    const node = chunk.firstChild, from = offsets.get(chunk), to = from + node.length;
    // Continue the same parse across chunks, including multiline strings and comments.
    const tree = ensureSyntaxTree(state, to, 5);
    if (tree) {
      pending.delete(chunk);
      const ranges = [];
      highlightTree(tree, classHighlighter, (start, end, classes) => {
        const range = new win.StaticRange({
          startContainer: node, startOffset: start - from,
          endContainer: node, endOffset: end - from,
        });
        for (const name of classes.split(" ")) {
          let highlight = win.CSS.highlights.get(name);
          if (!highlight) {
            highlight = new win.Highlight();
            highlight.priority = name === "tok-definition" ? -1 : -2;
            win.CSS.highlights.set(name, highlight);
          }
          highlight.add(range);
          ranges.push([name, range]);
        }
      }, from, to);
      painted.set(chunk, ranges);
    }
    schedule();
  }

  function schedule() {
    if (pending.size && idle === undefined) idle = win.requestIdleCallback(paint, { timeout: 100 });
  }

  const observer = new win.IntersectionObserver(entries => {
    if (disposed) return;
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) clear(target);
      else if (!painted.has(target)) pending.add(target);
    }
    schedule();
  });

  const fragment = doc.createDocumentFragment();
  for (let from = 0; from < source.length;) {
    let to = Math.min(from + 2048, source.length);
    if (to < source.length && /[\uDC00-\uDFFF]/.test(source[to])) to++;
    const chunk = doc.createElement("span");
    chunk.textContent = source.slice(from, to);
    fragment.append(chunk);
    offsets.set(chunk, from);
    from = to;
  }
  block.replaceChildren(fragment);
  for (const chunk of offsets.keys()) observer.observe(chunk);
  return () => {
    disposed = true;
    observer.disconnect();
    if (idle !== undefined) win.cancelIdleCallback(idle);
    for (const chunk of painted.keys()) clear(chunk);
    if (block.isConnected) block.textContent = source;
  };
}
