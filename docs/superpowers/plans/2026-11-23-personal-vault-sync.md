# Personal Vault Sync Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requests subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cloud와 Local 사이에 노트와 첨부를 전달하고, 충돌한 버전을 다른 PC에서도 고를 수 있게 한다.

**Architecture:** 각 설치가 개인 보관함의 Git 복제본을 갖는다. Git의 병합 결과를 격리된 공간에서 계산하고, 버전 선택이 필요한 파일에는 원래 경로와 모든 후보 바이트를 유지한다. 앱에 적용하기 전 Git만으로 이 약속이 성립하는지 먼저 실행 검증한다.

**Tech Stack:** 기존 Electron, React, Node.js, 시스템 Git. 첫 실험은 Python 표준 라이브러리와 Git만 사용한다.

---

[검토한 설계와 인수 기준](../specs/2026-11-23-personal-vault-sync-design.md)

## 첫 실행 단위 — 개인 데이터에 접근하지 않는 Git 실험

이번 검토 다음에 실행할 단위다. 핵심 질문은 **두 PC가 같은 파일을 고친 상태에서 정상 문서를 먼저 보내고, 한참 뒤에 돌아온 다른 PC의 버전까지 보존할 수 있는가**다. 기존 백업에 ZIP을 단순 추가하면 이미 연결된 보관함의 옛 ZIP까지 사용자 모르게 업로드할 수 있다. 제품의 자동 게시 범위를 바꾸기 전에 이 실험을 임시 원격에서 실행한다.

대상 파일은 `scripts/verify-personal-sync.py`. 각 케이스가 만든 임시 bare 원격과 복제본에서만 Git을 실행한다. 테스트용 커밋 작성자는 기기별 별칭이다. 제품은 Git 작성자와 설치 ID를 따로 기록한다.

- [x] 사례 1. 공통 기준을 복제한 Cloud가 회의록을 작성한다. Local이 fast-forward하고 이어 쓴 뒤 ZIP·XLSX·PPTX·PDF 예제 바이트를 함께 보낸다. Cloud에서 실제 파일 내용을 대조하고 편집 커밋이 정확히 두 개인지 확인한다. 수신과 빈 주기의 커밋 수는 0이어야 한다.
- [x] 사례 2. 같은 기준에서 Cloud·Local·오프라인 PC가 같은 한글 경로의 Markdown과 바이너리를 각각 수정한다. 별도의 정상 노트도 만든다. 일반 Push가 경합으로 거절되고 Git의 일반 병합에서 실제 미해결 항목이 생기는 지점을 확인한다.
- [x] 임시 통합 복제본에서 `git ls-files --unmerged -z`의 경로와 stage를 읽는다. 원격을 체크아웃한 통합 복제본에서 stage 2가 원격, stage 3이 들어오는 기기의 원본이다. 각 blob을 `git cat-file blob <oid>`로 읽고 경로 키와 blob별로 보존한다. 이미 보존한 항목을 재작성하지 않는다. 원본 경로에는 stage 2 내용을 둔 뒤 두 부모를 가진 일반 병합 커밋으로 게시한다. 수정 대 삭제에서는 삭제 측을 본문 없는 후보로 기록한다. 이미 미해결인 경로는 Git이 정상 병합한 경우에도 새 수정을 후보로 보존한다.
- [x] 원격을 새 폴더에 복제해 정상 노트, 파일별 후보 3개, 각 후보의 출처와 바이트를 검증한다. 같은 입력을 재처리했을 때 원격 HEAD와 커밋 수가 같아야 한다.
- [x] 사례 3. 회의록 하나를 이전 내용으로 복원해 일반 커밋으로 보낸다. 다른 파일의 바이트, 복원 직전 커밋, 다른 PC가 받아 본 결과를 대조한다.
- [x] `python3 scripts/verify-personal-sync.py -v`로 재현하고 결과를 아래 기록한다. 실제 앱의 자동 전송 및 열린 편집기 동작은 제품 단계에서 별도로 측정한다.

## 제품 구현 순서와 검증 지점

