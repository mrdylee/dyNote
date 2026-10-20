import { useEffect, useState } from "react";

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const labels = { add: "추가", modify: "수정", delete: "삭제" };

export default function GitHistory({ onList, onPreview, onRestore, onRecovery, busy }) {
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [history, setHistory] = useState({ entries: [] }), [date, setDate] = useState("");
  const [selected, setSelected] = useState(null), [preview, setPreview] = useState(null), [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState(""), [pending, setPending] = useState(false), [recovery, setRecovery] = useState("");
  useEffect(() => {
    let mounted = true;
    setPending(true); setError(""); setHistory({ entries: [] }); setDate(""); setSelected(null); setPreview(null); setConfirmed(false);
    onList(month).then((value) => { if (mounted) { setHistory(value); setDate(value.entries[0]?.date ?? ""); } })
      .catch((e) => { if (mounted) setError(e.message); }).finally(() => { if (mounted) setPending(false); });
    return () => { mounted = false; };
  }, [month]);
  const locked = busy || pending;
  const changeMonth = (offset) => {
    const [year, number] = month.split("-").map(Number);
    setMonth(monthKey(new Date(year, number - 1 + offset, 1)));
  };
  const [year, number] = month.split("-").map(Number);
  const days = new Date(year, number, 0).getDate(), firstDay = new Date(year, number - 1, 1).getDay();
  const counts = new Map();
  for (const entry of history.entries) counts.set(entry.date, (counts.get(entry.date) ?? 0) + 1);
  const choose = async (entry) => {
    setSelected(entry); setPreview(null); setConfirmed(false); setError(""); setRecovery(""); setPending(true);
    try { setPreview(await onPreview(entry.hash)); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  };
  const restore = async () => {
    setPending(true); setError("");
    try {
      const result = await onRestore(preview);
      setRecovery(result.recoveryPath); setPreview(null); setConfirmed(false);
    } catch (e) { setError(e.message); setPreview(null); setConfirmed(false); }
    finally { setPending(false); }
  };
  return <section className="settings-section">
    <h3>백업으로 돌아가기</h3>
    <p>현재 보관함·브랜치의 로컬 Git 기록입니다. 원격에 아직 올라가지 않은 커밋도 표시됩니다.</p>
    <div className="backup-month">
      <button className="secondary-button" aria-label="이전 달" disabled={locked} onClick={() => changeMonth(-1)}>←</button>
      <label>백업 월<input aria-label="백업 월" type="month" value={month} disabled={locked} onChange={(e) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label>
      <button className="secondary-button" aria-label="다음 달" disabled={locked} onClick={() => changeMonth(1)}>→</button>
    </div>
    <div className="backup-calendar" role="group" aria-label={`${month} 백업 달력`}>
      {["일", "월", "화", "수", "목", "금", "토"].map((day) => <span className="weekday" key={day}>{day}</span>)}
      {Array.from({ length: firstDay }, (_, index) => <span key={`empty-${index}`} />)}
      {Array.from({ length: days }, (_, index) => {
        const day = `${month}-${String(index + 1).padStart(2, "0")}`, count = counts.get(day) ?? 0;
        return <button key={day} className={count ? "has-backup" : ""} aria-label={`${day} 백업 ${count}개`} aria-pressed={date === day}
          disabled={locked || !count} onClick={() => { setDate(day); setSelected(null); setPreview(null); setConfirmed(false); }}>
          <span>{index + 1}</span>{count > 0 && <small>{count}개</small>}
        </button>;
      })}
    </div>
    {!pending && !history.entries.length && !error && <p className="muted">이 달에는 백업 기록이 없습니다.</p>}
    {history.truncated && <p className="muted">이 달의 최근 1,000개 기록만 표시합니다.</p>}
    <div className="backup-records">
      {history.entries.filter((entry) => entry.date === date).map((entry) => <button className="backup-record" key={entry.hash}
        disabled={locked} aria-pressed={selected?.hash === entry.hash} onClick={() => choose(entry)}>
        <strong>{new Date(entry.time).toLocaleTimeString()} · {entry.subject || "Git 백업"}</strong>
        <code>{entry.hash.slice(0, 10)}</code>
      </button>)}
    </div>
    {pending && <p role="status">백업 처리 중…</p>}
    {preview && <div className="restore-preview">
      <h4>{selected?.date} 백업 · 변경될 파일 {preview.changes.length}개</h4>
      <ul>{preview.changes.map((item) => <li key={item.path}><span>{labels[item.kind]}</span><code>{item.path}</code></li>)}</ul>
      <p>문서·Canvas·Bases·이미지·PDF를 선택한 백업 상태로 바꿉니다. 복원 전 현재 파일은 별도 복구 폴더에 보관합니다. Git 이력은 유지되고, 복원 결과는 다음 백업에 반영됩니다.</p>
      {preview.changes.length > 0 ? <>
        <label className="restore-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={(e) => setConfirmed(e.target.checked)} />위 파일 변경 내용을 확인했습니다.</label>
        <button className="primary-button" disabled={locked || !confirmed} onClick={restore}>선택한 백업으로 돌아가기</button>
      </> : <p>현재 파일과 같은 내용입니다.</p>}
    </div>}
    {error && <p role="alert" className="settings-message error">{error}</p>}
    {recovery && <div role="status" className="settings-message"><p>복원했습니다. 복원 전 파일 보관 위치: {recovery}</p><button className="secondary-button" onClick={onRecovery}>복구 사본 폴더 열기</button></div>}
  </section>;
}
