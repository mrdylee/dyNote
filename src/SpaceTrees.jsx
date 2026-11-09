import { useEffect, useRef, useState } from "react";
import { spaceLabel } from "../core/document-workspace.mjs";

export default function SpaceTrees({ spaces, renderTree, dropProps }) {
  const container = useRef(null), drag = useRef(null);
  const [split, setSplit] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem("dynote.spaceTreeSplit"));
      return Number.isFinite(value) ? Math.max(20, Math.min(80, value)) : 50;
    } catch { return 50; }
  });
  useEffect(() => { try { localStorage.setItem("dynote.spaceTreeSplit", JSON.stringify(split)); } catch { /* Apply for this session. */ } }, [split]);
  const personal = spaces.filter(scope => scope.purpose === "personal");
  const team = spaces.filter(scope => scope.purpose === "team");
  const divided = personal.length > 0 && team.length > 0;
  const update = value => {
    const height = container.current.clientHeight - 6;
    const min = Math.max(20, Math.min(50, 8400 / Math.max(1, height)));
    setSplit(Math.round(Math.max(min, Math.min(100 - min, value)) * 10) / 10);
  };
  const finish = event => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const render = scopes => scopes.map(scope => <section key={scope.id} className="space-tree" aria-label={spaceLabel(scope)}>
    <h3 {...dropProps(scope.id, "")}>{spaceLabel(scope)}</h3>
    {renderTree(scope)}
  </section>);
  return <div className="space-trees" ref={container}>
    {divided ? <>
      <div className="space-tree-group" style={{ flex: split }}>{render(personal)}</div>
      <div className="space-tree-resize" role="separator" tabIndex={0} aria-orientation="horizontal"
        aria-label="개인 노트와 팀 노트 높이" aria-valuemin={20} aria-valuemax={80} aria-valuenow={split}
        title="드래그 또는 ↑ ↓로 높이 조절 · 두 번 클릭하여 초기화"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus();
          drag.current = { y: event.clientY, height: container.current.firstElementChild.getBoundingClientRect().height,
            total: container.current.clientHeight - event.currentTarget.offsetHeight };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => { if (drag.current) update((drag.current.height + event.clientY - drag.current.y) / Math.max(1, drag.current.total) * 100); }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => setSplit(50)}
        onKeyDown={event => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          update(event.key === "Home" ? 20 : event.key === "End" ? 80 : split + (event.key === "ArrowDown" ? 5 : -5));
        }} />
      <div className="space-tree-group" style={{ flex: 100 - split }}>{render(team)}</div>
    </> : render(spaces)}
  </div>;
}
