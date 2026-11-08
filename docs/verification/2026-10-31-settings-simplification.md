# 글꼴 자동 조회와 백업 설정 정리 검증

2026-10-31, macOS arm64 / Electron 44.9.0 개발 실행본에서 확인했다.

- 글꼴 설정 진입 시 설치 글꼴 258개를 자동 조회한다. 불러오기 버튼이 없으며 검색·스크롤·선택·크기·재시작 후 저장을 확인했다.
- 조회 실패 시 직접 입력이 가능하며, 다시 진입하면 자동으로 재조회한다. 사용자 활성화가 없는 프로그램 방식의 설정 진입에서도 실제 글꼴 조회가 성공했다.
- 설정 상단은 6개 항목이며, 백업·복원 안에 자동 백업 / 복원 / 고급 Git 관리가 있다. 세부 설정은 접혀 시작하며 작성자 설정이 재시작 후 유지된다.
- 임시 Git 원격 저장소에서 연결·백업·누락된 일일 백업 보충·실패 후 재시도·자동 백업 끄기·같은 날 다시 켜기를 검증했다.
- 복원 미리보기와 확인 체크 후 실제 파일 복원, 기존 HEAD 유지 및 복구 사본의 원본 바이트를 검증했다.
- 명령 팔레트가 고급 Git 관리로 바로 진입한다. 스테이징·차이·커밋·브랜치 전환과 미저장 변경이 있는 브랜치 전환 거부를 검증했다.
- 보관함이 없을 때 세 백업 화면 모두 폴더 선택 안내를 표시한다. 작은 창에서 설정 내용의 가로 넘침이 없다.

검증: `npm test` 315/315 통과, `npm run build` 통과, `git diff --check` 통과. 빌드에는 기존 대형 청크 경고가 있다.

화면 검증은 `scripts/verify-settings-runtime.mjs`, `scripts/verify-vault-history-runtime.mjs`, `scripts/verify-git-workspace.mjs`로 실행했다. Playwright 경로는 `DYNOTE_PLAYWRIGHT_MODULE` 환경 변수로 지정한다. 세 실행 모두 renderer 오류가 없었다. 변경 전 빌드에서는 불러오기 버튼 제거 검사가 예상대로 실패했다.

화면 및 실행 결과: `output/playwright/git-daily-settings.png`, `backup-settings-compact.png`, `font-settings.png`, `settings-runtime.json`, `vault-history-runtime.json`, `native-git-workspace.json`.

모든 데이터 변경 검사는 임시 프로필·보관함·원격 저장소로 수행했다. 설치된 사용자 앱 교체, 공개 배포 및 Windows 실제 실행은 이번 작업에 포함하지 않았다.
