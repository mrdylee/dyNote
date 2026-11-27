import { useEffect, useEffectEvent, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

// The mode buttons and the document are siblings inside the center workspace.
export function useDocumentFind(anchor, active, open) {
  const onOpen = useEffectEvent(open);
  useEffect(() => {
    const workspace = active && anchor.current?.closest(".workspace");
    if (!workspace) return;
    function keydown(event) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        onOpen(event.target);
      }
    }
    workspace.addEventListener("keydown", keydown, true);
    return () => workspace.removeEventListener("keydown", keydown, true);
  }, [anchor, active]);
}

export function DocumentSearchHost({ host, scope, onScope, onClose, children }) {
  const [expanded, setExpanded] = useState(false);
  return <div ref={host} className={`document-search-host${expanded ? " find-expanded" : ""}`}>
    {children}
    <div className="find-controls" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}>
      <button className="find-options" type="button" aria-label="검색 옵션" title="검색 옵션"
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><SlidersHorizontal size={15}/></button>
      {scope && <div className="find-scope" role="group" aria-label="검색 대상">
        {[["editor", "작성"], ["preview", "미리보기"]].map(([value, label]) =>
          <button key={value} type="button" aria-pressed={scope === value}
            onClick={() => onScope(value)}>{label}</button>)}
      </div>}
    </div>
  </div>;
}

// Inline formatting can split a single match across several DOM text nodes.
function findRanges(root, query, mindmap) {
  if (!query.valid) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      // KaTeX marks its visible HTML aria-hidden and may also provide a separate MathML copy.
      if (node.matches("style, script, [hidden], .katex-mathml, [aria-hidden=true]:not(.katex > .katex-html)")) {
        return NodeFilter.FILTER_REJECT;
      }
      // Markdown line breaks can already have a newline in the following text node.
      return node.tagName === "BR" && !node.nextSibling?.data?.startsWith("\n")
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  const ranges = [];
  let block, nodes = [];
  function searchBlock() {
    if (!nodes.length) return;
    const text = Text.of(nodes.map(n => n.data ?? "\n").join("").split("\n"));
    let index = 0, offset = 0;
    for (const { from, to } of query.getCursor(text)) {
      if (from === to) continue;
      // An accepted <br> occupies one character in the searchable text.
      while (offset + (nodes[index].length ?? 1) <= from) offset += nodes[index++].length ?? 1;
      const range = new Range();
      if (nodes[index].nodeType === Node.TEXT_NODE) range.setStart(nodes[index], from - offset);
      else range.setStartBefore(nodes[index]);
      while (offset + (nodes[index].length ?? 1) < to) offset += nodes[index++].length ?? 1;
      if (nodes[index].nodeType === Node.TEXT_NODE) range.setEnd(nodes[index], to - offset);
      else range.setEndAfter(nodes[index]);
      ranges.push(range);
    }
    nodes = [];
  }
  for (let node; (node = walker.nextNode());) {
    const parent = node.parentElement;
    const group = mindmap ? parent.closest(".mindmap-node > span") :
      parent.closest("p,h1,h2,h3,h4,h5,h6,li,td,th,pre,blockquote,div,article,text");
    if (group !== block) { searchBlock(); block = group; }
    if (group) nodes.push(node);
  }
  searchBlock();
  return ranges;
}

export default function RenderedDocumentFind({ target, onClose, revealNode, initialQuery, onQueryChange }) {
  const [query, setQuery] = useState(() => initialQuery ?? new SearchQuery({ search: "" }));
  const { search } = query;
  function change(values) {
    const next = new SearchQuery({ ...query, ...values });
    setQuery(next);
    onQueryChange?.(next);
  }
  const [ranges, setRanges] = useState([]);
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  useEffect(() => { input.current.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const root = revealNode ? target.current?.querySelector(".react-flow__nodes") : target.current;
    if (!root) return;
    function refresh() {
      const matches = findRanges(root, query, !!revealNode);
      const highlight = new Highlight();
      for (const range of matches) highlight.add(range);
      CSS.highlights.set("note-find", highlight);
      setRanges(matches);
      setIndex(0);
    }
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); CSS.highlights.delete("note-find"); };
  }, [target, query, revealNode]);
  useEffect(() => {
    const range = ranges[index];
    if (!range) return;
    const current = new Highlight(range);
    current.priority = 1;
    CSS.highlights.set("note-find-current", current);
    if (revealNode) revealNode(range.startContainer.parentElement.closest(".react-flow__node").dataset.id);
    else {
      const pane = target.current.closest(".document-pane");
      const rect = range.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
      const panel = input.current.closest(".pane-header").getBoundingClientRect();
      if (rect.top < panel.bottom || rect.bottom > bounds.bottom) {
        pane.scrollTop += rect.top - (panel.bottom + bounds.bottom) / 2;
      }
    }
    return () => CSS.highlights.delete("note-find-current");
  }, [ranges, index, target, revealNode]);
  function move(step) {
    if (ranges.length) setIndex(i => (i + step + ranges.length) % ranges.length);
  }
  return <div className="cm-panel cm-search rendered-find" role="search" aria-label="문서에서 찾기"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Enter" && event.target === input.current && !event.nativeEvent.isComposing) {
        event.preventDefault(); move(event.shiftKey ? -1 : 1);
      }
    }}>
    <input ref={input} className="cm-textfield" name="search" aria-label="문서에서 찾기" placeholder="문서에서 찾기"
      value={search} onChange={e => change({ search: e.target.value })}/>
    <button type="button" name="close" aria-label="닫기" onClick={onClose}>×</button>
    {search && <span role="status">{ranges.length ? `${index + 1} / ${ranges.length}` : "결과 없음"}</span>}
    <button type="button" name="prev" disabled={!ranges.length} onClick={() => move(-1)}>이전</button>
    <button type="button" name="next" disabled={!ranges.length} onClick={() => move(1)}>다음</button>
    {[["caseSensitive","대소문자 구분"],["regexp","정규식"],["wholeWord","단어 단위"]].map(([key,label]) =>
      <label key={key}><input type="checkbox" checked={query[key]} onChange={e => change({ [key]: e.target.checked })}/>{label}</label>)}
  </div>;
}
