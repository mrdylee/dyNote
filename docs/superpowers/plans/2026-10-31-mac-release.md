# Mac v0.12.2 배포와 실제 설치

## 확인한 원인

- `/Applications/Dynote.app` 0.6.1: 코드 서명 리소스가 빠져 무결성 검사 실패.
- `~/Applications/Dynote.app` 0.10.1: 무결성 검사는 통과하지만 Gatekeeper 검사 거부.
- 현재 사용할 수 있는 서명은 Apple Development이며 Developer ID Application은 없음. 사용자에게 배포 인증서 사용 가능 여부를 질문하고 독립적인 빌드·실행 검증을 계속한다.

## 구현·검증 순서

1. 기존 v0.12.2 앱 소스로 Apple Silicon 패키지 생성. 전체 테스트, 번들 코드 서명과 핵심 파일 검증.
2. Applications 바로가기가 있는 DMG와 업데이트 호환 ZIP 생성. 다시 마운트/압축 해제해 서명·권한·실행 결과 확인. 공증되지 않은 경우 설치 안내에 정확하게 명시한다.
3. Mac 산출물을 기존 v0.12.2 릴리스에 추가한다. Windows 파일은 변경하지 않는다. 공개 파일을 재다운로드해 SHA-256 및 내부 앱 버전을 확인한다.
4. 기존 두 설치본을 백업하고 `/Applications/Dynote.app`에 검증한 최신 앱을 설치한다. 노트·프로필은 보존한다. 일반 실행 경로로 앱을 열고 실제 사용자 Mac 화면과 프로세스를 확인한다.
5. 로컬 실행·다운로드 무결성·Apple 배포 서명/공증 결과는 구분해 보고한다. 전역 보안 설정은 변경하지 않는다.

Apple 공증 자료: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
