import { useState } from 'react';
import moment from 'moment/moment.js';
import { periods, periodicNote, periodicEntries, localDate, adjacentEntry } from '../core/periodic-notes.mjs';

export default function JournalPanel({ notes, active, preferences, onPreferences, onOpen, onCreate, onHistory, busy }) {
  const [period, setPeriod] = useState('daily');
  const [date, setDate] = useState(localDate);
  const [showSettings, setShowSettings] = useState(false);
  const settings = { ...preferences[period], locale: preferences.locale || 'ko' };
  const entries = periodicEntries(notes, period, settings);
  let target, problem;
  try { target = periodicNote(period, date, settings); } catch (e) { problem = e.message; }
  const existing = target && notes.find(n => n.path === target.path);
  const month = moment(date, 'YYYY-MM-DD', true).isValid() ? moment(date) : moment();
  const start = month.clone().startOf('month');
  const previous = adjacentEntry(entries, active, -1), next = adjacentEntry(entries, active, 1);
  const update = (key, value) => onPreferences({ ...preferences, [period]: { ...preferences[period], [key]: value } });
  const selected = () => existing ? onOpen(existing.path) : target && onCreate(target, settings);
  return <section className="journal-panel" aria-label="달력과 일지">
    <div className="native-panel-tabs">
      <select aria-label="일지 주기" value={period} disabled={busy} onChange={e=>setPeriod(e.target.value)}>
        {Object.entries(periods).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      <button disabled={busy} aria-expanded={showSettings} onClick={()=>setShowSettings(!showSettings)}>일지 설정</button>
    </div>
    <div className="journal-month">
      <button aria-label="일지 이전 달" onClick={()=>setDate(month.clone().subtract(1,'month').format('YYYY-MM-DD'))}>←</button>
      <strong>{month.format('YYYY-MM')}</strong>
      <button aria-label="일지 다음 달" onClick={()=>setDate(month.clone().add(1,'month').format('YYYY-MM-DD'))}>→</button>
    </div>
    <div className="journal-calendar" aria-label="일지 달력">
      {['일','월','화','수','목','금','토'].map(d=><span key={d}>{d}</span>)}
      {Array.from({length:start.day()},(_,i)=><span key={`pad-${i}`}/>)}
      {Array.from({length:month.daysInMonth()},(_,i)=>{
        const day=start.clone().add(i,'day').format('YYYY-MM-DD');
        let path;
        try { path=periodicNote(period,day,settings).path; } catch { /* Show invalid preferences below. */ }
        const exists=notes.some(n=>n.path===path);
        return <button key={day} aria-label={`${day}${exists?' 일지 있음':''}`} aria-pressed={date===day}
          disabled={busy} className={exists?'has-note':''} onClick={()=>{setDate(day);if(exists)onOpen(path);}}>{i+1}{exists&&<small>•</small>}</button>;
      })}
    </div>
    <label>날짜<input aria-label="일지 날짜" type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)} /></label>
    {problem ? <p role="alert">{problem}</p> : <p className="journal-path">{target.path}</p>}
    <button className="primary-button" disabled={busy || !target} onClick={selected}>{existing?'일지 열기':'선택한 날짜의 일지 만들기'}</button>
    <div className="native-panel-tabs"><button disabled={busy||!previous} onClick={()=>onOpen(previous.path)}>이전 일지</button><button disabled={busy||!next} onClick={()=>onOpen(next.path)}>다음 일지</button></div>
    <button disabled={busy || !date} onClick={()=>onHistory(date)}>과거 같은 날의 기록</button>
    {showSettings && <div className="journal-settings">
      <label>주 기준<select aria-label="일지 주 기준" value={preferences.locale || 'ko'} onChange={e=>onPreferences({...preferences,locale:e.target.value})}><option value="ko">한국어 · 일요일 시작</option><option value="en">영어 · 일요일 시작</option><option value="en-gb">월요일 시작 · 첫 주에 1월 4일 포함</option></select></label>
      <label>저장 폴더<input aria-label="일지 저장 폴더" value={settings.folder || ''} placeholder="Journal" onChange={e=>update('folder',e.target.value)}/></label>
      <label>파일명 형식<input aria-label="일지 파일명 형식" value={settings.format || ''} placeholder={target?.format || 'YYYY-MM-DD'} onChange={e=>update('format',e.target.value)}/></label>
      <label>템플릿<select aria-label="일지 템플릿" value={settings.template || ''} onChange={e=>update('template',e.target.value)}><option value="">사용 안 함</option>{notes.map(n=><option key={n.path} value={n.path}>{n.path}</option>)}</select></label>
      <label>시간 기록 형식<input aria-label="일지 시간 기록 형식" value={preferences.timeStampFormat || ''} placeholder="h:mm A" onChange={e=>onPreferences({...preferences,timeStampFormat:e.target.value})}/></label>
      <label>날짜 기록 형식<input aria-label="일지 날짜 기록 형식" value={preferences.dateStampFormat || ''} placeholder="M/D/YYYY" onChange={e=>onPreferences({...preferences,dateStampFormat:e.target.value})}/></label>
      <p className="muted">템플릿은 새 일지를 만들 때만 적용됩니다. 기존 파일은 유지합니다.</p>
    </div>}
    <h4>{periods[period]} 기록 · {entries.length}</h4>
    <div className="journal-entries">{entries.slice().reverse().map(n=><button key={n.path} title={n.path} onClick={()=>onOpen(n.path)}>{n.path}</button>)}</div>
  </section>;
}
