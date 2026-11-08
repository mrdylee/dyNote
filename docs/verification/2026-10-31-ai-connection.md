# AI 연결 진입 수정 검증

2026-10-31, macOS arm64 / Electron 44.9.0 / Dynote 0.12.2 로컬 수정본.

## 확인한 원인과 수정

- 실제 설치본에서 Codex를 선택하면 상태 조회 후 미인증 상태가 된다. 로그인 동작은 작은 계정 메뉴 안에만 있었고 전송 안내에는 실행 버튼이 없었다.
- 제공자 선택 시 연결 확인을 표시하고, 미인증 상태에는 제공자 로그인과 연결 다시 확인 버튼을 직접 표시한다. Codex 안내를 Codex 로그인으로 통일했다. 인증 프로토콜은 기존 공식 브라우저 흐름을 사용한다.
- 상태 조회 실패 시 이전 인증 상태를 무효화하여 잘못된 전송 가능 상태를 막는다. 입력한 질문은 유지한다.
- 240px 패널에서 제공자 선택기가 추가된 계정 메뉴가 밖으로 밀리는 현상도 수정했다.

## 검증

- 단위 테스트 316/316, production build, diff check 통과.
- 변경 전에는 제공자 이름 검사 및 직접 로그인 버튼 검사가 예상대로 실패했다.
- 실제 Electron 창과 제어된 IPC로 Codex/Claude 자동 상태 조회, 로그인 실행, 대기·취소·오류·재시도, 인증 완료 후 모델 갱신, 오래된 인증 상태 무효화와 질문 유지를 검증했다. 최종 Mac 패키지에서도 통과했다.
- 기존 제공자 Ask/Edit·응답 취소·명시적 수정안 적용, 계정 메뉴와 240px 패널, 현재 문서 전송·초안 보호 검증이 통과했다. 제어된 응답이며 실제 유료 추론 검증은 아니다.
- 실제 Codex CLI 0.166.0에서 임시 프로필 상태 조회, 공식 로그인 URL 발급, 취소까지 성공했다. URL이나 토큰을 기록하지 않았다.
- 사용자 직접 인증 후 실제 설치본에서 GPT-6.1-Sol, Ask, 문서 없음, 참고 문서 0개로 `Reply only: connection successful.`를 전송했고 `connection successful.` 응답을 수신했다. 개인 문서를 전송하지 않았다. Claude의 실제 계정 로그인·모델 응답은 검증하지 않았다.
- 설치된 npm Claude CLI 1.0.127은 기존 최소 요구 버전보다 오래됐다. 공식 native 설치기로 2.1.309를 설치했고 Dynote controller의 실제 상태 조회가 성공했다. 기존 npm 설치와 계정 설정은 제거하지 않았다.

검증 스크립트: `scripts/verify-ai-connection.mjs`, `verify-ai-providers.mjs`, `verify-copilot-account-layout.mjs`, `verify-ai-send-state.mjs`. 실행 결과와 화면은 `output/playwright/ai-connection.json`, `ai-connection-login.png` 등에 있다.

## 로컬 설치

- 최종 앱의 엄격한 번들 서명 검사가 통과했다. 패키지의 dist/core/electron 실행 파일 269개가 현재 소스·빌드와 일치하고 버전·런타임 의존성이 일치했다.
- 기존 앱을 정상 저장·종료한 뒤 `Dynote Install Backups/2026-10-31-ai-connection-n2a2f1to/Dynote.app`에 보관하고 `/Applications/Dynote.app`을 교체했다. 사용자 데이터와 개인 보관함을 복사하거나 AI로 전송하지 않았다.
- 정상 실행된 실제 설치 경로의 프로세스와 새 Codex 로그인 버튼을 확인했다. 버튼을 눌러 실제 브라우저 인증 대기 상태와 취소 버튼을 확인한 뒤, 계정 인증 완료와 모델 8개 조회까지 확인했다. 계정 식별 정보는 이 문서에 기록하지 않는다.
- 설치된 앱 실행 파일로 `verify-settings-runtime.mjs`도 통과했다. 설치 글꼴 258개 자동 조회, 백업·복원 메뉴, 설정 저장·재시작과 임시 원격 백업을 다시 확인했다.
- 앞선 글꼴 자동 조회·백업 설정 정리도 이 설치본에 포함한다. 공개 배포 및 Windows 실제 실행은 이번 작업에 포함하지 않았다.

[공식 인증 명세](https://learn.chatgpt.com/docs/app-server#3-log-in-with-chatgpt-browser-flow), [Claude 공식 설치 안내](https://code.claude.com/docs/en/setup).
