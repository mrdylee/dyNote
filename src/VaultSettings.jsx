import { useEffect, useRef, useState } from "react";
import { ChevronRight, UserRound, Users } from "lucide-react";

function SpaceGitInfo({ vaultId, onReadGit }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let mounted = true;
    onReadGit(vaultId).then(value => { if (mounted) setInfo(value); })
      .catch(error => { if (mounted) setInfo({ error: error.message }); });
    return () => { mounted = false; };
  }, [vaultId, onReadGit]);
  if (!info) return <p>Git 정보 확인 중…</p>;
  return <div>
    {info.error ? <p role="status">{info.error}</p> : info.available ? <>
      <p>Git 브랜치 · <code>{info.branch}</code></p>
      {info.remoteUrls.length === 0 && <p>Git 원격 주소 미설정</p>}
      {info.remoteUrls.map(remote => <div key={remote.name}>
        <p>Git 원격 · {remote.name}</p>
        {remote.fetch.map((url, index) => <p key={index}><code>{url}</code></p>)}
        {(remote.push.length !== remote.fetch.length || remote.push.some((url, i) => url !== remote.fetch[i])) &&
          remote.push.map((url, index) => <p key={index}>업로드 · <code>{url}</code></p>)}
      </div>)}
    </> : <p>Git 저장소 없음</p>}
    {info.backup ? <p>자동 백업 대상 · <code>{info.backup}</code></p> : !info.error && <p>자동 백업 대상 미설정</p>}
  </div>;
}

