import { useEffect, useState } from "react";
import { defaultFonts, fontVariables } from "../core/font-preferences.mjs";

function FontSize({ label, value, min, max, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label={`${label} 글자 크기`} type="number" min={min} max={max} value={draft}
    onChange={(e) => {
      const raw = e.target.value, next = Number(raw); setDraft(raw);
      if (raw && Number.isFinite(next) && next >= min && next <= max) onChange(next);
    }} onBlur={() => setDraft(String(value))} />;
}

function FontFamily({ label, value, families, onChange }) {
  const [query, setQuery] = useState("");
  const matches = families.filter((family) => family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="font-family-picker">
    <label>{label} 글꼴<input aria-label={`${label} 글꼴`} placeholder="시스템 기본 글꼴" value={value} onChange={(e) => onChange(e.target.value)} /></label>
    {families.length > 0 && <details className="font-picker">
      <summary aria-label={`${label} 글꼴 목록`}>설치 글꼴 목록</summary>
      <input type="search" aria-label={`${label} 글꼴 검색`} placeholder="글꼴 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select size={6} aria-label={`${label} 설치 글꼴`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">시스템 기본 글꼴</option>
        {matches.map((family) => <option key={family} value={family}>{family}</option>)}
      </select>
      <p className="muted">{matches.length}개 글꼴 · 휠 또는 ↑↓ / Page Up·Down / Home·End로 이동</p>
    </details>}
  </div>;
}

export default function FontSettings({ value, onChange }) {
  const [families, setFamilies] = useState([]), [message, setMessage] = useState("");
  const update = (key, next) => onChange({ ...value, [key]: next });
  const load = async () => {
    try {
      if (!window.queryLocalFonts) throw new Error("unavailable");
      const fonts = await window.queryLocalFonts();
      const names = [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b, "ko"));
      setFamilies(names); setMessage(`${names.length}개 설치 글꼴을 불러왔습니다.`);
    } catch { setMessage("설치 글꼴 목록을 불러오지 못했습니다. 글꼴 이름을 직접 입력할 수 있습니다."); }
  };
  const styles = fontVariables(value);
  return <div className="font-settings">
    <p>이 기기에 설치된 글꼴을 사용합니다. 다른 기기에 없는 글꼴은 기본 글꼴로 표시됩니다.</p>
    <button className="secondary-button" onClick={load}>설치 글꼴 불러오기</button>
    <p role="status" className="muted">{message}</p>
    {[["ui", "화면", 11, 20], ["body", "본문", 12, 32], ["code", "코드", 10, 24]].map(([key, label, min, max]) => <div className="font-setting-row" key={key}>
      <FontFamily label={label} value={value[`${key}Family`]} families={families} onChange={(next) => update(`${key}Family`, next)} />
      <label>크기<FontSize label={label} min={min} max={max} value={value[`${key}Size`]} onChange={(next) => update(`${key}Size`, next)} /></label>
      <div className="font-sample" data-font-sample={key} style={{ fontFamily: styles[`--${key}-font`], fontSize: styles[`--${key}-size`], lineHeight: value.lineHeight }}>{key === "code" ? "const message = '한글 코드 123';" : "생각을 기록하는 공간 · Dynote Aa 123"}</div>
    </div>)}
    <label>본문 줄 간격<input aria-label="본문 줄 간격" type="range" min="1.2" max="2.5" step="0.05" value={value.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} /><output>{value.lineHeight}</output></label>
    <p className="muted">변경 즉시 적용·저장됩니다. 문서 내용은 바뀌지 않습니다.</p>
    <button className="secondary-button" onClick={() => onChange({ ...defaultFonts })}>글꼴 기본값 복원</button>
  </div>;
}
