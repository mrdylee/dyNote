import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from "lucide-react";
import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, SearchQuery, selectMatches, setSearchQuery } from "@codemirror/search";

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

export default function DocumentFind({ target, editor, editorState, scope, onScope, onClose, revealNode }) {
  const [query, setQuery] = useState(() => editorState ? getSearchQuery(editorState) : new SearchQuery({ search: "" }));
  const [expanded, setExpanded] = useState(false);
  const source = scope === "editor";
  const doc = source ? editorState?.doc : null;
  const matches = useMemo(() => doc && query.valid ? Array.from(query.getCursor(editor.state)) : [], [doc, editor, query]);
  const selection = source && editorState?.selection.main;
  const selected = selection ? matches.findIndex(m => m.from === selection.from && m.to === selection.to) : -1;
  const canReplace = source && editorState && !editorState.readOnly;
  function change(values) { setQuery(q => new SearchQuery({ ...q, ...values })); }
  useLayoutEffect(() => {
    if (source && editor) editor.dispatch({effects: setSearchQuery.of(query)});
  }, [source, editor, query]);
  const revealEditorMatch = useEffectEvent(() => {
    if (!source || !editor) return;
    const current = editor.state.selection.main;
    const match = matches.find(m => m.from === current.from && m.to === current.to) ??
      matches.find(m => m.from >= current.from) ?? matches[0];
    if (match) editor.dispatch({ selection: {anchor:match.from, head:match.to},
      effects:EditorView.scrollIntoView(match.from, {y:"center"}) });
  });
  // Editing the note or the replacement field must not move the user's caret.
  useLayoutEffect(() => {
    revealEditorMatch();
  }, [source, editor, query.search, query.regexp, query.caseSensitive, query.wholeWord]);
  const [ranges, setRanges] = useState([]);
  const [index, setIndex] = useState(0);
  const input = useRef(null);
  useLayoutEffect(() => { input.current.focus({ preventScroll: true }); input.current.select(); }, [scope]);
  useEffect(() => {
    if (source) return;
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
  }, [source, target, query, revealNode]);
  useEffect(() => {
    const range = ranges[index];
    if (source || !range) return;
    const current = new Highlight(range);
    current.priority = 1;
    CSS.highlights.set("note-find-current", current);
    if (revealNode) revealNode(range.startContainer.parentElement.closest(".react-flow__node").dataset.id);
    else {
      const pane = target.current.closest(".document-pane");
      const scroller = target.current.closest(".split .preview-column") ?? pane;
      const rect = range.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
      const top = scroller === pane ? pane.querySelector(".pane-header").getBoundingClientRect().bottom : bounds.top;
      if (rect.top < top || rect.bottom > bounds.bottom) {
        scroller.scrollTop += rect.top - (top + bounds.bottom) / 2;
      }
    }
    return () => CSS.highlights.delete("note-find-current");
  }, [source, ranges, index, target, revealNode]);
  const total = source ? matches.length : ranges.length;
  const position = source ? selected + 1 : index + 1;
  function move(step) {
    if (!total) return;
    if (source) (step > 0 ? findNext : findPrevious)(editor);
    else setIndex(i => (i + step + total) % total);
  }
  return <div className="document-find" role="search" aria-label="문서에서 찾기" data-scope={scope}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if ((event.key === "Enter" && event.target === input.current) || event.key === "F3" ||
          ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g")) {
        event.preventDefault(); move(event.shiftKey ? -1 : 1);
      }
    }}>
    <div className="document-find-row">
      <input ref={input} name="search" aria-label="문서에서 찾기" placeholder="문서에서 찾기"
        value={query.search} onChange={e => change({ search: e.target.value })}/>
      <span role="status" title={total ? `${position} / ${total}` : undefined}>
        {query.search && (total ? `${position} / ${total}` : "결과 없음")}
      </span>
      <select aria-label="검색 대상" value={scope} disabled={!onScope} onChange={e => onScope(e.target.value)}>
        {(onScope || source) && <option value="editor">작성</option>}
        {(onScope || scope === "preview") && <option value="preview">미리보기</option>}
        {scope === "mindmap" && <option value="mindmap">마인드맵</option>}
      </select>
      <button aria-label="이전" title="이전 (Shift+Enter)" disabled={!total} onClick={() => move(-1)}><ChevronUp/></button>
      <button aria-label="다음" title="다음 (Enter)" disabled={!total} onClick={() => move(1)}><ChevronDown/></button>
      <button aria-label="검색 옵션" title="검색 옵션" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><SlidersHorizontal/></button>
      <button aria-label="닫기" title="닫기 (Esc)" onClick={onClose}><X/></button>
    </div>
    {expanded && <div className="document-find-options">
      <div>{[["caseSensitive","대소문자 구분"],["regexp","정규식"],["wholeWord","단어 단위"]].map(([key,label]) =>
        <label key={key}><input type="checkbox" checked={query[key]} onChange={e => change({ [key]: e.target.checked })}/>{label}</label>)}
        <button disabled={!source || !total} onClick={() => selectMatches(editor)}>모두 선택</button>
      </div>
      <div><input name="replace" aria-label="바꿀 내용" placeholder="바꿀 내용" value={query.replace}
        disabled={!canReplace} onChange={e => change({ replace: e.target.value })}
        onKeyDown={e => { if (e.key==="Enter" && !e.nativeEvent.isComposing && total) {e.preventDefault(); replaceNext(editor);} }}/>
        <button disabled={!canReplace || !total} onClick={() => replaceNext(editor)}>바꾸기</button>
        <button disabled={!canReplace || !total} onClick={() => replaceAll(editor)}>모두 바꾸기</button>
      </div>
    </div>}
  </div>;
}
