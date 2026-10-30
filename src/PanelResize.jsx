import { useRef } from "react";
import { defaultPanelWidths, panelBounds } from "../core/panel-widths.mjs";

export default function PanelResize({ side, width, max, onChange }) {
  const drag = useRef(null);
  const [min, limit] = panelBounds[side];
  const update = value => onChange(Math.round(Math.max(min, Math.min(max, limit, value))));
  const finish = event => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="panel-resize" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={`${side === "left" ? "왼쪽" : "오른쪽"} 패널 너비`} aria-valuemin={min} aria-valuemax={Math.min(max, limit)} aria-valuenow={width}
    title="드래그 또는 ← →로 너비 조절 · 두 번 클릭하여 초기화"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { if (drag.current) update(drag.current.width + (event.clientX - drag.current.x) * (side === "left" ? 1 : -1)); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => update(defaultPanelWidths[side])}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      update(event.key === "Home" ? min : event.key === "End" ? max : width + (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * (event.shiftKey ? 40 : 10));
    }} />;
}
