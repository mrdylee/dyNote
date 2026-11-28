import { BookOpen, Download, FolderOpen, Users } from "lucide-react";

import { useEffect, useState } from "react";

const topics = {
  files: ["파일 목록", "‘새 문서’로 노트를 만드세요. File Storage에는 노트와 함께 보관할 일반 파일을 넣을 수 있어요."],
  search: ["검색", "제목을 찾거나 본문 검색으로 바꿔 여러 노트의 내용을 한 번에 찾으세요."],
  recent: ["최근 파일", "최근에 열었던 문서를 선택해 이어서 작성하세요."],
  bookmarks: ["북마크", "문서에 북마크를 추가하면 이 목록에서 다시 열 수 있어요."],
  calendar: ["달력", "날짜를 선택해 해당 날짜의 일지를 여세요."],
  graph: ["그래프", "노트에 [[문서 이름]]을 적으면 두 문서가 그래프에서 연결됩니다."],
  planner: ["개발 플래너", "프로젝트의 할 일을 보드에서 확인하고 관리하세요."],
  "sticky-board": ["포스트잇", "보드에서 메모를 선택해 열고 이어서 작성하세요."],
  copilot: ["Copilot", "문서를 열고 질문을 입력하세요. 대화를 저널에 모으려면 설정에서 ‘Copilot 대화 자동 저장’을 여세요."],
};

export function FeatureTip({ topic }) {
  const key = "dynote.firstUse.seen." + topic;
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(key); } catch { return true; }
  });
  useEffect(() => {
    if (visible) { try { localStorage.setItem(key, "1"); } catch { /* Keep the tip dismissible. */ } }
  }, [key, visible]);
  if (!visible || !topics[topic]) return null;
  const [name, text] = topics[topic];
  return <aside className="first-use-tip" role="note" aria-label={name + " 사용 안내"}>
    <span>{text}</span><button aria-label={name + " 안내 닫기"} onClick={() => setVisible(false)}>닫기</button>
  </aside>;
}

export default function FirstUseGuide({ personal, example, busy, onWrite, onImport, onTeam, onExample, shortcut }) {
  return <section className="first-use-guide" aria-label="시작 방법">
    <h2>어떻게 시작할까요?</h2>
    <button aria-label={personal ? "오늘의 저널 열기" : "이 PC에서 노트 쓰기"} disabled={busy} onClick={onWrite}>
      <FolderOpen/><span><strong>{personal ? "오늘의 저널 열기" : "이 PC에서 노트 쓰기"}</strong>
      <small>{personal ? "개인 폴더에 오늘의 기록을 남깁니다." : "새 폴더나 기존 노트 폴더를 선택하세요. 계정 없이 바로 쓸 수 있어요."}</small></span>
    </button>
    <button aria-label="다른 PC의 노트 가져오기" disabled={busy} onClick={onImport}><Download/><span><strong>다른 PC의 노트 가져오기</strong><small>기존 저장소에서 이 PC의 빈 폴더로 노트를 받습니다.</small></span></button>
    <button aria-label="팀 노트 연결하기" disabled={busy} onClick={onTeam}><Users/><span><strong>팀 노트 연결하기</strong><small>팀에서 받은 저장소 주소나 공유 폴더를 연결합니다.</small></span></button>
    {example && <button aria-label="예제로 둘러보기" disabled={busy} onClick={onExample}><BookOpen/><span><strong>예제로 둘러보기</strong><small>시작하기 문서에서 노트와 문서 링크를 살펴보세요.</small></span></button>}
    <details><summary>기능별 사용법</summary><dl>
      {Object.entries(topics).map(([id, [name, text]]) => <div key={id}><dt>{name}</dt><dd>{text}</dd></div>)}
      <dt>검색 단축키</dt><dd>문서 안에서 찾기는 {shortcut}+F, 전체 검색은 {shortcut}+Shift+F입니다.</dd>
      <dt>백업과 동기화</dt><dd>설정 → 보관함 → 개인 노트의 동기화 설정에서 일일 백업이나 여러 PC에서 이어 쓰기를 선택하세요.</dd>
    </dl></details>
  </section>;
}
