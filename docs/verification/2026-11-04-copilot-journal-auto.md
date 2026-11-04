# Copilot 저널 자동기록 검증

2026-11-04. MCP 구현은 보류했다. 저널의 가져오기 버튼, 선택한 로컬 VS Code 프로젝트의 자동 기록, 프로젝트/대화 제목 삭제와 되돌리기를 구현했다. 설정은 기본 비활성이며 개인 공간에서 프로젝트를 선택해 켠다.

## 구현 결과

- 가져오기: 자동 기록 상태와 별개로 선택한 프로젝트의 오늘 완료된 질문/답변을 가져온다.
- 자동 기록: 앱 실행 중 약 5초마다 활성화 이후 대화를 확인한다. 입력과 다른 modal 작업 중에는 반영을 미룬다. 새 세션도 프로젝트·날짜별 한 문서와 한 저널 링크에 모인다.
- 삭제: 프로젝트 제목은 해당 날짜 전체, 대화 제목은 그 대화만 정리한다. 삭제 제외를 저장하여 재시작과 재수집 후 재등장을 막고, 문서와 저널을 함께 복원할 수 있다.
- 보존: VS Code 원본 불변, 개인/팀 공간 경계, revision 충돌 중단, source symlink/경로 변경 거부. 저널의 직접 쓴 문장, 관리 링크 사이 메모와 코드 예시는 보존한다.
- 보기: 관리용 marker는 Live Preview/읽기에서 숨기며 소스에는 남긴다. 상태 오류는 한 줄에 표시하여 안내의 출현/소멸로 편집 위치가 바뀌는 것을 줄였다.

## 테스트와 코드 리뷰

전체 `npm test`: **414 통과, 0 실패, 0 skip**. 패키징 과정의 production build 통과(기존 번들 크기 advisory만 표시).

새 decoder/controller 테스트는 snapshot + mutation JSONL, SDK transcript, 미완료/숨김/추론/도구 제외, 반복 문장, 날짜, 중복, 빈 UI snapshot의 transcript fallback, 프로젝트 선택, 삭제/복원, 재실행, source/vault 경로 경계와 사용자 메모를 확인한다. 실제 로컬 저장 파일 각각 한 개의 snapshot/transcript 형식을 decoder로 읽어 수용함을 확인했으며 본문을 출력하거나 사용자 파일에 쓰지 않았다. 이 관찰은 새 VS Code 대화를 실행해 생성하는 end-to-end 검증을 뜻하지 않는다.

리뷰 중 다음 실패를 먼저 재현하고 수정했다.

1. 예약된 객체 속성 이름의 workspace가 선택되지 않아도 수집되던 문제: own-property 선택 검사.
2. 수정된 문서의 삭제가 거부되어도 제외/undo 상태가 남던 문제: 실패 시 이전 상태 복구.
3. 관리 marker 사이 사용자 문장과 fenced 예시까지 제거되던 문제: Markdown 구조로 범위를 판정하고 생성된 링크/marker만 제거.

패키지 native 시나리오는 실제 Electron에서 합성 source/profile/vault만 사용한다. 오늘 가져오기, 새 세션 자동 반영, Live Preview marker 숨김, 입력 중 텍스트/모드 보존, 제목별/묶음 삭제, undo, 재시작 제외와 개인/팀 IPC 경계를 검증했다.

- copilot-journal-package: 11 checks, 0 failures, 0 renderer errors
- copilot-journal-ergonomics: 15 checks, 0 failures, 0 renderer errors
- copilot-journal-review: 11 checks, 0 failures, 0 renderer errors

## 확인용 앱

`output/copilot-journal-build/Dynote-darwin-arm64/Dynote.app`

`verify-release-package.mjs darwin-arm64`가 현재 core/electron/dist 등 소스·번들 **283개 파일**과 ASAR 포함 파일/의존성을 확인하고 `codesign --verify --deep --strict`를 통과했다. ad-hoc 서명이며 Developer ID 서명/공증을 수행하지 않았다.

ASAR SHA-256: `778c6ad5f36b4ade9bc564b422b64d27b23674ae078779700d60a7978250d5a6`

기계 판독 결과: `output/verification/copilot-journal-package.json`.

## 실행 경계

- Windows native 실행과 WSL/SSH/Cloud 수집은 검증하지 않았다. 표준 로컬 경로 및 기록 폴더 직접 선택을 구현했다.
- 지원 형식은 VS Code snapshot JSON / mutation JSONL 및 대응 Copilot runtime transcript JSONL이다. 원본 파일당 64MB까지 읽으며 지원하지 않거나 쓰는 중인 형식은 상태에 오류로 표시한다.
- 직접 수정/이동한 수집 문서는 덮어쓰지 않고 중단한다. 완료된 응답만 가져오므로 취소/미완료 메시지 전체를 보존한다는 의미가 아니다.
- 입력 중에는 수집 반영을 미루므로 앱 종료 직전의 대화를 원격으로 보냈다는 보장은 없다. 다음 실행/가져오기에서 원본에 남은 지원 범위를 확인한다.
- 실제 사용자의 VS Code 설정, 설치된 Dynote.app, 개인 보관함은 변경하지 않았다. 계정 연결, 새 의존성 설치, Git 원격 업로드, 공개 배포는 수행하지 않았다.
