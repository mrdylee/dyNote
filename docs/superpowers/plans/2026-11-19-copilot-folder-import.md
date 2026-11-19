# Copilot Folder Import Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. Steps use checkbox syntax for tracking.

**Goal:** 기록 폴더 선택 후 완료된 대화를 전부 가져오고 세션 선택 단계를 제거한다.

**Architecture:** `CopilotJournal.configure`의 `allProjects` 설정과 `sync`의 명시적 `allSessions` 요청을 사용한다. 기존 선택형 API와 저장 경로는 보존한다. 폴더 선택 UI는 설정 적용과 전체 가져오기를 순서대로 호출한다.

**Tech Stack:** Electron, React, Node test runner, Playwright.

## 1. 전체 범위 컨트롤러

- [x] `tests/copilot-journal-controller.test.mjs`에 `allProjects:true` 설정 및 `sync(vault,{},true,{allSessions:true})`를 사용하는 테스트 추가. 두 프로젝트의 과거 날짜 대화, 중복 방지·삭제 제외, 새 프로젝트 자동 발견, 기존 이관과 중단된 저장 재시도를 확인한다.
- [x] `node --test tests/copilot-journal-controller.test.mjs`로 전체 가져오기·새 프로젝트 자동 발견·중단 복구의 실패 확인.
- [x] `electron/copilot-journal.mjs`에서 전체 프로젝트 설정을 저장하고 모든 날짜를 가져오는 분기를 기존 트랜잭션에 연결한다. 자동 수집의 새 프로젝트에는 저장된 활성화 시점을 사용한다.
- [x] `electron/main.mjs`에서 전체 가져오기 옵션을 전달하고 위 테스트 재실행. 컨트롤러 36개 통과.

## 2. 폴더 중심 설정 UI

- [x] `scripts/verify-copilot-capture-drafts.mjs`에 세션·프로젝트 선택 없이 폴더 선택만으로 저장되는 실패 검증 추가.
- [x] `src/CopilotJournalSettings.jsx`에서 선택 목록 상태와 버튼을 제거한다. 발견한 프로젝트는 읽기 전용으로 표시하며 전체 대화 가져오기와 자동 저장 설정을 제공한다.
- [x] `src/App.jsx`의 가져오기 콜백을 `allSessions:true`로 연결하고 결과 문구를 전체 가져오기에 맞춘다. `src/CopilotJournalEntries.jsx`의 버튼 설명도 변경한다.
- [x] 미확정 변경 문서의 검토·보존을 실제 Electron에서 확인한다.

## 3. 회귀 검증 및 기록

- [x] `scripts/verify-copilot-journal.mjs`를 전체 가져오기 흐름으로 갱신하고 기존 원문·링크·WSL·자동 저장·삭제·복원·이관 검증을 유지한다. 22개 통과, renderer 오류 0건.
- [x] `npm test` 497개, `npm run build`, 두 Copilot UI 스크립트, `git diff --check` 통과.
- [x] 검증 문서를 현재 동작과 결과로 갱신한다. 이전 작업의 미커밋 변경은 유지하며 배포하지 않는다.
