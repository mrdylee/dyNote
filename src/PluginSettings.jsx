import { useState } from 'react';

export default function PluginSettings({ data, onImport, onEnable, onShow }) {
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const run = async action => { setPending(true); setError(''); try { await action(); } catch (error) { setError(error.message); } finally { setPending(false); } };
  return <section className="settings-section">
    <h3>Obsidian 원본 플러그인</h3>
    <p>manifest.json과 main.js가 있는 플러그인 폴더를 가져오세요. 플러그인은 별도 창에서 실행되며 문서 읽기·열기·새 문서 만들기와 설정 저장을 사용할 수 있습니다.</p>
    <p className="muted">현재 Recent Files 1.7.10·Calendar 1.5.10을 대상으로 연결했습니다. 다른 플러그인과 Node·네트워크 기능은 지원 범위에 포함되지 않습니다. 신뢰하는 플러그인을 켜 주세요.</p>
    <button className="primary-button" disabled={pending} onClick={() => run(onImport)}>플러그인 폴더 가져오기</button>
    {(error || data.error) && <p role="alert">{error || data.error}</p>}
    <ul className="vault-settings-list">
      {data.entries.map(entry => <li key={entry.id} data-plugin-id={entry.id}>
        <div><strong>{entry.name} {entry.version}</strong><p>{entry.phase === 'loaded' ? '실행 중' : entry.phase === 'loading' ? '시작 중' : entry.phase === 'error' ? '실행 오류' : '꺼짐'}</p>{entry.error && <p role="alert">{entry.error}</p>}</div>
        <div className="settings-actions">
          <button disabled={pending} onClick={() => run(() => onEnable(entry.id, entry.phase !== 'loaded'))}>{entry.phase === 'loaded' ? '끄기' : '켜기'}</button>
          <button disabled={pending || entry.phase !== 'loaded'} onClick={() => run(() => onShow(entry.id, false))}>플러그인 열기</button>
          <button disabled={pending || entry.phase !== 'loaded'} onClick={() => run(() => onShow(entry.id, true))}>원본 설정</button>
        </div>
      </li>)}
    </ul>
    {!data.entries.length && <p className="muted">가져온 플러그인이 없습니다.</p>}
  </section>;
}
