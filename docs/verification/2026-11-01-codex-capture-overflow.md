# Codex 캡처 통신 크기 오류 수정

2026-11-01, macOS arm64 / Dynote 0.12.2 로컬 수정본.

## 원인

사용자 설치본의 Studio에서 `Codex 응답이 너무 큽니다.`와 보존된 원본 캡처, Codex / GPT-6.1-Sol 선택을 확인했다. 첫 추출 결과가 생성되기 전의 오류였다.

실제 설치된 Codex CLI와 로컬 응답 서버에 합성 PNG 3,241,953바이트를 보내 같은 오류를 재현했다. Codex의 `userMessage`와 turn 이벤트가 입력 이미지의 data URL을 다시 포함하는데, 기존 RPC 수신 버퍼는 2 MiB를 초과하면 프로세스를 종료했다. 앱은 base64 데이터 8 MiB까지 허용하므로 정상 입력 이미지도 이 제한에 걸렸다. 모델의 최종 답변 크기를 초과한 사례가 아니다.

## 변경

- 이미지 데이터 상한을 기존 값 그대로 공통 상수로 사용한다.
- 통신 상한은 이미지 허용량 8 MiB와 메타데이터 여유 2 MiB를 합한 값으로 제한한다. 수신 청크 전체가 아닌 개별 JSON 메시지와 미완성 메시지에 적용한다.
- 실제 생성 답변의 128 KiB 제한과 이미지 입력 제한은 유지한다. 통신 메시지 초과 오류는 생성 답변 초과 오류와 구별한다.

## 검증

- 수정 전 실제 native CLI에서 위 오류가 발생하고, 신규 회귀 검사 3개도 실패했다.
- 수정 후 실제 native CLI의 큰 이미지 이벤트와 작은 최종 답변이 정상 수신됐다. 개인 계정이나 유료 추론을 사용하지 않고 로컬 서버의 합성 답변으로 검증했다.
- 최대 허용 이미지의 분할 수신, 여러 메시지가 합쳐진 수신 청크, 완성/미완성 메시지의 상한 초과 차단을 검증했다. 기존 생성 답변 초과 차단도 통과했다.
- 전체 테스트 322개, production build, diff check 통과. 최종 Mac 패키지의 Studio 제공자·모델 공유 10개 시나리오 통과.
- 패키지 파일 273개가 소스·빌드와 일치하고 엄격한 서명 무결성 검사가 통과했다. ASAR SHA-256: `5632727938f4b627d834f47eda165fccf270de457011bbb5e34c0bd6955539cc`.

## 설치

기존 앱을 정상 종료하고 `Dynote Install Backups/2026-11-01-codex-overflow-rmyqgxo_/Dynote.app`에 백업한 뒤 `/Applications/Dynote.app`을 교체했다. 설치된 ASAR가 검증 패키지와 일치한다. 사용자 원본·보관함·계정 저장소를 변경하거나 개인 캡처를 추가 전송하지 않았다. 재시작 후 일시적인 캡처 미리보기는 다시 입력해야 한다.

교체한 실제 앱을 정상 실행하고 기존 Codex 인증과 GPT-6.1-Sol 선택 유지를 확인했다. 추가 로그인/키체인 창 없이 Studio를 열어 두었다. 개인 캡처의 실제 추론 재시도와 Windows 실행·공개 배포는 수행하지 않았다.

실행 기록: `/private/tmp/dynote-codex-overflow-*.log`, `/private/tmp/dynote-codex-overflow-package-integrity.json`, `/private/tmp/dynote-codex-overflow-install.json`. native 검증 스크립트는 `scripts/verify-codex-protocol.mjs`이고 결과는 `output/verification/codex-protocol.json`에 있다.
