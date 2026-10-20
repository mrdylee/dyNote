import { useEffect, useState } from "react";

export default function VaultSettings({ onList, onPick, onSelect, onForget }) {
  const [data, setData] = useState({ entries: [] }), [error, setError] = useState(""), [pending, setPending] = useState(false);
  useEffect(() => {
    let mounted = true;
    onList().then((value) => { if (mounted) setData(value); }).catch((e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  const run = async (action) => {
    setPending(true); setError("");
    try { await action(); setData(await onList()); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  };
  return <section className="settings-section">
    <h3>로컬 보관함</h3>
    <p>노트를 저장할 폴더를 선택하세요. 선택한 경로는 앱과 별도로 보관되어 업데이트 후에도 유지됩니다.</p>
    <button className="primary-button" disabled={pending} onClick={() => run(onPick)}>폴더 선택·추가</button>
    {(error || data.error) && <p role="alert" className="settings-message">{error || data.error}</p>}
    <ul className="vault-settings-list">
      {data.entries.map((entry) => <li key={entry.root}>
        <div><strong>{entry.name} {entry.root === data.current && <small>사용 중</small>}</strong><p>{entry.root}</p></div>
        <div className="settings-actions">
          <button className="secondary-button" disabled={pending || entry.root === data.current} onClick={() => run(() => onSelect(entry.root))}>열기</button>
          <button className="secondary-button" disabled={pending || entry.active} onClick={() => run(() => onForget(entry.root))}>목록에서 제거</button>
        </div>
      </li>)}
    </ul>
    <p className="muted">목록에서 제거해도 실제 폴더와 파일은 삭제되지 않습니다. 경로를 찾을 수 없으면 폴더를 다시 선택해 주세요.</p>
  </section>;
}
