# Dynote v0.4.1 — 설치 글꼴 목록 탐색 수정

설치된 글꼴이 많을 때 목록 아래쪽 글꼴을 고르기 어려웠던 문제를 수정한 프리릴리스입니다. v0.4.0의 Live Preview·글꼴 설정·Git 자동 저장 기능을 그대로 포함합니다.

## 변경사항

- 자동완성 팝업을 **검색 가능한 스크롤 목록**으로 바꿨습니다. 화면·본문·코드별 **설치 글꼴 목록**을 펼쳐 선택합니다.
- 마우스 휠·스크롤바·방향키·Page Up/Down·Home/End로 목록 끝까지 이동할 수 있습니다.
- 이름 검색으로 후보를 좁히고 **시스템 기본 글꼴**로 되돌릴 수 있습니다. 직접 글꼴 이름을 입력하는 방법과 기존 설정 유지도 계속 지원합니다.

## 다운로드

- **Mac Apple Silicon**: `Dynote-0.4.1-mac-arm64.zip`을 풀고 `Dynote.app`을 실행합니다.
- **Windows x64**: `Dynote-0.4.1-windows-x64.zip`을 모두 풀고 `Dynote-win32-x64/Dynote.exe`를 실행합니다. DLL·resources 등 폴더 전체를 유지하세요.
- `SHA256SUMS.txt`로 다운로드 파일의 SHA-256을 비교할 수 있습니다. 기존 설치본은 자동 업데이트되지 않습니다.

## 검증과 제한

자동 테스트·Mac 패키지의 실제 글꼴 스크롤·검색·키보드 선택·설정 유지·Git 자동 저장 검사 결과는 [v0.4.1 검증 기록](https://github.com/mrdylee/dyNote/blob/v0.4.1/docs/RELEASE-REVIEW-0.4.1.md)에 기록합니다.

Windows 패키지는 macOS에서 교차 생성하며 **Windows 실제 실행·글꼴 열거·한글 IME는 미검증**입니다. 배포 서명·macOS 공증·설치 마법사·자동 업데이트는 제공하지 않습니다. Git 자동 저장은 설치된 Git과 기존 인증을 사용하고 기본 10분 간격이며, 자동 pull·충돌 해결은 하지 않습니다. VS Code 전용 연동 기능은 이번 릴리스에 추가하지 않았습니다.

[글꼴·Git 설정 안내](https://github.com/mrdylee/dyNote/blob/v0.4.1/docs/FONTS-GIT.md) · [Windows 실행 안내](https://github.com/mrdylee/dyNote/blob/v0.4.1/docs/WINDOWS.md) · [v0.4.0 주요 기능](https://github.com/mrdylee/dyNote/releases/tag/v0.4.0)
