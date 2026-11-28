import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export default function CopilotMentions({ prompt, setPrompt, notes, references, onAttach, onSend, label, onPaste, enabled, listSkills, onSelectSkill }) {
  const inputRef = useRef(null), nextCaret = useRef(null);
  const listId = useId();
  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    inputRef.current.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [prompt]);
  const [token, setToken] = useState(null);
  const [index, setIndex] = useState(0);
  const [skills, setSkills] = useState(null);
  const [skillError, setSkillError] = useState("");
  const active = enabled && token && prompt.slice(token.start, token.end) === token.marker + token.query;
  const pickingSkill = Boolean(active && token.marker === "$" && listSkills);
  useEffect(() => {
    if (!pickingSkill) return;
    let current = true;
    setSkills(null); setSkillError("");
    listSkills().then(result => {
      if (!current) return;
      if (!result.ok) throw new Error(result.error);
      setSkills(result.value);
    }).catch(e => { if (current) { setSkillError(e.message); setSkills([]); } });
    return () => { current = false; };
  }, [pickingSkill, listSkills]);
  const query = token?.query.toLocaleLowerCase() ?? "";
  const matches = pickingSkill ? (skills ?? []).filter(skill =>
    (skill.name + " " + skill.description).toLocaleLowerCase().includes(query)).slice(0, 8)
    : active && token.marker === "#" && references.length < 5 ? notes.filter(note => !references.includes(note.path) &&
      note.path.toLocaleLowerCase().includes(query)).slice(0, 8) : [];
  function update(input) {
    const end = input.selectionStart;
    const match = enabled && input.selectionEnd === end && /(?:^|\s)([#$])([^\s#$][^#$\n]*|)$/u.exec(input.value.slice(0, end));
    setToken(match ? { start: end - match[2].length - 1, end, marker: match[1], query: match[2] } : null);
    setIndex(0);
  }
  function attach(item) {
    nextCaret.current = token.start;
    if (pickingSkill) onSelectSkill(item);
    else onAttach(item.path);
    setPrompt(prompt.slice(0, token.start) + prompt.slice(token.end));
    setToken(null);
  }
  function keyDown(event) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if ((pickingSkill || matches.length) && event.key === "Escape") { event.preventDefault(); setToken(null); return; }
    if (pickingSkill && skills === null && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); return; }
    if (matches.length) {
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
      aria-activedescendant={matches.length ? listId + "-" + Math.min(index, matches.length - 1) : undefined} aria-label={`${label} 질문`} placeholder={enabled && listSkills ? "질문 입력 · #문서 · $스킬 · 이미지 붙여넣기" : enabled ? "질문 입력 · #문서 첨부 · 이미지 붙여넣기" : `${label}에게 물어보세요…`}
      rows={3} value={prompt} onChange={event => { setPrompt(event.target.value); update(event.target); }}
      onClick={event => update(event.target)} onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) update(event.target); }}
      onBlur={() => setToken(null)} onKeyDown={keyDown} onPaste={onPaste} />
    {pickingSkill && !matches.length && <small role="status">{skillError || (skills === null ? "등록된 스킬을 읽는 중…" : skills.length ? "검색 결과가 없습니다." : "Skill · MCP 관리에서 스킬 폴더를 추가하세요.")}</small>}
    {!!matches.length && <div id={listId} role="listbox" className="copilot-mention-list" aria-label={pickingSkill ? "스킬 선택 후보" : "문서 첨부 후보"}>
      {matches.map((item, i) => <button type="button" key={item.path} id={listId + "-" + i} role="option" aria-selected={index === i}
        onMouseDown={event => event.preventDefault()} onClick={() => attach(item)}>{pickingSkill ? <><strong>{item.name}</strong> <span>{item.description}</span></> : item.path}</button>)}
    </div>}
  </>;
}
