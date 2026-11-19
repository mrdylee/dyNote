import { useRef } from "react";
import { defaultPanelWidths, minimumPanelWidths } from "../core/panel-widths.mjs";

export default function PanelResize({ side, width, max, onChange }) {
  const drag = useRef(null);
  const min = minimumPanelWidths[side];
  const update = (value, maxWidth = max) => onChange(Math.round(Math.max(min, Math.min(maxWidth, value))));
  const finish = event => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="panel-resize" role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={`${side === "left" ? "왼쪽" : "오른쪽"} 패널 너비`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
    title="드래그 또는 ← →로 너비 조절 · 두 번 클릭하여 초기화"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { x: event.clientX, width, max };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (!start) return;
      const delta = (event.clientX - start.x) * (side === "left" ? 1 : -1);
      update(start.width + delta, start.max);
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => update(defaultPanelWidths[side])}
    onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      update(event.key === "Home" ? min : event.key === "End" ? max : width + (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1) * (event.shiftKey ? 40 : 10));
    }} />;
}