| 순서 | 적용 위치와 동작 | 다음 단계로 넘어가는 증거 |
|---|---|---|
| 1. 개인 보관함 연결과 파일 범위 | `electron/main.mjs`의 개인 공간 판별, `electron/git-controller.mjs`의 보관함별 설정, `src/GitSettings.jsx`의 연결 화면에 양방향 모드와 기기 등록을 연결한다. `core/git-backup.mjs`의 기존 백업 허용 목록을 보존하고 새 모드의 파일 판별에서 ZIP과 검증한 내부 메타데이터를 포함한다. | 임시 개인·팀 원격 시험에서 별칭 변경 전후 기기 수가 같고, 레거시 백업에서는 기존 ZIP이나 내부 상태 파일이 새로 게시되지 않는다. 큰 직접 복사 파일은 로컬 대기로 표시된다. |
| 2. 송수신과 재시작 | `core/personal-sync.mjs`에서 Git 상태 비교, 격리 통합, 미전송 커밋 복구, 서버의 예상 브랜치 값 검사를 구현한다. `electron/git-controller.mjs`가 같은 보관함의 Git 쓰기를 직렬화한다. | 임시 원격에서 빈 주기, 정상 전송, 재시도, 응답 유실, 원격 삭제·되감기, 검증 중 로컬 수정, 비정상 종료를 주입하고 원격 및 로컬 이력을 대조한다. |
| 3. 탐색기와 열린 노트 | `electron/main.mjs`에 OS 창 복귀·이탈, 파일 감시와 재스캔을 연결한다. `src/useVaultDocuments.jsx`, `src/saveQueue.mjs`, `src/App.jsx`와 스티키 창이 저장 세대와 보관함을 확인한 뒤 디스크·열린 탭을 함께 갱신한다. | 시계 주입 시험으로 5분 편집 배치·1분 확인·창 이탈 중복을 검증한다. 두 Electron 인스턴스에서 미저장 줄, 파일 복사 도중의 교체, 오래 열린 탭과 포커스 없는 RDP 전환을 재현한다. |
| 4. 파일별 버전 검토 | 첫 실험에서 검증한 Git 저장 구조를 제품의 경로 검사, 삭제 의도, 기기 ID와 연결한다. `electron/preload.cjs`와 `electron/main.mjs`가 해당 보관함·파일·후보 집합을 검증한다. `src/App.jsx`에서 검토 화면을 열고 후보 집합이 바뀌면 기존 선택을 유지하고 새 후보를 보여준 뒤 적용을 다시 받는다. | 동시 해결, 오프라인 세 번째 기기, 수정 대 삭제, 이미 점유된 사본명, 실패 후 재시작을 검사한다. 관련 없는 문서는 계속 전파되고 두 PC 모두 같은 검토 목록을 보여야 한다. |
| 5. 파일 버전 복원과 수집기 | `core/git-history.mjs`와 `src/GitHistory.jsx`에 경로별 이력·미리보기·선택 복원을 추가한다. `electron/copilot-journal.mjs`, `core/copilot-journal-links.mjs`, `src/JournalFeed.jsx`는 수신한 세션과 기존 삭제를 존중한다. | 최근 1,000개 밖의 파일 버전, 한 파일만 복원한 뒤 재동기화, 수집 링크 중복·부활 방지, 팀 보관함 격리를 회귀 시험한다. |
| 6. 사용 환경 확인 | 기존 Git·vault·preload·saveQueue 테스트와 전체 `npm test`, `npm run build`를 실행한다. 실제 Windows Cloud PC와 Local에서 같은 임시 개인 보관함으로 사용자 시나리오를 수행한다. | 파일 해시, 남은 초안, 기기별 후보, 재접속 후 최종 이력과 빈 주기의 커밋 수를 기록하고 실제 장비 결과를 구분한다. |


## 첫 실행 단위의 결과

임시 로컬 원격에서 다섯 시험이 통과했다. Markdown 이어 쓰기와 ZIP·XLSX·PPTX·PDF 왕복에는 편집 커밋 두 개가 생겼다. 세 복제본에서 같은 Markdown·ZIP을 수정한 뒤에도 다른 노트와 모든 후보가 새 복제본에 도착했다. 단일 파일 복원, 삭제 대 수정, 응답 후 같은 입력을 다시 처리하는 경우도 확인했다. 파일 내용과 원격 커밋 ID를 검사한다.

일반 Git 병합만 사용한 첫 시험은 실제 충돌에서 멈췄다. 충돌 항목만 처리한 두 번째 구현은 미해결 문서의 이전 표시본에서 파생된 새 편집을 그대로 표시본으로 채택했다. 변경 경로와 미해결 목록을 대조한 뒤에는 이 입력도 세 후보로 보존됐다. 실험은 시험 함수가 명시적으로 송수신을 호출한다. 운영용 자동화, 복사 완료 감지, 동시 해결, 별칭 등록, Windows 앱의 열린 탭과 전원 중단 복구는 위 제품 단계의 검증 항목이다.

## 제품 검증 결과 · 2026-11-24

- GitHub에서 구동한 Windows PC와 별도 macOS 기기가 임시 Git 브랜치 하나를 공유했다. Windows에서 한국어 회의록을 만들고 Mac 편집기에서 이어 썼다. Mac에서 File Storage에 복사한 ZIP과 PDF가 Windows의 열린 앱에 주기 확인으로 도착했고 두 첨부의 SHA-256이 일치했다. Windows가 쓴 수신 확인 노트를 Mac에서도 읽었다. 등록 기기는 두 대였다. [Windows ↔ Mac 왕복 실행](https://github.com/mrdylee/dyNote/actions/runs/45201290601)
- 서로 다른 프로필의 Electron 창 세 개에서 충돌 검토 중 세 번째 후보를 받았다. 선택한 ‘3시’가 유지됐고 적용한 결과가 다른 창에도 도착했다. Windows의 작은 창에서 적용 버튼을 누르지 못하던 경우를 재현해 검토 창을 스크롤할 수 있게 했다.
- 528 MiB 트리를 512 MiB 경계에서 중단하고 남은 경로를 수정한 뒤 재개했다. 새 바이트가 검토 후보로 남았다. 파일 교체 전후의 중단, 열린 핸들의 지연 쓰기, 전송 완료 응답 유실, 원격 삭제·되감기, 기기 개명·해제·재등록, 바이너리 모두 유지, Markdown 구간 선택도 별도로 검사한다.
- Mac 전체 자동 시험은 550건 중 549건 통과, Windows 전용 1건 건너뜀이다. Git 실험 5건, 프로덕션 빌드와 작은 창에서의 Electron 시험도 통과했다. 테스트는 합성 파일과 격리 프로필을 사용했다. 회사의 RDP 정책·SSO·저장소 권한에 따른 현장 동작은 별도 확인 대상이다.
