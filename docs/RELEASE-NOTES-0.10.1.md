# Dynote v0.10.1 — macOS 서명 무결성 수정

v0.10.0 Mac 앱에 남아 있던 불완전한 Electron 서명을 수정했습니다. 앱과 내부 실행 파일을 순서대로 ad-hoc 서명하고, `codesign --verify --deep --strict` 검사에 실패하면 패키지 검증을 중단합니다. 배포 ZIP을 다시 풀어도 서명이 유효한지 확인합니다.

이 수정은 **정식 Developer ID 서명이나 Apple 공증을 제공하지 않습니다.** Gatekeeper의 배포 승인 검사는 아직 통과하지 못하므로, 브라우저로 다운로드한 앱이 macOS에서 차단될 수 있습니다. 경고 없는 일반 배포를 완료했다는 의미가 아닙니다. 보안 설정이나 격리 속성을 자동으로 바꾸는 설치 스크립트는 포함하지 않습니다.

현재 로컬 환경에는 Developer ID Application 인증서가 없어 공증을 진행하지 못했습니다. [Electron의 서명·공증 안내](https://www.electronjs.org/docs/latest/tutorial/code-signing)

- 기존 ESS LINK 3D, 개발 플래너와 노트 기능은 유지합니다.
- Windows는 동일 버전으로 재패키징하며 동작 변경은 없습니다. 실제 Windows 실행은 미검증입니다.
- Mac ZIP은 전체 압축을 풀고 `Dynote-darwin-arm64/Dynote.app`을 사용합니다. Windows는 `Dynote-win32-x64/Dynote.exe`와 주변 파일을 함께 유지하세요.
- 이전 앱을 종료한 뒤 새 버전을 사용하세요. 기존 보관함을 다시 선택할 필요가 있으면 설정 → 보관함에서 실제 노트 폴더를 지정하세요.

[원인과 수정 검증](verification/macos-download-signature.md) · [이번 릴리스 검증](verification/release-0.10.1.md)
