import { useState } from "react";

export default function CopilotRestore({ preview, busy, error, onClose, onRestore }) {
  const [choices, setChoices] = useState({});
  const ready = preview.rows.every(row => !row.conflict || choices[row.path]);
  return <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="복원 지점 확인" className="modal wide copilot-checkpoint">
    <div className="modal-heading"><h2>요청 직전으로 복원</h2><button disabled={busy} onClick={onClose}>닫기</button></div>
    <p>이 질문과 이후 대화를 되돌립니다. {preview.rows.length ? `영향받는 노트 ${preview.rows.length}개` : "변경할 노트가 없습니다."}</p>
    {preview.rows.map(row => <section key={row.path}><strong>{row.path}</strong>
      {row.conflict && <label>직접 편집 또는 외부 변경 <select aria-label={row.path + " 충돌 처리"} value={choices[row.path] || ""} disabled={busy}
        onChange={e => setChoices(old => ({ ...old, [row.path]: e.target.value }))}><option value="">선택해 주세요</option>
        <option value="keep">현재 내용 유지</option><option value="restore">요청 직전으로 복원</option></select></label>}
      <details open={row.conflict}><summary>변경 내용 비교</summary>
        <div className="copilot-restore-diff"><div><b>현재</b><pre>{row.current ?? "(문서 없음)"}</pre></div>
          <div><b>복원 후</b><pre>{row.before ?? "(문서 없음 · 저장된 노트는 휴지통으로 이동)"}</pre></div></div>
        {(row.current !== row.disk || row.before !== row.diskTarget) && <div className="copilot-restore-diff">
          <div><b>디스크의 현재 내용</b><pre>{row.disk ?? "(문서 없음)"}</pre></div>
          <div><b>복원 후 디스크 내용</b><pre>{row.diskTarget ?? "(문서 없음)"}</pre></div>
        </div>}
      </details></section>)}
    {error && <p role="alert">{error}</p>}
    <button disabled={!ready || busy} onClick={() => onRestore(choices)}>선택한 상태로 복원</button>
  </section></div>;
}
