import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, StickyNote } from "lucide-react";
import { isStickyPath } from "../core/sticky-layout.mjs";
import { stickyTitle } from "../core/sticky-title.mjs";
import "./sticky-picker.css";

export default function StickyPicker({ notes, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const cards = useMemo(() => notes.filter(note => isStickyPath(note.path))
    .sort((a, b) => b.metadata.mtime - a.metadata.mtime || a.path.localeCompare(b.path, "ko")), [notes]);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <section className="sticky-picker" aria-label="스티키 노트">
      <div className="sticky-picker-head">
        <button type="button" className="sticky-picker-toggle" aria-label={`스티키 노트 목록 ${cards.length}개`}
          aria-expanded={expanded} aria-controls="sticky-picker-list" onClick={() => setExpanded(!expanded)}>
          <StickyNote size={17} className="sticky-paper" aria-hidden="true"/>
          <strong>스티키 노트</strong><span className="sticky-count">{cards.length}</span>
          <Chevron size={14} aria-hidden="true"/>
        </button>
        <button className="sticky-picker-new" type="button" title="새 스티키 노트" aria-label="새 스티키 노트" onClick={() => onOpen()}>
          <Plus size={16} aria-hidden="true"/>
        </button>
      </div>
      <div id="sticky-picker-list" hidden={!expanded}>
        {cards.length === 0 && <p>＋를 눌러 첫 메모를 작성하세요.</p>}
        {expanded && cards.map(note => {
          const title = stickyTitle(note.content);
          return <button key={note.path} type="button" className="sticky-picker-row" title={note.path} onClick={() => onOpen(note.path)}>
            <StickyNote size={13} aria-hidden="true"/><span>{title}</span>
          </button>;
        })}
      </div>
    </section>
  );
}
