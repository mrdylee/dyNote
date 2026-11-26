import { Plus, StickyNote } from "lucide-react";
import { STICKY_COLORS } from "../core/sticky-layout.mjs";
import { stickyHeading } from "../core/sticky-title.mjs";
import "./sticky-board.css";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" });

function previewText(body) {
  return body.trim().split(/\r\n|[\r\n]/, 4).map(line => line
    .replace(/^(\s*)[-*+]\s+\[([ xX])\]\s*/, (_, indent, check) => indent + (check === " " ? "☐ " : "☑ "))
    .replace(/^(\s*)[-*+]\s+/, "$1• ")).join("\n");
}

function paperColor(path) {
  let hash = 0;
  for (const character of path) hash = (31 * hash + character.codePointAt(0)) >>> 0;
  return STICKY_COLORS[hash % STICKY_COLORS.length];
}

export default function StickyBoard({ cards, onOpen, available }) {
  return <section className="sticky-board" aria-label="포스트잇 보드">
    <header className="sticky-board-header">
      <div><h1>포스트잇 보드</h1><p>{cards.length}개의 메모 · 최근 수정순</p></div>
      <button type="button" className="sticky-board-new" disabled={!available} onClick={() => onOpen()}>
        <Plus size={16} aria-hidden="true"/> 새 포스트잇
      </button>
    </header>
    {cards.length === 0 && <div className="sticky-board-empty">
      <StickyNote size={30} aria-hidden="true"/>
      <p>{available ? "아직 포스트잇이 없습니다." : "개인 보관함을 연결해 주세요."}</p>
    </div>}
    <div className="sticky-board-grid">
      {cards.map(note => {
        const { title, end } = stickyHeading(note.content);
        return <button className="sticky-board-card" type="button" key={note.path}
          data-paper={paperColor(note.path)} aria-label={title} title={note.path} onClick={() => onOpen(note.path)}>
          <strong>{title}</strong>
          <span className="sticky-board-preview">{previewText(note.content.slice(end))}</span>
          <small>{dateFormat.format(note.metadata.mtime)}</small>
        </button>;
      })}
    </div>
  </section>;
}
