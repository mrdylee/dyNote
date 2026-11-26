import { useMemo } from "react";
import { Plus, StickyNote } from "lucide-react";
import { isStickyPath } from "../core/sticky-layout.mjs";
import { stickyTitle } from "../core/sticky-title.mjs";
import "./sticky-picker.css";

export default function StickyPicker({ notes, onOpen }) {
  const cards = useMemo(() => notes.filter(note => isStickyPath(note.path))
    .sort((a, b) => b.metadata.mtime - a.metadata.mtime || a.path.localeCompare(b.path, "ko")), [notes]);
  return (
    <div className="sticky-rail">
      <button type="button" className="icon-button sticky-trigger" title="스티키 노트" aria-label="스티키 노트"
        popoverTarget="sticky-picker">
        <StickyNote size={20} aria-hidden="true"/>
      </button>
      <section id="sticky-picker" className="sticky-picker" popover="auto" aria-label="스티키 노트">
        <div className="sticky-picker-head">
          <strong>스티키 노트</strong><span className="sticky-count">{cards.length}</span>
          <button className="sticky-picker-new" type="button" title="새 스티키 노트" aria-label="새 스티키 노트"
            popoverTarget="sticky-picker" popoverTargetAction="hide" onClick={() => onOpen()}>
            <Plus size={16} aria-hidden="true"/>
          </button>
        </div>
        <div className="sticky-picker-list">
          {cards.length === 0 && <p>＋를 눌러 첫 메모를 작성하세요.</p>}
          {cards.map(note => (
            <button key={note.path} type="button" className="sticky-picker-row" title={note.path}
              popoverTarget="sticky-picker" popoverTargetAction="hide" onClick={() => onOpen(note.path)}>
              <StickyNote size={14} aria-hidden="true"/><span>{stickyTitle(note.content)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
