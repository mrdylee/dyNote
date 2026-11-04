# Copilot Journal Auto Recording Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation.

**Goal:** 선택한 VS Code 프로젝트 대화를 저널에 자동 기록하고 제목에서 함께 삭제/복원한다.

**Architecture:** 순수 형식 decoder와 Markdown 생성은 core/copilot-journal.mjs, 원본 검색·설정·기록·휴지통은 electron/copilot-journal.mjs로 나눈다. Renderer는 입력 중 동기화를 미루고 기존 IPC/저장 큐로 반영한다. MCP와 VS Code 설정 변경은 없다.

**Tech Stack:** Node filesystem, Electron IPC, React, 기존 Vault와 periodic notes, node:test와 Playwright.

## Tasks

- [x] tests/copilot-journal.test.mjs: mutation log, transcript, 완료 상태, 날짜, 중복/숨겨진 내용의 실패 사례를 만든다. `node --test tests/copilot-journal.test.mjs`에서 누락 모듈 실패를 확인한 뒤 core/copilot-journal.mjs를 구현한다.
- [x] tests/copilot-journal-controller.test.mjs: 임시 source/profile/vault로 활성화 이후 수집과 삭제/복원/재시작, 링크 보존, 개인·팀 분리, symlink를 검증한다. 실패 후 electron/copilot-journal.mjs를 구현한다.
- [x] electron/main.mjs와 electron/preload.cjs에 status/configure/sync/trash/restore/source-pick 채널을 추가한다. 쓰기는 기존 exclusive mutation과 Git 큐를 사용한다.
- [x] src/CopilotJournalSettings.jsx, src/CopilotJournalEntries.jsx 및 src/App.jsx에 프로젝트 선택과 자동 갱신을 연결한다. src/JournalFeed.jsx와 src/styles.css에 제목 옆 삭제 버튼을 추가한다. 원문 입력을 HTML로 삽입하지 않는다.
- [x] scripts/verify-copilot-journal.mjs에서 실제 Electron으로 프로젝트 설정, 신규 세션 자동 반영, 입력 중 보존, 제목 삭제/실행 취소/재시작 제외를 확인한다. 임시 파일만 사용한다.
- [x] `npm test`, `npm run build`, 기존 journal review/ergonomics 회귀를 실행한다. 코드 리뷰에서 범위/충돌/재수집/복원과 경로 경계를 재검토한다. 수정 후 필요한 검사만 다시 실행한다.
- [x] 별도 output 경로에 Mac 앱을 패키징하고 공개 배포 없이 새 native 시나리오를 확인한다. 변경 파일만 커밋하고 결과와 초기 설정 방법을 보고한다.

## 상태

사용자 검토와 구현 진행이 승인되었다. 원문 구조는 VS Code 공식 chatSessionOperationLog/objectMutationLog와 로컬 저장 구조의 키/타입으로 확인했다. 실제 사용자 대화는 테스트 fixture나 출력에 복사하지 않는다.

## 검증 결과

전체 414개 테스트와 빌드 통과. Mac 확인용 패키지의 소스/번들 283개 파일과 strict deep ad-hoc 서명 검증 통과. 새 native 검사 11개, 저널 ergonomics 15개, journal review 11개 통과. 상세 경계는 docs/verification/2026-11-04-copilot-journal-auto.md에 기록했다. Windows native 실행과 공개 배포는 수행하지 않았다.
