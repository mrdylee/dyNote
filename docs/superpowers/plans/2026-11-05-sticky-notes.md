# Dynote Sticky Notes Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. Steps use checkbox syntax for tracking.

**Goal:** 메인 창을 숨겨도 Ctrl+Shift+M으로 여러 포스트잇을 만들고, 장마다 Markdown과 창 상태를 저장한다.
**Architecture:** Electron 메인 프로세스가 단축키와 메뉴 막대, 카드의 파일 저장 및 수명 주기를 소유한다. 작은 카드 전용 HTML과 제한된 preload를 사용하고 메모 데이터는 기존 Vault로 관리한다.
**Tech Stack:** Electron, Vite, React 설정 화면, Node test, Playwright Electron.

- [x] `tests/sticky-layout.test.mjs`에서 화면 배치와 색 순환, 좁은 화면에서의 복원 경계를 고정한다. `node --test tests/sticky-layout.test.mjs`로 실패를 확인하고 `core/sticky-layout.mjs`를 추가해 통과시킨다.
- [x] `scripts/verify-sticky-notes.mjs`에 격리된 두 보관함과 앱 재시작 검증을 추가한다. 세 장의 색·좌표가 다르고, 저장 파일이 개인 보관함에만 생기며, 닫을 때 마지막 입력을 저장하고, 같은 파일을 다시 열어 색·좌표·핀을 복원하는지 검증한다. 기존 앱에서 설정의 단축키 항목이 없어 실패하는지 확인한다.
- [x] `electron/sticky-notes.mjs`, 전용 preload와 Vite 페이지를 추가한다. `electron/main.mjs`에서 기존 보관함과 종료 경로에 연결하고, `src/App.jsx` 설정에 단축키를 표시한다. `npm run build`와 Electron 시나리오로 확인한다.
- [x] 로컬 diff 리뷰 뒤 `npm test`와 `npm run package:mac`을 실행한다. 패키지에서 같은 시나리오를 실행하고 코드 서명을 검증한다.
