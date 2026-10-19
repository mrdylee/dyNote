# Dynote v0.4.0 — Live Preview·설치 글꼴·Git 자동 저장

Markdown을 편집하면서 기본 서식과 이미지를 확인하고, PC에 설치된 글꼴을 선택하며, 별도 노트 저장소에 변경을 자동으로 백업할 수 있는 데스크톱 프리릴리스입니다. 기존 그래프·Canvas·Bases 기본 기능도 포함합니다.

## 주요 변경

- **Live Preview 1단계**: 제목·강조·취소선·인라인 코드·목록을 편집 화면에서 표시합니다. Markdown·위키 링크, 작업 체크박스, 로컬 이미지를 지원하며 편집하는 구간의 원문 문법을 드러냅니다. 소스/Live Preview 전환 시 선택·실행 취소 이력·보이는 문서 위치를 유지합니다.
- **편집 안정성**: LF·CRLF·BOM 문서의 저장 규칙, 서식이 포함된 제목과 한글 제목 링크, 체크박스 실행 취소를 검증했습니다. 커서 이동 시 변경된 구간만 다시 처리하도록 개선했습니다.
- **설치 글꼴**: 왼쪽 아래 **글꼴 및 Git 설정**에서 화면·본문·코드 글꼴을 따로 선택합니다. 글자 크기·본문 줄 간격과 미리보기를 제공하고 재실행 후 설정을 유지합니다. 글꼴 파일은 업로드하지 않습니다.
- **Git 자동 저장**: 설정에 노트 저장소 주소·브랜치를 입력하거나 기존 저장소를 빈 폴더에 가져옵니다. 기본 **10분**마다 저장된 파일을 커밋·업로드하며 **1~1440분** 사이의 정수를 직접 설정할 수 있습니다. 즉시 저장, 로컬 커밋만, 자동 저장 끄기를 지원합니다.
- **로컬 저장과 Git 상태 분리**: 인증·네트워크 오류가 나도 로컬 파일과 커밋은 남으며 다음 주기나 수동 실행에서 재시도합니다. 원격에 다른 기기의 변경이 있거나 직접 스테이징한 작업이 있으면 안내하고 멈춥니다.

## 다운로드와 실행

- **Mac Apple Silicon**: `Dynote-0.4.0-mac-arm64.zip`을 풀고 `Dynote.app`을 실행합니다.
- **Windows x64**: `Dynote-0.4.0-windows-x64.zip`을 모두 풀고 `Dynote-win32-x64/Dynote.exe`를 실행합니다. DLL·resources 등 폴더 전체를 유지하세요.
- `SHA256SUMS.txt`로 다운로드 파일의 SHA-256을 비교할 수 있습니다. 앱 실행에 Node.js는 필요 없습니다. Git 자동 저장을 사용하려면 Git과 해당 저장소에 접근 가능한 SSH 키 또는 기존 Git 자격 증명이 필요합니다.

기존 보관함·설정·복구 사본을 이어 쓰며 내부 앱 데이터 폴더 이름은 `Open Notes`로 유지합니다. Git 주소는 나중에 입력해도 되며 연결 전에는 자동 업로드가 꺼져 있습니다. 실제 개인 저장소는 이 릴리스 작업에서 연결하지 않았습니다.

## 검증과 범위

자동 테스트 99개가 통과했습니다. 배포 빌드·패키지 비교·Mac 패키지 실행 결과는 [v0.4.0 검증 기록](https://github.com/mrdylee/dyNote/blob/v0.4.0/docs/RELEASE-REVIEW-0.4.0.md)에 기록합니다. Git 검증은 임시 노트와 로컬 bare 원격 저장소를 사용하며 실제 GitHub 인증 성공을 의미하지 않습니다.

Windows 패키지는 macOS에서 교차 생성하며 **Windows 실제 실행·글꼴 열거·한글 IME는 미검증**입니다. 배포 서명·macOS 공증·설치 마법사·자동 업데이트가 없는 개발 버전입니다.

Live Preview는 표 셀 직접 편집, 수식·Mermaid·PDF·콜아웃의 편집 중 렌더링을 포함하지 않습니다. 해당 읽기 기능은 읽기·분할 보기에서 사용합니다. Git은 앱이 열린 동안 동작하는 자동 백업이며 자동 pull·rebase·강제 push·충돌 해결은 하지 않습니다. 모바일·Obsidian Sync/Publish·기존 Obsidian 플러그인 호환도 포함하지 않습니다.

[Live Preview 지원 범위](https://github.com/mrdylee/dyNote/blob/v0.4.0/docs/LIVE-PREVIEW.md) · [글꼴·Git 설정 안내](https://github.com/mrdylee/dyNote/blob/v0.4.0/docs/FONTS-GIT.md) · [Windows 실행 안내](https://github.com/mrdylee/dyNote/blob/v0.4.0/docs/WINDOWS.md)