export default function VaultSettings({ openSpaces, gitStates, currentId, teamSetup, onImportPersonal, onReadGit, onList, onPick, onSelect, onForget, onPurpose, onOpenGit, onPickTeamRepositoryFolder, onConnectTeamRepositories }) {
  const [data, setData] = useState({ entries: [] }), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [teamRows, setTeamRows] = useState(() => teamSetup ? [{id:0, remote:"", branch:"main", folder:"", error:""}] : []);
  const [section, setSection] = useState(teamSetup ? "team" : null);
  const [importing, setImporting] = useState(false);
  const nextTeamRow = useRef(teamSetup ? 1 : 0);
  useEffect(() => {
    let mounted = true;
    onList().then((value) => { if (mounted) setData(value); }).catch((e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [onList, currentId]);
  const run = async (action, message = "") => {
    setPending(true); setError(""); setMessage("");
    try {
      await action();
      setData(await onList());
      if (message) setMessage(message);
    }
    catch (e) { setError(e.message); }
    finally { setPending(false); }
  };
  const addTeamRow = () => {
    const id = nextTeamRow.current++;
    setTeamRows(rows => [...rows, { id, remote: "", branch: "main", folder: "", error: "" }]);
  };
  const updateTeamRow = (id, values) => setTeamRows(rows => rows.map(row => row.id === id ? { ...row, error: "", ...values } : row));
  const pickTeamFolder = async (id) => {
    setPending(true);
    try {
      const folder = await onPickTeamRepositoryFolder();
      if (folder) updateTeamRow(id, { folder });
    } catch (error) { updateTeamRow(id, { error: error.message }); }
    finally { setPending(false); }
  };
  const connectTeams = event => {
    event.preventDefault();
    if (pending) return;
    void run(async () => {
      const results = await onConnectTeamRepositories(teamRows.map(({ remote, branch, folder }) => ({ remote, branch, folder })));
      const failed = teamRows.flatMap((row, index) => results[index].ok ? [] : [{ ...row, error: results[index].error }]);
      setTeamRows(failed);
      const connected = teamRows.length - failed.length;
      if (connected) setMessage(`팀 저장소 ${connected}개를 연결했습니다.`);
    });
  };
  const personalSpaces = data.entries.filter(entry => entry.purpose === "personal");
  const teams = data.entries.filter(entry => entry.purpose === "team");
  const personalId = personalSpaces.length === 1 && openSpaces.find(space => space.root === personalSpaces[0].root)?.id;
  const sync = gitStates[personalId];
  const personalStatus = !personalSpaces.length ? "폴더 선택" : personalSpaces.length > 1 ? `폴더 ${personalSpaces.length}개`
    : !sync ? personalSpaces[0].name : !sync.enabled ? "이 PC에만 저장 중"
    : sync.config?.mode === "personal-sync" ? sync.message : "일일 백업 사용 중";
  function enter(next) {
    if (section === next) { setSection(null); return; }
    setSection(next); setError(""); setMessage(""); setImporting(false);
    if (next === "team" && !teams.length && !teamRows.length) addTeamRow();
  }
  function openSettings(entry, id) {
    return run(async () => {
      const target = id ?? await onSelect(entry.root);
      if (target) onOpenGit(target, entry.purpose === "personal");
    });
  }
  return <section className="settings-section">
    <h3>보관함</h3>
    <div className="vault-entry-list">
      <button type="button" aria-label="개인 노트" aria-expanded={section === "personal"} disabled={pending} onClick={() => enter("personal")}>
        <UserRound size={20}/><strong>개인 노트</strong><span>{data.current === undefined ? "" : personalStatus}</span><ChevronRight size={16}/>
      </button>
      <button type="button" aria-label="팀 노트" aria-expanded={section === "team"} disabled={pending || (data.current === undefined && !error)} onClick={() => enter("team")}>
        <Users size={20}/><strong>팀 노트</strong><span>{data.current === undefined ? "" : teams.length ? `모델 ${teams.length}개 연결됨` : "모델 추가"}</span><ChevronRight size={16}/>
      </button>
    </div>
    {section === "personal" && !personalSpaces.length && <p>이 PC에 노트가 있으면 폴더를 연결하세요. 다른 PC에서 동기화한 노트는 Git 저장소에서 가져올 수 있습니다.</p>}
    {section === "personal" && <div className="settings-actions">
      <button className="secondary-button" disabled={pending} onClick={() => run(() => onPick("personal"))}>개인 노트 폴더 연결</button>
      <button className="secondary-button" aria-expanded={importing} disabled={pending} onClick={() => setImporting(!importing)}>기존 Git 저장소에서 가져오기</button>
    </div>}
    {section === "personal" && importing && <form aria-label="개인 노트 가져오기" onSubmit={event => {
      event.preventDefault();
      const input = Object.fromEntries(new FormData(event.currentTarget));
      void run(() => onImportPersonal({ ...input, mode: "personal-sync" }));
    }}>
      <label>저장소 주소<input name="remote" required placeholder="HTTPS 또는 SSH" disabled={pending}/></label>
      <label>브랜치<input name="branch" required defaultValue="main" disabled={pending}/></label>
      <label>이 기기 이름<input name="deviceName" required maxLength={80} disabled={pending}/></label>
      <button className="primary-button" disabled={pending}>빈 폴더 선택하고 가져오기</button>
    </form>}
    {section === "team" && <div className="settings-actions">
      {!teamRows.length && <button className="primary-button" disabled={pending} onClick={addTeamRow}>모델 추가</button>}
      <button className="secondary-button" disabled={pending} onClick={() => run(() => onPick("team"))}>팀 공유 폴더 연결</button>
    </div>}
    {section === "team" && teamRows.length > 0 && <form className="team-repositories" onSubmit={connectTeams} aria-label="팀 저장소 연결">
      <h4>팀 저장소 연결</h4>
      {teamSetup && <p>선택한 팀 노트 · {teamSetup.name} · <code>{teamSetup.root}</code></p>}
      <p className="muted">모델마다 빈 폴더나 같은 저장소를 이미 가져온 폴더를 선택하세요.</p>
      {!personalSpaces.length && <p className="muted">연결한 팀은 아래 팀 공유 공간에서 열 수 있습니다. 개인 공간도 연결하면 왼쪽 파일 목록에서 모델을 함께 볼 수 있습니다.</p>}
      {teamRows.map((row, index) => <fieldset key={row.id} aria-label={`팀 저장소 ${index + 1}`} disabled={pending} className="team-repository-row">
        <label>저장소 주소<input required value={row.remote} placeholder="https:// 또는 SSH" onChange={event => updateTeamRow(row.id, { remote: event.target.value })}/></label>
        <label>브랜치<input required value={row.branch} onChange={event => updateTeamRow(row.id, { branch: event.target.value })}/></label>
        <div className="team-repository-folder">
          <button type="button" className="secondary-button" onClick={() => pickTeamFolder(row.id)}>폴더 선택</button>
          {row.folder && <span>{row.folder}</span>}
        </div>
        <button type="button" className="secondary-button" disabled={teamRows.length < 2} aria-label={`팀 저장소 ${index + 1} 입력 제거`} onClick={() => setTeamRows(rows => rows.filter(item => item.id !== row.id))}>제거</button>
        {row.error && <p className="settings-message" role="alert">{row.error}</p>}
      </fieldset>)}
      <div className="settings-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={addTeamRow}>저장소 추가</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={() => setTeamRows([])}>취소</button>
        <button className="primary-button" disabled={pending || teamRows.some(row => !row.remote.trim() || !row.branch.trim() || !row.folder)}>입력한 저장소 연결</button>
      </div>
    </form>}
    {(error || data.error) && <p role="alert" className="settings-message">{error || data.error}</p>}
    {message && <p role="status" className="settings-message">{message}</p>}
    {[["personal", "개인 노트 공간"], ["team", "팀 공유 공간"], [null, "용도 미지정"]].filter(([purpose]) => purpose ? purpose === section : data.entries.some(entry => !entry.purpose)).map(([purpose, title]) => <div key={title} className="space-group">
      <h4>{title}</h4>
      {purpose === null && data.entries.some(entry => !entry.purpose) && <p className="muted">기존 폴더는 개인·팀 용도를 직접 선택해 주세요. 현재 Git 연결은 그대로 유지됩니다.</p>}
      <ul className="vault-settings-list">
      {data.entries.filter(entry => (entry.purpose ?? null) === purpose).map((entry) => {
        const vaultId = openSpaces.find(space => space.root === entry.root)?.id;
        return <li key={entry.root}>
          <div><strong>{purpose === "team" ? <button className="text-action" disabled={pending} onClick={() => openSettings(entry, vaultId)}>{entry.name}</button> : entry.name} {entry.root === data.current && <small>사용 중</small>}</strong><p>{entry.root}</p>
            {purpose === "personal" && <button className="primary-button" disabled={pending} onClick={() => openSettings(entry, vaultId)}>동기화 설정</button>}
            {vaultId ? <SpaceGitInfo key={vaultId + ':' + currentId} vaultId={vaultId} onReadGit={onReadGit}/> : <p>공간을 열면 Git 정보를 확인할 수 있습니다.</p>}
            <label>공간 용도<select aria-label={`${entry.name} 공간 용도`} value={entry.purpose ?? ""} disabled={pending} onChange={e => {
              const next = e.target.value;
              void run(async () => { await onPurpose(entry.root, next); setSection(next); }, "공간 용도를 저장했습니다.");
            }}><option value="" disabled>용도 선택</option><option value="personal">개인 노트</option><option value="team">팀 공유 노트</option></select></label>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" disabled={pending || entry.root === data.current} onClick={() => run(() => onSelect(entry.root))}>열기</button>
            {!purpose && vaultId && <button className="secondary-button" disabled={pending} onClick={() => onOpenGit(vaultId)}>이 공간의 Git 설정</button>}
            <button className="secondary-button" disabled={pending || entry.active} onClick={() => run(() => onForget(entry.root))}>목록에서 제거</button>
          </div>
        </li>;
      })}
      </ul>
      {!data.entries.some(entry => (entry.purpose ?? null) === purpose) && <p className="muted">연결된 공간이 없습니다.</p>}
    </div>)}

  </section>;
}
