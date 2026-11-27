import { useId, useLayoutEffect, useRef, useState } from "react";

export default function CopilotMentions({ prompt, setPrompt, notes, references, onAttach, onSend, label, onPaste, enabled }) {
  const inputRef = useRef(null), nextCaret = useRef(null);
  const listId = useId();
  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    inputRef.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [prompt]);
  const [token, setToken] = useState(null);
  const [index, setIndex] = useState(0);
  const matches = enabled && token && prompt.slice(token.start, token.end) === "#" + token.query && references.length < 5 ? notes.filter(note => !references.includes(note.path) &&
    note.path.toLocaleLowerCase().includes(token.query.toLocaleLowerCase())).slice(0, 8) : [];
  function update(input) {
    const end = input.selectionStart;
    const match = enabled && input.selectionEnd === end && /(?:^|\s)#([^\s#][^#\n]*|)$/u.exec(input.value.slice(0, end));
    setToken(match ? { start: end - match[1].length - 1, end, query: match[1] } : null);
    setIndex(0);
  }
  function attach(note) {
    nextCaret.current = token.start;
    onAttach(note.path);
    setPrompt(prompt.slice(0, token.start) + prompt.slice(token.end));
    setToken(null);
  }
  function keyDown(event) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (matches.length) {
      if (event.key === "Escape") { event.preventDefault(); setToken(null); return; }
      if (["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); setIndex((index + (event.key === "ArrowUp" ? -1 : 1) + matches.length) % matches.length); return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault(); if (!event.repeat) attach(matches[index] ?? matches[0]); return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!event.repeat) onSend(); }
  }
  return <>
    <textarea ref={inputRef} aria-autocomplete="list" aria-controls={matches.length ? listId : undefined}
      aria-activedescendant={matches.length ? listId + "-" + Math.min(index, matches.length - 1) : undefined} aria-label={`${label} 질문`} placeholder={enabled ? "질문 입력 · #문서 첨부 · 이미지 붙여넣기" : `${label}에게 물어보세요…`}
      rows={3} value={prompt} onChange={event => { setPrompt(event.target.value); update(event.target); }}
      onClick={event => update(event.target)} onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) update(event.target); }}
      onBlur={() => setToken(null)} onKeyDown={keyDown} onPaste={onPaste} />
    {!!matches.length && <div id={listId} role="listbox" className="copilot-mention-list" aria-label="문서 첨부 후보">
      {matches.map((note, i) => <button type="button" key={note.path} id={listId + "-" + i} role="option" aria-selected={index === i}
        onMouseDown={event => event.preventDefault()} onClick={() => attach(note)}>{note.path}</button>)}
    </div>}
  </>;
}
