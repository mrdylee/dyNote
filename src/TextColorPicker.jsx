import { useEffect, useRef, useState } from "react";
import { validTextColor } from "../core/text-color.mjs";

const presets = [
  ["검정", "#212121"], ["회색", "#757575"], ["흰색", "#ffffff"],
  ["빨강", "#c62828"], ["주황", "#ef6c00"], ["노랑", "#f9a825"],
  ["초록", "#2e7d32"], ["청록", "#00838f"], ["파랑", "#1565c0"],
  ["보라", "#6a1b9a"], ["분홍", "#ad1457"], ["갈색", "#795548"],
];
const storageKey = "dynote.textColors";
function readColors() {
  try {
    const colors = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(colors) ? [...new Set(colors.filter(validTextColor).map(color => color.toLowerCase()))] : [];
  } catch { return []; }
}
const preserveSelection = event => event.preventDefault();

export default function TextColorPicker({ value, onChange, disabled }) {
  const menu = useRef(null);
  const sampler = useRef(null);
  const [saved, setSaved] = useState(readColors);
  const [sampling, setSampling] = useState(false);
  const [error, setError] = useState("");
  const canSample = typeof window.EyeDropper === "function";
  useEffect(() => {
    const sync = () => setSaved(readColors());
    window.addEventListener("dynote:text-colors", sync);
    window.addEventListener("storage", sync);
    const close = event => { if (!menu.current?.contains(event.target)) menu.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => {
      sampler.current?.abort();
      window.removeEventListener("dynote:text-colors", sync);
      window.removeEventListener("storage", sync);
      document.removeEventListener("pointerdown", close);
    };
  }, []);
  const update = colors => {
    setSaved(colors);
    try {
      localStorage.setItem(storageKey, JSON.stringify(colors));
      window.dispatchEvent(new Event("dynote:text-colors"));
    } catch { /* Keep colors usable in this editor when storage is unavailable. */ }
  };
  const choose = color => { onChange(color); menu.current.open = false; };
  const sampleScreen = async () => {
    const controller = new AbortController();
    sampler.current = controller;
    setSampling(true); setError("");
    try {
      const { sRGBHex } = await new window.EyeDropper().open({ signal: controller.signal });
      if (!controller.signal.aborted) {
        onChange(sRGBHex.toLowerCase());
        menu.current.open = true;
      }
    } catch (error) {
      if (!controller.signal.aborted && error.name !== "AbortError") setError("화면 색상을 가져오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (!controller.signal.aborted) setSampling(false);
      sampler.current = null;
    }
  };
  const swatch = (name, color) => <button type="button" className="text-color-swatch" title={`${name} ${color}`}
    aria-label={`${name} ${color}`} aria-pressed={value === color} style={{ "--swatch-color": color }} disabled={disabled}
    onMouseDown={preserveSelection} onClick={() => choose(color)} />;
  return <details className="text-color-menu" ref={menu} onKeyDown={event => { if (event.key === "Escape") { menu.current.open = false; menu.current.querySelector("summary").focus(); } }}>
    <summary title={value} onMouseDown={preserveSelection}><span className="text-color-current" style={{ backgroundColor: value }} />글자 색상 ▾</summary>
    <div className="text-color-popover">
      <span>기본 색상</span>
      <div className="text-color-grid">{presets.map(([name, color]) => <span key={color}>{swatch(name, color)}</span>)}</div>
      <span>저장한 색</span>
      {saved.length ? <div className="text-color-grid">{saved.map(color => <div className="text-color-saved" key={color}>
        {swatch("저장한 색", color)}
        <button type="button" className="text-color-remove" aria-label={`저장한 색 ${color} 삭제`} title="저장한 색 삭제" disabled={disabled}
          onMouseDown={preserveSelection} onClick={() => update(saved.filter(item => item !== color))}>×</button>
      </div>)}</div> : <small>자주 쓰는 색을 저장해 보세요.</small>}
      <div className="text-color-custom">
        <label className="text-color-picker">직접 선택<input aria-label="글자 색상" type="color" value={value} disabled={disabled} onInput={event => onChange(event.currentTarget.value)} /></label>
        <button type="button" disabled={disabled || saved.includes(value)} onMouseDown={preserveSelection} onClick={() => update([...saved, value])}>색상 저장</button>
      </div>
      <button type="button" disabled={disabled || sampling || !canSample} onMouseDown={preserveSelection} onClick={sampleScreen}>화면에서 색 가져오기</button>
      {!canSample && <small>이 환경에서는 화면 색상 가져오기를 지원하지 않습니다.</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  </details>;
}
