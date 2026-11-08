# Development Studio AI 연결 공유 검증

2026-10-31, macOS arm64 / Electron 44.9.0 / Dynote 0.12.2 로컬 수정본.

## 원인과 변경

- 오른쪽 AI 패널만 제공자와 모델을 저장하고, Planner는 `copilotStatus`, `copilotSend`, `onCopilotEvent`, `copilotCancel`을 직접 호출했다. 변경 전 실제 Electron 회귀 검사에서 Codex / vision-2를 선택했지만 첫 추출과 원본 대조가 모두 Copilot / vision-1로 전송되는 것을 확인했다.
- 앱 공통 `useAiSession`이 선택한 제공자, 제공자별 모델, 연결 상태를 관리한다. 채팅과 Studio가 이를 공유하며, 연결된 캡처 작업은 별도 로그인이나 불필요한 상태 조회를 시작하지 않는다. 선택은 재실행 후에도 유지된다.
- 추출·원본 대조·함께 생각하기·취소가 같은 제공자를 사용한다. 실행 중 제공자·모델 변경과 동시 채팅을 막고 늦게 도착한 취소 응답은 무시한다. 선택한 텍스트 전용 모델은 그대로 유지하며 이미지 지원 모델을 선택하도록 안내한다. 다른 제공자로 자동 전환하지 않는다.
- Codex는 모델 목록의 이미지 입력 지원 여부를 사용하고 data URL 이미지를 전송한다. Claude는 구조화된 표준 입력의 이미지 블록을 사용한다. 기존 계정 저장소, 인증 경로, 도구 제한과 사용자 노트는 유지했다.

## 검증

- 이미지 전송과 모델 기능에 관한 단위 검사 실패를 먼저 확인한 뒤 수정했다. 최종 전체 단위 테스트 319개, production build, `git diff --check` 통과.
- 최종 Mac 패키지에서 `verify-studio-ai-session.mjs`의 10개 그룹 통과: 세 제공자별 추출/대조/모델 공유, 함께 생각하기/취소, 텍스트 전용 모델 유지, 실행 중 변경 차단과 늦은 응답 무시, 재시작 후 선택 유지, 미인증 계정의 재연결 안내. 합성 이미지와 제어된 IPC만 사용했다.
- 기존 Electron 검증 33개 그룹 통과: 인증 연결 2, 제공자 채팅 3, 전송 상태 5, Planner 10, 캡처 8, 원본 대조 5. 인증 실패 시 전송 차단, 초안·원본 보존, 99개 결과 검토와 저장, 큰 이미지 원본 보존을 포함한다.
- 설치된 Codex CLI의 실제 프로토콜 타입으로 이미지 입력과 모델 기능 필드를 확인했다. 설치된 Claude CLI는 격리 프로필 및 로컬 루프백 응답으로 이미지 입력·스트리밍·빈 도구 목록을 검증했다. 실제 계정의 추가 추론이나 개인 캡처 재전송은 수행하지 않았다.
- 패키지 dist/core/electron/licenses 파일 273개가 현재 소스·빌드와 바이트 단위로 일치한다. 엄격한 번들 서명 무결성 검사 통과. ASAR SHA-256: `cc0ab7faba17b6f33fda1b4ab323ad7d924d97d10bc6949dde80e32db0a51d50`.

## 설치와 실제 사용자 환경

- 기존 앱 저장·정상 종료 후 `Dynote Install Backups/2026-10-31-studio-ai-session-nyescz0r/Dynote.app`에 백업하고 `/Applications/Dynote.app`을 교체했다. 설치된 ASAR는 검증 패키지와 일치한다.
- 새 설치본을 정상 실행해 기존 Codex 인증 및 GPT-6.1-Sol 선택이 유지되는 것을 확인했다. Studio의 함께 생각하기에도 Codex와 같은 모델이 표시되고 로그인 버튼 없이 사용할 수 있는 상태를 확인했다. 확인용 미저장 일정 초안은 닫았다.
- 개인 노트 내용이나 계정 식별 정보를 이 보고서·패키지에 추가하지 않았다. 공개 배포 및 Windows 실제 실행은 수행하지 않았다.
- 앱의 잘못된 제공자 호출을 제거한 수정이다. 계정 인증 만료 또는 macOS 자체 키체인 접근 승인 정책을 우회하거나 자동 승인하지 않는다. 이번 새 설치본 실행과 Studio 진입에서는 추가 로그인/키체인 창이 나타나지 않았다.

로컬 실행 기록: `output/playwright/studio-ai-session.json`, `/private/tmp/dynote-studio-*.log`, `/private/tmp/dynote-studio-package-integrity.json`, `/private/tmp/dynote-studio-install.json`.

참고 명세: [Codex App Server 모델 기능 및 입력](https://learn.chatgpt.com/docs/app-server), [Claude 구조화된 이미지 입력](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [Claude CLI 입력 형식](https://code.claude.com/docs/en/cli-reference).
