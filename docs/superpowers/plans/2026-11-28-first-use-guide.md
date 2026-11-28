# Dynote 첫 사용 안내 구현 계획

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** 설치 직후 첫 기록과 기존 노트 가져오기를 스스로 시작할 수 있게 한다.

**Architecture:** 예제 보관함 여부는 Electron에서 확인한다. React는 기존 폴더 선택, 보관함, 저널 저장, 동기화 진입점을 재사용한다.

**Tech Stack:** Electron, React, Playwright, Node.js

- [x] scripts/verify-first-use.mjs에서 빈 임시 프로필을 열고 첫 사용 화면과 가져오기·팀 양식, 예제, 취소, 첫 저장, 다시 시작을 검사한다. npm run build 후 node scripts/verify-first-use.mjs로 기존 앱에서 첫 화면 검사가 실패하는 것을 확인한다.
- [x] electron/main.mjs의 vaults 응답에 예제 보관함 판정을 추가한다. src/App.jsx와 src/FirstUseGuide.jsx에서 목표별 선택을 제공하고 src/VaultSettings.jsx에서 가져오기 또는 팀 항목을 바로 연다. 설정과 앱 정보에서 다시 열 수 있게 한다.
- [x] 첫 저널 편집과 성공한 저장을 연결해 완료 안내와 실제 폴더를 표시한다. 재시작 시 완료·닫기 상태를 복원한다. src/GitSettings.jsx에서 목적과 연결 방식을 안내한다.
- [x] npm run build, node scripts/verify-first-use.mjs, node scripts/verify-vault-entry.mjs 및 관련 테스트를 실행한다. 원격 저장소 대신 임시 로컬 Git 원격으로 업로드와 새 PC 가져오기를 확인한다.

검증 환경은 macOS Electron이다. 전체 Node 테스트는 717개 통과, 2개 건너뜀. verify-first-use, verify-vault-entry, verify-journal-navigation, verify-vault-spaces를 실행했다. 새 프로필의 가져오기에서 로컬 Git 원격의 실제 문서가 목록에 나타나는 것을 확인했다. Windows Setup과 실제 GitHub 로그인은 별도 검증 대상이다.
