# AI 제공자 및 Windows 배포 사전 검토

- 사용자 요청: Windows 공개 배포, Copilot에 Codex·Claude 추가. 연결 방식은 계정 로그인과 설치된 CLI 우선.
- Codex: 기존 검증된 app-server 구현을 복구하고 최신 컨텍스트·참고 문서 요청 형식에 연결. Claude: 공식 CLI auth와 print stream-json 사용.
- Dynote 전용 계정 프로필과 빈 작업 폴더를 사용. 자격 증명은 화면으로 전달하지 않으며, 코드·노트 파일에 직접 접근하는 도구는 제공하지 않음.
- UI: 제공자별 모델 선택 저장, 전환 시 대화 초기화, 요청·로그인·미확정 수정안이 있으면 전환 제한. Ask/Edit는 기존 수정안 비교와 원본 변경 검사를 사용. Copilot Agent 유지.
- 단위 테스트: 초기 Codex 모듈 없음 및 Claude 모듈 없음으로 실패 확인 후 구현. 참고 문서 전달·미지원 Agent 거부를 추가 검증. Windows 기본/사용자 지정 npm 설치 경로 검사 포함.
- 실제 Mac Electron + 결정적 IPC: 양쪽 제공자의 전환·취소·수정안 확인 전 파일 불변·승인 후 저장 통과. 실제 사용자 계정이나 유료 모델은 사용하지 않음.
- 실제 Codex 0.166.0: 새 프로필 app-server 초기화·계정 조회 성공. 실제 Claude 2.1.314: 새 프로필 auth status 및 로컬 HTTP 응답 서버를 통한 스트리밍 성공, 제공 도구 0개 확인.
- 기존 저널/문서 비교/분류/업데이트 화면 시나리오 통과. 빌드는 성공하며 기존 큰 번들 경고가 있음.
- 최종 Mac 단위 테스트 315개 모두 통과. 기존 Copilot Agent의 참고 문서, 문서 간 전환, 두 문서 초안 유지·확정, CRLF 보존도 실제 Electron 화면에서 통과.
- 현재 Mac의 기존 Claude CLI는 구버전이므로 변경하지 않고 별도 임시 설치로 검증함.
- Windows 공개 배포는 새 워크플로의 네이티브 테스트·패키지 실행을 통과한 뒤 진행. 게시 결과와 다운로드 검증은 별도 보고서에 기록.

재실행: `npm test`, `npm run build`, `node scripts/verify-ai-cli-runtime.mjs`, Playwright 경로 지정 후 `node scripts/verify-ai-providers.mjs` 및 `node scripts/verify-journal-workspace.mjs`.
