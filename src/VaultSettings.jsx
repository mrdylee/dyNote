import { useEffect, useState } from "react";
import { UserRound, Users } from "lucide-react";

export default function VaultSettings({ onList, onPick, onSelect, onForget, onPurpose, onOpenGit }) {
  const [data, setData] = useState({ entries: [] }), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let mounted = true;
    onList().then((value) => { if (mounted) setData(value); }).catch((e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);
  const run = async (action, message = "") => {
    setPending(true); setError(""); setMessage("");
    try { await action(); setData(await onList()); setMessage(message); }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  };
  return <section className="settings-section">
    <h3>개인·팀 공간</h3>
    <p>개인 기록과 팀 문서는 서로 다른 폴더에 보관하세요. 각 공간의 Git 저장소도 따로 연결합니다.</p>
    <div className="space-choices">
      <article className="space-choice personal"><UserRound size={22}/><h4>개인 노트</h4><p>저널·아이디어·작업 초안을 기록합니다. Git 백업은 개인용 저장소에 연결하세요.</p><button className="secondary-button" disabled={pending} onClick={() => run(() => onPick("personal"))}>개인 노트 폴더 연결</button></article>
      <article className="space-choice team"><Users size={22}/><h4>팀 공유 노트</h4><p>설계서·회의록·결정 사항을 함께 관리합니다. 팀원이 접근하는 별도 Git 저장소에 연결하세요.</p><button className="secondary-button" disabled={pending} onClick={() => run(() => onPick("team"))}>팀 공유 폴더 연결</button></article>
    </div>
    <div className="space-guide"><strong>서로 다른 폴더 + 서로 다른 Git 저장소</strong><div><span>개인 폴더 → 개인용 Git</span><span>팀 폴더 → 팀 Git</span></div><p>아래 ‘이 공간의 Git 설정’에서 공간별 저장소 주소를 연결합니다.</p></div>
    <p className="muted">공간 용도는 앱의 구분 표시입니다. 용도를 바꿔도 파일을 옮기거나 Git 저장소의 접근 권한을 바꾸지 않습니다.</p>
    {(error || data.error) && <p role="alert" className="settings-message">{error || data.error}</p>}
    {message && <p role="status" className="settings-message">{message}</p>}
    {[["personal", "개인 노트 공간"], ["team", "팀 공유 공간"], [null, "용도 미지정"]].map(([purpose, title]) => <div key={title} className="space-group">
      <h4>{title}</h4>
      {purpose === null && data.entries.some(entry => !entry.purpose) && <p className="muted">기존 폴더는 개인·팀 용도를 직접 선택해 주세요. 현재 Git 연결은 그대로 유지됩니다.</p>}
      <ul className="vault-settings-list">
      {data.entries.filter(entry => (entry.purpose ?? null) === purpose).map((entry) => <li key={entry.root}>
        <div><strong>{entry.name} {entry.root === data.current && <small>사용 중</small>}</strong><p>{entry.root}</p>
          <label>공간 용도<select aria-label={`${entry.name} 공간 용도`} value={entry.purpose ?? ""} disabled={pending} onChange={e => run(() => onPurpose(entry.root, e.target.value), "공간 용도를 저장했습니다.")}><option value="" disabled>용도 선택</option><option value="personal">개인 노트</option><option value="team">팀 공유 노트</option></select></label>
        </div>
        <div className="settings-actions">
          <button className="secondary-button" disabled={pending || entry.root === data.current} onClick={() => run(() => onSelect(entry.root))}>열기</button>
          {entry.root === data.current && <button className="secondary-button" disabled={pending} onClick={onOpenGit}>이 공간의 Git 설정</button>}
          <button className="secondary-button" disabled={pending || entry.active} onClick={() => run(() => onForget(entry.root))}>목록에서 제거</button>
        </div>
      </li>)}
      </ul>
      {!data.entries.some(entry => (entry.purpose ?? null) === purpose) && <p className="muted">연결된 공간이 없습니다.</p>}
    </div>)}
    <p className="muted">목록에서 제거해도 실제 폴더와 파일은 삭제되지 않습니다. 경로를 찾을 수 없으면 폴더를 다시 선택해 주세요.</p>
  </section>;
}
