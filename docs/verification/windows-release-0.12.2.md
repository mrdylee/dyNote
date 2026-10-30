# Windows v0.12.2 공개 배포 확인

2026-10-30 14:21:52 UTC (23:21:52 KST) 공개된 Windows x64 시험판입니다.

- 공개 릴리스: https://github.com/mrdylee/dyNote/releases/tag/v0.12.2
- Windows 실행 기록: https://github.com/mrdylee/dyNote/actions/runs/41070704376
- 태그 및 실행 소스: `d3a2c51d3c37cfec77d30ef323cd183b563b9f79`
- 파일: `Dynote-0.12.2-windows-x64.zip`, 326,585,913 bytes
- SHA-256: `7b37e79f899b3ae342125407ed406f8810c622d1ac280075d48f93ec16027664`
- 체크섬 파일: `SHA256SUMS-windows-x64.txt`, 97 bytes

## 확인한 결과

1. Mac 단위 테스트 315개 통과 및 빌드 성공. 기존 큰 번들 경고는 남아 있습니다.
2. Windows Node 24.22.1: 315개 중 313개 통과, Windows 비대상 권한 테스트 2개 제외, 실패 0개.
3. 공식 Codex 0.166.0과 Claude Code 2.1.314 설치·탐색·초기화·로그인 상태 조회 통과. 기존 계정/토큰을 사용하지 않은 별도 프로필입니다.
4. 실제 Windows CLI와 로컬 응답 서버: Claude 제공 도구 0개, Codex는 `request_user_input`만 노출. 파일/이미지/명령/브라우저/외부 연결 도구 없음. 양쪽 스트리밍과 완료 처리 통과. 실제 계정 로그인 완료나 유료 모델 추론은 수행하지 않았습니다.
5. Windows에서 직접 패키징. 임시 프로필로 `Dynote.exe`를 실행해 제목 `Dynote`인 네이티브 창을 확인하고 정상 종료(0)를 확인했습니다. 전체 Windows UI 수동 검증과 사용자 PC 설치는 별도입니다.
6. 공개 ZIP을 다시 다운로드해 GitHub asset digest 및 공개 체크섬 파일과 SHA-256이 일치함을 확인했습니다. ZIP 전체 CRC 검사가 통과했고 Dynote.exe와 Copilot Windows 런타임이 포함되어 있습니다.
7. 공개 ZIP의 app.asar 내부 버전은 0.12.2입니다. Codex/Claude 컨트롤러, main/preload, 저널 분류, 업데이트, 문서 비교 핵심 소스는 Windows CRLF를 LF로 정규화하면 로컬 검증 소스와 같습니다. HANDOFF.md와 Git 메타데이터는 없습니다.
8. Mac 실제 Electron 화면에서는 제공자 전환·대화 분리·응답 취소·수정안 승인 후 저장, 기존 Copilot Agent 및 저널·비교·분류·업데이트 시나리오가 통과했습니다. 응답은 결정적 시험 데이터이며 실제 유료 모델 응답을 검증한 것은 아닙니다.

## 배포 중 수정한 사항

- v0.12.0은 Windows Codex의 새 실행 파일 경로를 발견하지 못해 공개 전 중단했습니다. 새 `bin/codex.exe`와 이전 경로를 모두 지원하도록 수정했습니다.
- v0.12.1 게시 후 추가 프로토콜 검사에서 최신 Codex의 `view_image` 도구 노출을 발견해 명시적으로 비활성화했습니다. v0.12.1은 삭제하지 않고 비공개 초안으로 돌렸으며, 비인증 공개 API 조회가 404임을 확인했습니다.
- 최종 v0.12.2는 Codex 도구 목록 검사까지 Windows 공개 배포의 필수 단계로 통과했습니다.

## 사용

ZIP 전체를 새 폴더에 풀고 기존 앱을 닫은 뒤 `Dynote-win32-x64/Dynote.exe`를 실행합니다. Codex/Claude는 Windows에 설치된 공식 CLI가 필요하며 AI 제공자 메뉴에서 Dynote 전용 계정 연결을 진행합니다. 두 제공자는 Ask/Edit를, Copilot은 기존 Agent까지 지원합니다. 이후 시험판도 자동 확인하려면 업데이트 설정에서 ‘시험 버전도 확인’을 켭니다.
