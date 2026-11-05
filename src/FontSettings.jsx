import { useEffect, useRef, useState } from "react";
import { defaultFonts, fontVariables } from "../core/font-preferences.mjs";

const fontFields = [
  ["ui", "화면", 11, 20, "메뉴 · 검색 · 설정"],
  ["body", "본문", 12, 32, "한글과 English를 함께 씁니다.\n줄 간격은 이렇게 보입니다."],
  ["code", "코드", 10, 24, "const message = '한글 코드 123';"],
];

function FontSize({ label, value, min, max, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input aria-label={`${label} 글자 크기`} type="number" min={min} max={max} value={draft}
    onChange={(e) => {
      const raw = e.target.value, next = Number(raw); setDraft(raw);
      if (raw && Number.isFinite(next) && next >= min && next <= max) onChange(next);
    }} onBlur={() => setDraft(String(value))} />;
}

function FontFamily({ label, value, families, message, onChange }) {
  const picker = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const name = query.trim(), key = name.toLocaleLowerCase();
  const matches = families.filter(family => family.toLocaleLowerCase().includes(key));
  const exact = matches.find(family => family.toLocaleLowerCase() === key);
  const options = value && !matches.includes(value) ? [value, ...matches] : matches;
  const current = value || "시스템 기본";
  const close = () => {
    picker.current.open = false;
    picker.current.querySelector("summary").focus();
  };
  const applyName = () => { onChange(exact ?? name); close(); };
  return <details ref={picker} className="font-picker" name="font-family"
    onToggle={event => {
      const expanded = event.currentTarget.open;
      setOpen(expanded);
      if (expanded) event.currentTarget.querySelector("input").focus();
      else setQuery("");
    }}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
    }}
    onKeyDown={event => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      close();
    }}>
    <summary aria-label={`${label} 글꼴 · ${current}`}><span>{current}</span></summary>
    <input type="search" aria-label={`${label} 글꼴 검색`} placeholder="글꼴 검색 또는 이름 입력" value={query} maxLength={200}
      onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key !== "Enter" || !name || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        applyName();
      }} />
    {open && <select size={Math.max(2, Math.min(6, options.length + 1))} aria-label={`${label} 글꼴 선택`} value={value}
      onChange={event => onChange(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); close(); }
      }}>
      <option value="">시스템 기본</option>
      {options.map(family => <option key={family} value={family}>{family}</option>)}
    </select>}
    {name && !exact && <button type="button" className="secondary-button" onClick={applyName}>입력한 글꼴 사용</button>}
    {message && <p role="status" className="muted">{message}</p>}
  </details>;
}

export default function FontSettings({ value, onChange }) {
  const [families, setFamilies] = useState([]), [message, setMessage] = useState("설치 글꼴을 불러오는 중…");
  const update = (key, next) => onChange({ ...value, [key]: next });
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        if (!window.queryLocalFonts) throw new Error("unavailable");
        const fonts = await window.queryLocalFonts();
        const names = [...new Set(fonts.map((font) => font.family))].sort((a, b) => a.localeCompare(b, "ko"));
        if (mounted) { setFamilies(names); setMessage(""); }
      } catch { if (mounted) setMessage("설치 글꼴을 불러오지 못했습니다. 글꼴 이름을 직접 입력할 수 있습니다."); }
    };
    load();
    return () => { mounted = false; };
  }, []);
  const styles = fontVariables(value);
  return <div className="font-settings">
    {fontFields.map(([key, label, min, max]) => <div className="font-setting-row" key={key}>
      <span className="font-role">{label}</span>
      <FontFamily label={label} value={value[`${key}Family`]} families={families} message={message} onChange={next => update(`${key}Family`, next)} />
      <label className="font-size-control">
        <FontSize label={label} min={min} max={max} value={value[`${key}Size`]} onChange={next => update(`${key}Size`, next)} />
        <span aria-hidden="true">px</span>
      </label>
    </div>)}
    <label>본문 줄 간격<input aria-label="본문 줄 간격" type="range" min="1.2" max="2.5" step="0.05" value={value.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} /><output>{value.lineHeight}</output></label>
    <section className="font-preview" aria-label="글꼴 미리보기">
      <h3>미리보기</h3>
      {fontFields.map(([key, , , , sample]) => <div key={key} className="font-sample" data-font-sample={key}
        style={{ fontFamily: styles[`--${key}-font`], fontSize: styles[`--${key}-size`], lineHeight: key === "body" ? value.lineHeight : undefined }}>{sample}</div>)}
    </section>
    <button className="secondary-button" onClick={() => onChange({ ...defaultFonts })}>글꼴 기본값 복원</button>
  </div>;
}
